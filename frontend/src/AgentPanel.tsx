import { useSession } from './session';
import { apiFetch } from './session';
import { useEffect, useRef, useState } from 'react';

type Answer = { trace_id: string; equipment: string; assessment: string; answer: string; explanation: string; limitations: string; status: string; model: string };
export function AgentPanel({ equipment, tag, onTrace }: { equipment: string | null; tag: string | null; onTrace: (trace: string | null) => void }) {
  const { user } = useSession();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [question, setQuestion] = useState('선택 설비의 현재값과 변화 추이를 근거와 함께 설명해줘.');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function ask() {
    setPending(true); setError(null); setAnswer(null); onTrace(null);
    try {
      const response = await apiFetch('/api/agent/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, equipment, tag }) });
      const data = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(data.detail));
      if (!active.current) return;
      setAnswer(data);
      if (equipment === 'reheater') onTrace(data.trace_id);
    } catch (error) { setError(String(error)); } finally { setPending(false); }
  }
  return <section id="agent" tabIndex={-1} className="agent panel" aria-label="AI Agent">
    <div className="panel-heading">
      <div><span className="eyebrow">READ-ONLY OPERATIONS AGENT</span><h2>선택 설비의 관측 근거 확인</h2></div>
      <span className="quiet">{equipment ?? '설비를 선택하세요'}</span>
    </div>
    <div className="agent-content">
      <label htmlFor="agent-question">질문</label>
      <textarea id="agent-question" maxLength={1000} value={question} onChange={event => setQuestion(event.target.value)} />
      <button className="primary-button" disabled={user.role !== 'operator' || !equipment || pending || !question.trim()} onClick={ask}>
        {pending ? '로컬 모델이 근거를 확인 중…' : 'Agent 조회'}
      </button>
      <p role="status">{pending ? '로컬 모델이 근거를 조회하고 있습니다.' : answer ? 'Agent 조회가 완료되었습니다. 아래 답변과 Trace를 확인하세요.' : ''}</p>
      {error && <p role="alert">{error}</p>}
      {answer && <div data-testid="agent-answer">
        <h3>질문에 대한 답변</h3>
        <p className="agent-answer-text">{answer.answer}</p>
        <p className="agent-explanation">{answer.explanation}</p>
        <p className="note">{answer.limitations}</p>
        <a href={`/api/agent/traces/${answer.trace_id}`} target="_blank" rel="noreferrer">도구 호출·응답 Trace (새 탭)</a>
        <span className="quiet"> · {answer.model} · {answer.status}</span>
      </div>}
    </div>
  </section>;
}
