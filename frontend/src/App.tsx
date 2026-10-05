import { useCallback, useEffect, useState } from 'react';
import { BoilerViewport } from './BoilerScene';
import { connectTelemetry, formatValue, toggleUpdates, usePaused, useConnection, useEvents, useReading, useTelemetry } from './telemetry';
import type { Registry, Sensor } from './types';
import { SensorTrend } from './SensorTrend';
import { OperationsAnalysis } from './OperationsAnalysis';
import { AgentPanel } from './AgentPanel';
import { ForecastPanel } from './ForecastPanel';
import { SimulatorPanel } from './SimulatorPanel';
import { validateRegistry } from './registry';

function KPI({ sensor, onSelect }: { sensor: Sensor; onSelect: () => void }) {
  const value = useReading(sensor.tag);
  return <button className="kpi" onClick={onSelect}><span>{sensor.label}</span><strong data-testid={`kpi-${sensor.tag}`}>{formatValue(value)}</strong><small>{sensor.unit ?? '단위 미확인'}</small></button>;
}

export default function App() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [agentTrace, setAgentTrace] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const paused = usePaused();
  const telemetry = useTelemetry();
  const connection = useConnection();
  const events = useEvents();
  useEffect(() => connectTelemetry(), []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/registry', { signal: controller.signal }).then(response => { if (!response.ok) throw new Error(`Registry HTTP ${response.status}`); return response.json(); })
      .then(validateRegistry).then(setRegistry).catch(error => { if (error.name !== 'AbortError') setError(String(error)); });
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
    <a className="skip-link" href="#main">본문으로 건너뛰기</a>
    <header className="topbar"><a href="/" className="brand" aria-label="BoilerOps Agent 홈"><span className="brand-mark" aria-hidden="true">B</span>BoilerOps <span>AGENT</span></a><div className="workspace-label">OPERATIONS WORKSPACE <b>한국중부발전 · 공개 운전데이터</b></div><span className={`status ${status.toLowerCase()}`} data-testid="stream-status" role="status">● {status}</span><button id="menu-toggle" className="menu-toggle" aria-expanded={menuOpen} aria-controls="page-nav" onClick={() => setMenuOpen(!menuOpen)}>메뉴</button></header>
    <nav id="page-nav" className={`page-nav ${menuOpen ? 'open' : ''}`} aria-label="페이지 메뉴" onKeyDown={event => { if (event.key === 'Escape') { setMenuOpen(false); document.getElementById('menu-toggle')?.focus(); } }}>
      {[['monitoring', '모니터링'], ['analysis', '운전 분석'], ['forecast', '온도 예측'], ['agent', 'AI Agent'], ['simulator', 'Simulator']].map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => { setMenuOpen(false); document.getElementById(id)?.focus(); }}>{label}</a>)}
    </nav>
    <main id="main" tabIndex={-1}>
    <div className="page-heading"><div><span className="eyebrow">REALTIME MONITORING</span><h1>운전 현황 <span>Historical replay</span></h1></div><div className="connections"><span>Kafka <b data-testid="kafka-status">{telemetry.kafka}</b></span><span>WebSocket <b data-testid="ws-status">{connection}</b></span><span>Replay <b>{telemetry.replay_interval_ms || '—'} ms</b></span></div></div>
    {(error || telemetry.error) && <div role="alert" className="error-banner">{error || telemetry.error}</div>}
    {telemetry.stale && <div className="stale-banner">STALE · 최신 데이터 수신을 기다리고 있습니다. 마지막 관측값을 표시합니다.</div>}
    <div className="update-controls"><button onClick={toggleUpdates} aria-pressed={paused}>화면 자동 갱신 {paused ? '재개' : '일시정지'}</button><span role="status">{paused ? '표시를 고정했습니다. 연결 상태와 서버 처리는 계속됩니다. 분석·예측 조회는 고정되지 않습니다.' : '화면 자동 갱신 중'}</span></div>
    <div className="kpi-bar">{kpis.map(sensor => <KPI key={sensor.tag} sensor={sensor} onSelect={() => setSelected(sensor.tag)} />)}</div>
    <section id="monitoring" tabIndex={-1} className="monitor-grid" aria-label="실시간 모니터링">
      {registry ? <BoilerViewport registry={registry} selected={selected} onSelect={setSelected} onEquipment={onEquipment} /> : <div className="panel loading" role="status">{error ? '설비 목록을 불러오지 못했습니다. 연결을 확인하고 페이지를 새로고침하세요.' : '설비 메타데이터 불러오는 중…'}</div>}
      <aside className="inspector panel" aria-label="센서 상세"><div className="panel-heading"><div><span className="eyebrow">EQUIPMENT INSPECTOR</span><h2>{sensor ? sensor.equipment : 'Sensor details'}</h2></div><span className="inspector-icon">↗</span></div>
        {sensor ? <div className="sensor-detail"><span className="tag-kind">{sensor.measurement_type}</span><h3 data-testid="inspector-tag">{sensor.tag}</h3><div className="current-value" data-testid="inspector-value">{formatValue(reading ?? undefined)}</div><div className="quiet">{sensor.unit ?? '단위 미확인'} · {reading?.quality ?? '대기 중'}</div>
          <dl><dt>Source time</dt><dd data-testid="inspector-time">{telemetry.current?.source_time ?? '—'}</dd><dt>Mapping</dt><dd>{sensor.mapping_confidence}</dd><dt>근거</dt><dd>{sensor.mapping_basis}</dd><dt>원본값</dt><dd>{reading?.raw || '결측'}</dd></dl>
          <p className="note">화면 위치는 계통 탐색을 위한 논리 좌표입니다.</p>
          <SensorTrend key={sensor.tag} tag={sensor.tag} />
          <details className="related-tags"><summary>Related tags · {sensor.related_tags.length}</summary>{sensor.related_tags.map(tag => <button key={tag} onClick={() => setSelected(tag)}>{tag}</button>)}</details>
        </div> : <div className="empty-inspector"><span>⌖</span><h3>설비에서 센서를 선택하세요</h3><p>현재값과 원본 Tag, 위치 근거를 함께 확인합니다.</p></div>}
        <div className="sensor-browser"><label htmlFor="sensor-search">센서 Tag 검색</label><input id="sensor-search" type="search" value={filter} onChange={event => setFilter(event.target.value)} /><p className="sr-only" role="status">{Object.values(registry?.sensors ?? {}).filter(sensor => sensor.label.includes(filter)).length}개 센서 · {sensor ? `${sensor.tag} 선택됨` : '선택 없음'}</p><div className="sensor-list">{Object.values(registry?.sensors ?? {}).filter(sensor => sensor.label.includes(filter)).map(sensor => <button key={sensor.tag} onClick={() => setSelected(sensor.tag)} aria-pressed={selected === sensor.tag}><span>{sensor.label}</span><small>{sensor.equipment}</small></button>)}</div></div>
      </aside>
    </section>
    <section className="feed panel"><div className="panel-heading"><div><span className="eyebrow">LIVE OPERATIONS</span><h2>Telemetry activity</h2></div><div className="source-stamp"><span data-testid="source-time">{telemetry.current?.source_time ?? '데이터 대기'}</span><b>SEQ <span data-testid="sequence">{telemetry.current?.sequence ?? '—'}</span></b></div></div><div className="feed-rows">{events.slice(-5).reverse().map(event => <div key={`${event.run_id}-${event.sequence}`} className="feed-row"><span>● TELEMETRY</span><time>{event.source_time}</time><span>실제 출력값 <b>{formatValue(event.sensors['실제 출력값'])}</b></span><span>과열기 출구 <b>{formatValue(event.sensors['최종과열기 출구 온도 평균값'])}</b></span><code>#{event.sequence}</code></div>)}{events.length === 0 && <p className="quiet">Kafka에서 첫 이벤트를 기다리고 있습니다.</p>}</div></section>
    <OperationsAnalysis />
    <ForecastPanel />
    <AgentPanel key={sensor?.equipment ?? 'none'} equipment={sensor?.equipment ?? null} tag={sensor?.tag ?? null} onTrace={setAgentTrace} />
    <SimulatorPanel agentTrace={sensor?.equipment === 'reheater' ? agentTrace : null} />
    </main>
    <footer><span>© {new Date().getFullYear()} BoilerOps Agent · 공개 데이터 재생</span><a href="#main">본문 처음으로</a><a href="#simulator">Simulator 승인 안내</a><span>관측 데이터 · 산업 안전 판정 없음</span></footer>
  </div>;
}
