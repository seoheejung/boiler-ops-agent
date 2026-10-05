import { apiFetch } from './session';
import { useEffect, useId, useState } from 'react';
import { useTelemetry } from './telemetry';

type Point = { sequence: number; source_time: string; value: number | null };
export function SensorTrend({ tag }: { tag: string }) {
  const descriptionId = useId();
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const telemetry = useTelemetry();
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/sensors/history?tag=${encodeURIComponent(tag)}`, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error(`History HTTP ${response.status}`); return response.json(); })
      .then(data => { setPoints(data.points); setError(null); }).catch(error => { if (error.name !== 'AbortError') setError(String(error)); });
    return () => controller.abort();
  }, [tag, telemetry.current?.run_id, telemetry.current?.sequence]);
  const valid = points.flatMap(point => point.value === null ? [] : [point.value]);
  const min = Math.min(...valid), max = Math.max(...valid);
  const start = points.length ? Date.parse(points[0].source_time.replace(' ', 'T')) : 0;
  const end = points.length ? Date.parse(points[points.length - 1].source_time.replace(' ', 'T')) : 0;
  const paths: string[] = []; let active = '';
  points.forEach(point => {
    if (point.value === null) { if (active) paths.push(active); active = ''; return; }
    const x = 5 + (Date.parse(point.source_time.replace(' ', 'T')) - start) / Math.max(1, end - start) * 250;
    const y = 65 - (point.value - min) / Math.max(.001, max - min) * 50;
    active += `${active ? ' L' : 'M'} ${x} ${y}`;
  });
  if (active) paths.push(active);
  return <div className="trend"><span className="eyebrow">RECENT TREND · {points.length} OBSERVATIONS</span>{error ? <p role="alert">{error}</p> : valid.length ? <><svg viewBox="0 0 260 80" role="img" aria-label={`${tag} 최근 추이`} aria-describedby={descriptionId}><path d="M5 70H255" stroke="#dbe2d7" />{paths.map((path, i) => <path key={i} d={path} fill="none" stroke="#4b7859" strokeWidth="2" />)}</svg><p id={descriptionId} className="note">유효 관측 {valid.length}개, 최솟값 {min}, 최댓값 {max}. 결측 구간은 연결하지 않습니다.</p><div className="trend-labels"><span>{points[0]?.source_time}</span><span>{points.at(-1)?.source_time}</span></div><details><summary>추이 원본값 표로 보기</summary><table><caption>{tag} 최근 관측</caption><thead><tr><th scope="col">원본 시각</th><th scope="col">값 · 단위 미확인</th></tr></thead><tbody>{points.map(point => <tr key={point.sequence}><td>{point.source_time}</td><td>{point.value ?? "결측"}</td></tr>)}</tbody></table></details></> : <p className="quiet">관측값 없음 · 결측값을 보간하지 않습니다.</p>}</div>;
}
