import { Component, memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera, Vector3 } from 'three';
import type { Equipment, Registry, Sensor } from './types';
import { formatValue, useReading, useTelemetry } from './telemetry';

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const EquipmentMesh = memo(function EquipmentMesh({ item, selected, onSelect }: { item: Equipment; selected: boolean; onSelect: () => void }) {
  const [x, , z] = item.position;
  const [w, h, d] = item.size;
  return <group position={[x, 0, z]} onClick={event => { event.stopPropagation(); onSelect(); }}>
    <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
      {item.id === 'stack' ? <cylinderGeometry args={[w / 2, w / 2 + .12, h, 24]} /> : <boxGeometry args={[w, h, d]} />}
      <meshStandardMaterial color={selected ? '#dea04f' : item.id === 'furnace' ? '#778d85' : '#a9b7b0'} roughness={.85} />
    </mesh>
    {[.2, .5, .8].map(fraction => <mesh key={fraction} position={[0, h * fraction, 0]}>
      <boxGeometry args={[w + .06, .075, d + .06]} /><meshStandardMaterial color="#4f655d" />
    </mesh>)}
    <mesh position={[0, .06, 0]}><boxGeometry args={[w + .6, .12, d + .6]} /><meshStandardMaterial color="#d1d8d2" /></mesh>
  </group>;
});

function Marker({ sensor, selected, onSelect }: { sensor: Sensor; selected: boolean; onSelect: () => void }) {
  const reading = useReading(sensor.tag);
  return <mesh position={sensor.scene_position!} onClick={event => { event.stopPropagation(); onSelect(); }}>
    <sphereGeometry args={[selected ? .17 : .12, 12, 12]} />
    <meshBasicMaterial color={reading?.quality === 'valid' ? selected ? '#b56519' : '#185d48' : '#7e8580'} />
  </mesh>;
}

function MarkerLabel({ sensor, selected, onSelect, point }: { sensor: Sensor; selected: boolean; onSelect: () => void; point: [number, number] }) {
  const reading = useReading(sensor.tag);
  return <button className={`scene-marker ${selected ? 'selected' : ''}`} data-testid={`marker-${sensor.tag}`} aria-label={`센서 ${sensor.tag} · ${sensor.equipment.toUpperCase()} · ${formatValue(reading)}`} aria-pressed={selected} onClick={onSelect} style={{ left: point[0], top: point[1] }} title={`${sensor.tag} · ${sensor.mapping_confidence}`}>
    <span>{sensor.equipment.toUpperCase()}</span><b>{formatValue(reading)}</b>
  </button>;
}

export function BoilerViewport({ registry, selected, onSelect, onEquipment }: { registry: Registry; selected: string | null; onSelect: (tag: string) => void; onEquipment: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 510 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [lost, setLost] = useState(false);
  const telemetry = useTelemetry();
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  const camera = useMemo(() => {
    const camera = new OrthographicCamera(-size.width / 2, size.width / 2, size.height / 2, -size.height / 2, .1, 100);
    camera.position.set(14 + pan, 12, 17); camera.lookAt(pan, 1.7, 0);
    camera.zoom = Math.min(size.width / 23, size.height / 12) * zoom;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(); return camera;
  }, [size, zoom, pan]);
  const markers = useMemo(() => registry.equipment.flatMap(item => {
    const chosen = registry.sensors[selected ?? ''];
    const sensor = chosen?.equipment === item.id && chosen.scene_position ? chosen : Object.values(registry.sensors).find(sensor => sensor.equipment === item.id && sensor.scene_position && sensor.representative);
    return sensor ? [sensor] : [];
  }), [registry, selected]);
  const fallback = <div className="fallback"><b>3D VIEW UNAVAILABLE</b><p>설비 목록에서 센서를 선택할 수 있습니다.</p><span>{telemetry.status} · Kafka {telemetry.kafka}</span></div>;
  return <section className="viewport panel" aria-label="보일러 계통도">
    <div className="panel-heading"><div><span className="eyebrow">PLANT OVERVIEW</span><h2>Boiler operations</h2></div><span className="quiet">논리 계통도 · 실제 설비 좌표 아님</span></div>
    <p className="note scene-help">계통도와 동일한 설비를 아래 설비 선택 버튼에서 Tab과 Enter로 선택할 수 있습니다.</p><div className="scene" ref={box}>
      {lost ? fallback : <SceneBoundary fallback={fallback}><Canvas camera={camera} shadows frameloop="demand" fallback={fallback} onCreated={({ gl }) => { gl.domElement.setAttribute('aria-hidden', 'true'); gl.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); setLost(true); }); }}>
        <color attach="background" args={['#edf0eb']} /><ambientLight intensity={1.5} /><directionalLight position={[5, 12, 6]} intensity={2} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.04, 0]} receiveShadow><planeGeometry args={[24, 15]} /><meshStandardMaterial color="#e5e9e2" /></mesh>
        <gridHelper args={[24, 24, '#c7d1c6', '#d9e0d6']} />
        {registry.equipment.map(item => <EquipmentMesh key={item.id} item={item} selected={registry.sensors[selected ?? '']?.equipment === item.id} onSelect={() => onEquipment(item.id)} />)}
        {markers.map(sensor => <Marker key={sensor.tag} sensor={sensor} selected={selected === sensor.tag} onSelect={() => onSelect(sensor.tag)} />)}
      </Canvas></SceneBoundary>}
      {!lost && <div className="marker-layer">{markers.map(sensor => {
        const vector = new Vector3(...sensor.scene_position!).project(camera);
        return <MarkerLabel key={sensor.tag} sensor={sensor} selected={selected === sensor.tag} onSelect={() => onSelect(sensor.tag)} point={[(vector.x + 1) * size.width / 2, (-vector.y + 1) * size.height / 2]} />;
      })}</div>}
      <div className="scene-tools"><button disabled={zoom <= .8} aria-label="축소" onClick={() => setZoom(value => Math.max(.8, value - .1))}>−</button><span>{Math.round(zoom * 100)}%</span><button disabled={zoom >= 1.3} aria-label="확대" onClick={() => setZoom(value => Math.min(1.3, value + .1))}>+</button><button disabled={pan <= -2} aria-label="왼쪽 이동" onClick={() => setPan(value => Math.max(-2, value - .5))}>←</button><button disabled={pan >= 2} aria-label="오른쪽 이동" onClick={() => setPan(value => Math.min(2, value + .5))}>→</button><button onClick={() => { setZoom(1); setPan(0); }}>Reset</button></div>
      <div className="scene-caption">ISOMETRIC VIEW <span>01 / BOILER SYSTEMS</span></div>
    </div>
    <nav className="equipment-nav" aria-label="설비 선택">{registry.equipment.map((item, index) => <button key={item.id} aria-pressed={registry.sensors[selected ?? ""]?.equipment === item.id} onClick={() => onEquipment(item.id)}><span>{String(index + 1).padStart(2, '0')}</span>{item.label}</button>)}</nav>
    <div className="process-flows">{registry.flows.map(flow => <div key={flow.id}><span>{flow.label}</span><small>{flow.equipment.join(' → ')}</small></div>)}</div>
  </section>;
}
