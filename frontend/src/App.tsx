import { useCallback, useEffect, useState } from 'react';
import { BoilerViewport } from './BoilerScene';
import { connectTelemetry, formatValue, useConnection, useEvents, useReading, useTelemetry } from './telemetry';
import type { Registry, Sensor } from './types';
import { SensorTrend } from './SensorTrend';
import { OperationsAnalysis } from './OperationsAnalysis';
import { AgentPanel } from './AgentPanel';
import { ForecastPanel } from './ForecastPanel';

function KPI({ sensor, onSelect }: { sensor: Sensor; onSelect: () => void }) {
  const value = useReading(sensor.tag);
  return <button className="kpi" onClick={onSelect}><span>{sensor.label}</span><strong data-testid={`kpi-${sensor.tag}`}>{formatValue(value)}</strong><small>{sensor.unit ?? '단위 미확인'}</small></button>;
}

export default function App() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const telemetry = useTelemetry();
  const connection = useConnection();
  const events = useEvents();
  useEffect(() => connectTelemetry(), []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/registry', { signal: controller.signal }).then(response => { if (!response.ok) throw new Error(`Registry HTTP ${response.status}`); return response.json(); })
      .then(setRegistry).catch(error => { if (error.name !== 'AbortError') setError(String(error)); });
    return () => controller.abort();
  }, []);
  const onEquipment = useCallback((id: string) => {
    const first = Object.values(registry?.sensors ?? {}).find(sensor => sensor.equipment === id);
    if (first) setSelected(first.tag);
  }, [registry]);
  const sensor = selected ? registry?.sensors[selected] : null;
  const reading = selected ? telemetry.current?.sensors[selected] : null;
  const kpis = ['실제 출력값', '목표 발전량', '총 주증기 유량', '터빈용 주증기 압력', '최종과열기 출구 온도 평균값', '배기가스 산소 중간값'].flatMap(tag => registry?.sensors[tag] ? [registry.sensors[tag]] : []);
  const status = connection !== 'CONNECTED' ? connection : telemetry.status;
  return <div className="app-shell">
    <header className="topbar"><a href="/" className="brand"><span className="brand-mark">B</span>BoilerOps <span>AGENT</span></a><div className="workspace-label">OPERATIONS WORKSPACE <b>한국중부발전 · 공개 운전데이터</b></div><span className={`status ${status.toLowerCase()}`} data-testid="stream-status">● {status}</span></header>
    <div className="page-heading"><div><span className="eyebrow">REALTIME MONITORING</span><h1>운전 현황 <span>Historical replay</span></h1></div><div className="connections"><span>Kafka <b data-testid="kafka-status">{telemetry.kafka}</b></span><span>WebSocket <b data-testid="ws-status">{connection}</b></span><span>Replay <b>{telemetry.replay_interval_ms || '—'} ms</b></span></div></div>
    {(error || telemetry.error) && <div role="alert" className="error-banner">{error || telemetry.error}</div>}
    {telemetry.stale && <div className="stale-banner">STALE · 최신 데이터 수신을 기다리고 있습니다. 마지막 관측값을 표시합니다.</div>}
    <div className="kpi-bar">{kpis.map(sensor => <KPI key={sensor.tag} sensor={sensor} onSelect={() => setSelected(sensor.tag)} />)}</div>
    <main className="monitor-grid">
      {registry ? <BoilerViewport registry={registry} selected={selected} onSelect={setSelected} onEquipment={onEquipment} /> : <div className="panel loading">설비 메타데이터 불러오는 중…</div>}
      <aside className="inspector panel" aria-label="센서 상세"><div className="panel-heading"><div><span className="eyebrow">EQUIPMENT INSPECTOR</span><h2>{sensor ? sensor.equipment : 'Sensor details'}</h2></div><span className="inspector-icon">↗</span></div>
        {sensor ? <div className="sensor-detail"><span className="tag-kind">{sensor.measurement_type}</span><h3 data-testid="inspector-tag">{sensor.tag}</h3><div className="current-value" data-testid="inspector-value">{formatValue(reading ?? undefined)}</div><div className="quiet">{sensor.unit ?? '단위 미확인'} · {reading?.quality ?? '대기 중'}</div>
          <dl><dt>Source time</dt><dd data-testid="inspector-time">{telemetry.current?.source_time ?? '—'}</dd><dt>Mapping</dt><dd>{sensor.mapping_confidence}</dd><dt>근거</dt><dd>{sensor.mapping_basis}</dd><dt>원본값</dt><dd>{reading?.raw || '결측'}</dd></dl>
          <p className="note">화면 위치는 계통 탐색을 위한 논리 좌표입니다.</p>
          <SensorTrend key={sensor.tag} tag={sensor.tag} />
          <details className="related-tags"><summary>Related tags · {sensor.related_tags.length}</summary>{sensor.related_tags.map(tag => <button key={tag} onClick={() => setSelected(tag)}>{tag}</button>)}</details>
        </div> : <div className="empty-inspector"><span>⌖</span><h3>설비에서 센서를 선택하세요</h3><p>현재값과 원본 Tag, 위치 근거를 함께 확인합니다.</p></div>}
        <div className="sensor-browser"><label htmlFor="sensor-search">SENSOR DIRECTORY</label><input id="sensor-search" placeholder="Tag 검색…" value={filter} onChange={event => setFilter(event.target.value)} /><div className="sensor-list">{Object.values(registry?.sensors ?? {}).filter(sensor => sensor.label.includes(filter)).map(sensor => <button key={sensor.tag} onClick={() => setSelected(sensor.tag)} aria-pressed={selected === sensor.tag}><span>{sensor.label}</span><small>{sensor.equipment}</small></button>)}</div></div>
      </aside>
    </main>
    <section className="feed panel"><div className="panel-heading"><div><span className="eyebrow">LIVE OPERATIONS</span><h2>Telemetry activity</h2></div><div className="source-stamp"><span data-testid="source-time">{telemetry.current?.source_time ?? '데이터 대기'}</span><b>SEQ <span data-testid="sequence">{telemetry.current?.sequence ?? '—'}</span></b></div></div><div className="feed-rows">{events.slice(-5).reverse().map(event => <div key={`${event.run_id}-${event.sequence}`} className="feed-row"><span>● TELEMETRY</span><time>{event.source_time}</time><span>실제 출력값 <b>{formatValue(event.sensors['실제 출력값'])}</b></span><span>과열기 출구 <b>{formatValue(event.sensors['최종과열기 출구 온도 평균값'])}</b></span><code>#{event.sequence}</code></div>)}{events.length === 0 && <p className="quiet">Kafka에서 첫 이벤트를 기다리고 있습니다.</p>}</div></section>
    <OperationsAnalysis />
    <ForecastPanel />
    <AgentPanel key={sensor?.equipment ?? 'none'} equipment={sensor?.equipment ?? null} tag={sensor?.tag ?? null} />
    <footer>BOILEROPS / PUBLIC DATA REPLAY<span>관측 데이터 · 산업 안전 판정 없음</span></footer>
  </div>;
}
