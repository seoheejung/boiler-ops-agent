import hmac
import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.agent.service import model_json, trace_directory

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
    approve: bool
    confirm: bool
    expected_revision: int = Field(ge=0)


class SimulatorError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Simulator:
    def __init__(self):
        self.path = Path(os.getenv("SIMULATOR_DB_PATH", "artifacts/simulator.sqlite"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.token = os.getenv("SIMULATOR_APPROVAL_TOKEN", "")
        with self.connection() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id=1), value INTEGER NOT NULL, revision INTEGER NOT NULL);
                INSERT OR IGNORE INTO state VALUES (1, 0, 0);
                CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, created_at REAL NOT NULL, proposal_id TEXT, event TEXT NOT NULL, payload TEXT NOT NULL);
            ''')

    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def authenticate(self, authorization):
        if len(self.token) < 32:
            raise SimulatorError(503, "Simulator approval disabled: configure a token of at least 32 characters")
        if not authorization or not hmac.compare_digest(authorization, 'Bearer ' + self.token):
            raise SimulatorError(401, "Approval credentials required")

    @staticmethod
    def audit(db, proposal_id, event, payload):
        db.execute('INSERT INTO audit(created_at,proposal_id,event,payload) VALUES(?,?,?,?)',
                   (time.time(), proposal_id, event, json.dumps(payload, ensure_ascii=False, allow_nan=False)))

    def snapshot(self):
        with self.connection() as db:
            state = dict(db.execute('SELECT value,revision FROM state WHERE id=1').fetchone())
            proposals = [{**json.loads(row['payload']), "status": row['status']} for row in db.execute('SELECT * FROM proposals ORDER BY rowid DESC LIMIT 20')]
        return {**state, "policy": POLICY, "enabled": len(self.token) >= 32, "proposals": proposals}

    def propose(self, request):
        trace_path = trace_directory() / f'{request.source_trace_id}.json'
        if not trace_path.is_file():
            raise SimulatorError(422, "Source Agent trace does not exist")
        trace = json.loads(trace_path.read_text(encoding='utf-8'))
        if 'response' not in trace or trace['request']['equipment'] != 'reheater':
            raise SimulatorError(422, "A successful reheater Agent trace is required")
        state = self.snapshot()
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
            db.execute('INSERT INTO proposals VALUES (?,?,?)', (proposal['id'], json.dumps(proposal, ensure_ascii=False), 'pending'))
            self.audit(db, proposal['id'], 'proposed', proposal)
        return proposal

    def decide(self, proposal_id, decision, authorization):
        self.authenticate(authorization)
        if not decision.confirm:
            raise SimulatorError(422, "Explicit human confirmation is required")
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM proposals WHERE id=?', (str(proposal_id),)).fetchone()
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
            status = 'executed' if decision.approve else 'rejected'
            self.audit(db, str(proposal_id), 'approved' if decision.approve else 'rejected',
                       {"actor": "authenticated-local-operator", "confirm": True, "old_value": state['value'],
                        "requested_value": requested, "expected_revision": decision.expected_revision})
            if decision.approve:
                db.execute('UPDATE state SET value=?, revision=revision+1 WHERE id=1', (requested,))
                self.audit(db, str(proposal_id), 'executed', {"old_value": state['value'], "new_value": requested, "revision": state['revision'] + 1})
            db.execute('UPDATE proposals SET status=? WHERE id=?', (status, str(proposal_id)))
        return {"proposal_id": str(proposal_id), "status": status, "value": requested if decision.approve else state['value'],
                "revision": state['revision'] + int(decision.approve)}

    def audit_log(self):
        with self.connection() as db:
            return [{**dict(row), 'payload': json.loads(row['payload'])} for row in db.execute('SELECT * FROM audit ORDER BY id')]
