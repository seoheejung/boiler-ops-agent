import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from backend.app.agent.service import model_json
from backend.app.security import Security

POLICY = {"id": "local-demo-v1", "parameter": "demo_bias", "unit": "simulation_step", "minimum": -10,
          "maximum": 10, "max_step": 1, "proposal_ttl_seconds": 300,
          "scope": "Local approval-state simulator only; no physical plant or temperature dynamics"}


class ProposalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_trace_id: uuid.UUID
    intent: str = Field(min_length=1, max_length=500)


class Recommendation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["increase", "hold", "decrease"]


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approve: StrictBool
    confirm: StrictBool
    expected_revision: int = Field(ge=0, strict=True)


class SimulatorError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Simulator:
    def __init__(self, boiler, traces):
        self.boiler, self.traces = boiler, traces
        self.path = Path(os.getenv("SIMULATOR_DB_PATH", "artifacts/simulator.sqlite"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id=1), value INTEGER NOT NULL, revision INTEGER NOT NULL);
                INSERT OR IGNORE INTO state VALUES (1, 0, 0);
                CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, created_at REAL NOT NULL, proposal_id TEXT, event TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS used_evidence (trace_id TEXT PRIMARY KEY);
            ''')
            for table in ('proposals', 'audit'):
                if 'owner' not in {row['name'] for row in db.execute(f'PRAGMA table_info({table})')}:
                    db.execute(f'ALTER TABLE {table} ADD COLUMN owner TEXT')
            db.execute('CREATE INDEX IF NOT EXISTS audit_owner ON audit(owner,id)')
            db.execute('CREATE INDEX IF NOT EXISTS proposals_owner ON proposals(owner)')

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def capacity(db, audit_slots=3):
        if db.execute('SELECT count(*) FROM proposals').fetchone()[0] >= 1000 or db.execute('SELECT count(*) FROM audit').fetchone()[0] + audit_slots > 5000:
            raise SimulatorError(507, "Simulator capacity reached; archive records before retrying")

    @staticmethod
    def audit(db, principal, proposal_id, event, payload):
        db.execute('INSERT INTO audit(created_at,proposal_id,event,payload,owner) VALUES(?,?,?,?,?)',
                   (time.time(), proposal_id, event, json.dumps(payload, ensure_ascii=False, allow_nan=False), principal.user_id))

    def snapshot(self, principal):
        with self.connection() as db:
            state = dict(db.execute('SELECT value,revision FROM state WHERE id=1').fetchone())
            proposals = [{**json.loads(row['payload']), "status": row['status']} for row in db.execute('SELECT * FROM proposals WHERE owner=? ORDER BY rowid DESC LIMIT 20', (principal.user_id,))]
        return {**state, "policy": POLICY, "enabled": principal.role == "operator", "proposals": proposals}

    def evidence(self, trace_id, principal):
        trace = self.traces.read(trace_id, principal)
        context = trace.get('context', {})
        snapshot = self.boiler.snapshot()
        current = snapshot['current'] or {}
        age = time.time() - datetime.fromisoformat(trace['created_at']).timestamp()
        if ('response' not in trace or trace['request']['equipment'] != 'reheater' or
                not 0 <= age <= POLICY['proposal_ttl_seconds'] or
                (not current or not 0 <= time.time() - datetime.fromisoformat(current['emitted_at']).timestamp() <= 300) or
                trace.get('snapshot_status') != 'LIVE' or snapshot['status'] != 'LIVE' or
                not context.get('tag') or context.get('tag') != trace['request'].get('tag') or
                context.get('run_id') != current.get('run_id') or
                not 1 <= context.get('sequence', 0) <= current.get('sequence', 0)):
            raise SimulatorError(409, "Fresh successful evidence for the current reheater sensor and replay run is required")
        return trace

    def propose(self, request, principal):
        Security.operator(principal)
        self.evidence(request.source_trace_id, principal)
        with self.connection() as db:
            self.capacity(db)
            if db.execute('SELECT 1 FROM used_evidence WHERE trace_id=?', (str(request.source_trace_id),)).fetchone():
                raise SimulatorError(409, "Evidence already used; run a new Agent query")
        state = self.snapshot(principal)
        recommendation = Recommendation.model_validate(model_json([
            {"role": "system", "content": "Translate the user's requested change to a local synthetic demo_bias parameter into increase, hold, or decrease. This is not a boiler control recommendation. Choose hold if the intent is unclear. Return JSON with action only."},
            {"role": "user", "content": json.dumps({"intent": request.intent, "policy": POLICY, "current_value": state['value']}, ensure_ascii=False)}], Recommendation.model_json_schema()))
        delta = {"increase": 1, "hold": 0, "decrease": -1}[recommendation.action]
        requested = state['value'] + delta
        if not POLICY['minimum'] <= requested <= POLICY['maximum']:
            raise SimulatorError(422, "Requested value violates the simulator-only policy")
        now = time.time()
        proposal = {"id": str(uuid.uuid4()), "source_trace_id": str(request.source_trace_id), "intent": request.intent,
                    "model": os.getenv('OLLAMA_MODEL'), "recommendation": recommendation.model_dump(),
                    "parameter": POLICY['parameter'], "old_value": state['value'], "requested_value": requested,
                    "expected_revision": state['revision'], "policy_id": POLICY['id'], "created_at": now,
                    "expires_at": now + POLICY['proposal_ttl_seconds'], "status": "pending"}
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            self.capacity(db)
            self.evidence(request.source_trace_id, principal)
            current = db.execute('SELECT revision FROM state WHERE id=1').fetchone()[0]
            if current != state['revision']:
                raise SimulatorError(409, "Simulator changed during recommendation; run a new query")
            try:
                db.execute('INSERT INTO used_evidence VALUES (?)', (str(request.source_trace_id),))
            except sqlite3.IntegrityError:
                raise SimulatorError(409, "Evidence already used; run a new Agent query") from None
            db.execute('INSERT INTO proposals(id,payload,status,owner) VALUES (?,?,?,?)', (proposal['id'], json.dumps(proposal, ensure_ascii=False), 'pending', principal.user_id))
            self.audit(db, principal, proposal['id'], 'proposed', proposal)
        return proposal

    def decide(self, proposal_id, decision, principal):
        Security.operator(principal)
        if not decision.confirm:
            raise SimulatorError(422, "Explicit human confirmation is required")
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM proposals WHERE id=? AND owner=?', (str(proposal_id), principal.user_id)).fetchone()
            if row is None:
                raise SimulatorError(404, "Proposal not found")
            proposal = json.loads(row['payload'])
            if row['status'] != 'pending':
                raise SimulatorError(409, "Proposal already decided")
            if time.time() > proposal['expires_at']:
                raise SimulatorError(409, "Proposal expired")
            state = dict(db.execute('SELECT value,revision FROM state WHERE id=1').fetchone())
            if decision.expected_revision != proposal['expected_revision'] or state['revision'] != proposal['expected_revision']:
                raise SimulatorError(409, "Simulator revision changed; create a new proposal")
            if proposal['old_value'] != state['value'] or proposal['policy_id'] != POLICY['id']:
                raise SimulatorError(409, "Proposal no longer matches simulator state or policy")
            requested = proposal['requested_value']
            if type(requested) is not int or not POLICY['minimum'] <= requested <= POLICY['maximum'] or abs(requested - state['value']) > POLICY['max_step']:
                raise SimulatorError(422, "Simulator constraints failed at approval")
            self.capacity(db)
            if decision.approve:
                self.evidence(proposal['source_trace_id'], principal)
            status = 'executed' if decision.approve else 'rejected'
            self.audit(db, principal, str(proposal_id), 'approved' if decision.approve else 'rejected',
                       {"actor": principal.user_id, "confirm": True, "old_value": state['value'],
                        "requested_value": requested, "expected_revision": decision.expected_revision})
            if decision.approve:
                db.execute('UPDATE state SET value=?, revision=revision+1 WHERE id=1', (requested,))
                self.audit(db, principal, str(proposal_id), 'executed', {"old_value": state['value'], "new_value": requested, "revision": state['revision'] + 1})
            db.execute('UPDATE proposals SET status=? WHERE id=?', (status, str(proposal_id)))
        return {"proposal_id": str(proposal_id), "status": status, "value": requested if decision.approve else state['value'],
                "revision": state['revision'] + int(decision.approve)}

    def audit_log(self, principal, after_id=0, limit=50):
        with self.connection() as db:
            return [{**dict(row), 'payload': json.loads(row['payload'])} for row in db.execute('SELECT * FROM audit WHERE owner=? AND id>? ORDER BY id LIMIT ?', (principal.user_id, after_id, limit))]
