import { useEffect, useState } from 'react';
import { useTelemetry } from './telemetry';

type Analysis = { actual: string; target: string; controls: string[]; target_available: boolean; points: { sequence: number; source_time: string; values: Record<string, number | null>; actual_minus_target: number | null }[]; summary: { baseline_count: number; baseline_mean: number | null; z_score: number | null; rate_per_source_minute: number | null }; note: string };
const number = (value: number | null | undefined) => value == null ? '결측 / 미확인' : value.toLocaleString('en-US', { maximumFractionDigits: 3 });
export function OperationsAnalysis() {
  const [loop, setLoop] = useState('reheater');
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const telemetry = useTelemetry();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/analysis/loop?name=${loop}`, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error(`Analysis HTTP ${response.status}`); return response.json(); })
      .then(data => { setData(data); setError(null); }).catch(error => { if (error.name !== 'AbortError') setError(String(error)); });
    return () => controller.abort();
  }, [loop, telemetry.current?.run_id, telemetry.current?.sequence]);
  const tags = data ? [data.actual, data.target, ...data.controls] : [];
  return <section className="analysis panel"><div className="panel-heading"><div><span className="eyebrow">OPERATIONAL ANALYSIS</span><h2>동일 시각의 운전값 비교</h2></div><select aria-label="분석 Loop" value={loop} onChange={event => setLoop(event.target.value)}><option value="reheater">Reheater</option><option value="generation">Generation</option></select></div>
    {error && <p role="alert">{error}</p>}{data && <div className="analysis-content">{!data.target_available && <p className="note" data-testid="target-missing">목표값 결측 — 목표 편차를 계산하지 않습니다.</p>}<div className="analysis-stats"><span>변화 / 원본 분<b>{number(data.summary.rate_per_source_minute)}</b></span><span>과거 표본<b>{data.summary.baseline_count}</b></span><span>과거 평균<b>{number(data.summary.baseline_mean)}</b></span><span>분포 z-score<b>{number(data.summary.z_score)}</b></span></div><div className="table-scroll"><table><thead><tr><th>Source time</th>{tags.map(tag => <th key={tag}>{tag}</th>)}<th>실제 − 목표</th></tr></thead><tbody>{data.points.slice(-8).reverse().map(point => <tr key={point.sequence}><td>{point.source_time}</td>{tags.map(tag => <td key={tag}>{number(point.values[tag])}</td>)}<td data-testid={`target-delta-${point.sequence}`}>{number(point.actual_minus_target)}</td></tr>)}</tbody></table></div><p className="note">{data.note} 단위 미확인. 과거 분포는 현재 수신 세션의 최신값 이전 이력입니다.</p></div>}
  </section>;
}
