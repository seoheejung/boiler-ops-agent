import { useState } from 'react';

type Answer = { trace_id: string; equipment: string; assessment: string; answer: string; limitations: string; status: string; model: string };
export function AgentPanel({ equipment, tag, onTrace }: { equipment: string | null; tag: string | null; onTrace: (trace: string | null) => void }) {
  const [question, setQuestion] = useState('선택 설비의 현재값과 변화 추이를 근거와 함께 설명해줘.');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function ask() {
    setPending(true); setError(null); setAnswer(null); onTrace(null);
    try {
      const response = await fetch('/api/agent/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, equipment, tag }) });
      const data = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(data.detail));
      setAnswer(data);
      if (equipment === 'reheater') onTrace(data.trace_id);
    } catch (error) { setError(String(error)); } finally { setPending(false); }
  }
  return <section className="agent panel"><div className="panel-heading"><div><span className="eyebrow">READ-ONLY OPERATIONS AGENT</span><h2>선택 설비의 관측 근거 확인</h2></div><span className="quiet">{equipment ?? '설비를 선택하세요'}</span></div><div className="agent-content"><label htmlFor="agent-question">질문</label><textarea id="agent-question" maxLength={1000} value={question} onChange={event => setQuestion(event.target.value)} /><button className="primary-button" disabled={!equipment || pending || !question.trim()} onClick={ask}>{pending ? '로컬 모델이 근거를 확인 중…' : 'Agent 조회'}</button>{error && <p role="alert">{error}</p>}{answer && <div data-testid="agent-answer"><h3>{answer.assessment} · {answer.equipment}</h3><pre>{answer.answer}</pre><p className="note">{answer.limitations}</p><a href={`/api/agent/traces/${answer.trace_id}`} target="_blank" rel="noreferrer">도구 호출·응답 Trace ↗</a><span className="quiet"> · {answer.model} · {answer.status}</span></div>}</div></section>;
}
