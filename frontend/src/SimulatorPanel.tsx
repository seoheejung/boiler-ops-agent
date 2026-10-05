import { apiFetch } from './session';
import { useEffect, useState } from 'react';

type Proposal = { id: string; old_value: number; requested_value: number; expected_revision: number; status: string; expires_at: number; source_trace_id: string };
type State = { value: number; revision: number; enabled: boolean; proposals: Proposal[] };
export function SimulatorPanel({ agentTrace }: { agentTrace: string | null }) {
  const [state, setState] = useState<State | null>(null);
  const [intent, setIntent] = useState('Increase the local demo parameter by one synthetic step.');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { if (message) document.getElementById('sim-feedback')?.focus(); }, [message]);
  async function refresh() { const response = await apiFetch('/api/simulator'); if (!response.ok) throw new Error(`Simulator HTTP ${response.status}`); setState(await response.json()); }
  useEffect(() => { refresh().catch(error => setError(String(error))); }, []);
  async function propose() {
    setBusy(true); setError(null); setMessage(''); setConfirmed(false);
    try {
      const response = await apiFetch('/api/simulator/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_trace_id: agentTrace, intent }) });
      const data = await response.json(); if (!response.ok) throw new Error(JSON.stringify(data.detail));
      await refresh(); setMessage('제안이 생성되었습니다. 변경값과 만료 시각을 검토하세요.');
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  async function decide(proposal: Proposal, approve: boolean) {
    setBusy(true); setError(null); setMessage('');
    try {
      const response = await apiFetch(`/api/simulator/proposals/${proposal.id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve, confirm: confirmed, expected_revision: proposal.expected_revision }) });
      const data = await response.json(); if (!response.ok) throw new Error(JSON.stringify(data.detail));
      setConfirmed(false); await refresh(); setMessage(approve ? '승인한 Simulator 변경이 실행되었습니다.' : '제안을 거절했습니다. Simulator 값은 유지됩니다.');
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  const proposal = state?.proposals[0];
  return <section id="simulator" tabIndex={-1} className="simulator panel" aria-label="Simulator 승인"><div className="panel-heading"><div><span className="eyebrow">CONTROLLED SIMULATOR</span><h2>로컬 데모 상태 변경 승인</h2></div><span className="quiet">실제 설비 연결 없음</span></div><div className="agent-content"><p className="note">승인 절차 검증용 demo_bias · 값 −10~10, 한 번에 최대 1 simulation_step. 산업 제어 범위나 온도 반응 모델이 아닙니다.</p><div className="analysis-stats"><span>현재 Simulator 값<b data-testid="sim-value">{state?.value ?? '—'}</b></span><span>Revision<b>{state?.revision ?? '—'}</b></span></div>{!state?.enabled && <p className="note">제안과 승인은 운영자 계정에서 사용할 수 있습니다.</p>}
      <label htmlFor="sim-intent">Simulator 요청</label><input id="sim-intent" value={intent} onChange={event => setIntent(event.target.value)} maxLength={500} /><button className="primary-button" disabled={!state?.enabled || !agentTrace || busy || !intent.trim()} onClick={propose}>{busy ? '처리 중…' : 'Agent Simulator 제안 생성'}</button>{!agentTrace && <p className="note">먼저 재열기 센서를 선택하고 Agent 조회를 실행하세요.</p>}
      <p id="sim-feedback" tabIndex={-1} role="status">{busy ? "Simulator 요청 처리 중입니다." : message}</p>{proposal && <div className="proposal"><h3>승인 대상: {proposal.old_value} → {proposal.requested_value}</h3><p data-testid="proposal-status">{proposal.status}</p><p className="quiet">제안 ID {proposal.id} · Revision {proposal.expected_revision} · 만료 {new Date(proposal.expires_at * 1000).toLocaleTimeString()}</p>{proposal.status === 'pending' && <><label className="confirm-label"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />위 Simulator 변경값과 데모 정책을 확인했습니다.</label><div className="decision-buttons"><button disabled={!state?.enabled || !confirmed || busy} onClick={() => decide(proposal, false)}>거절</button><button className="primary-button" disabled={!state?.enabled || !confirmed || busy} onClick={() => decide(proposal, true)}>승인 및 Simulator 실행</button></div></>}</div>}{error && <p role="alert">{error}</p>}<a href="/api/simulator/audit" target="_blank" rel="noreferrer">승인·변경 Audit 확인 (새 탭)</a></div></section>;
}
