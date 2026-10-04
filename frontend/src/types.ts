export type Reading = { value: number | null; raw: string; quality: 'valid' | 'missing' | 'parse_error'; error: string | null };
export type Sensor = { tag: string; label: string; equipment: string; section: string; measurement_type: string; unit: string | null; mapping_confidence: string; scene_position: [number, number, number] | null; mapping_basis: string; representative: boolean };
export type Equipment = { id: string; label: string; position: [number, number, number]; size: [number, number, number] };
export type Registry = { sensors: Record<string, Sensor>; equipment: Equipment[]; position_basis: string };
export type Telemetry = { run_id: string; sequence: number; source_time: string; emitted_at: string; kafka_offset: number; sensors: Record<string, Reading> };
export type Snapshot = { type: 'telemetry'; current: Telemetry | null; status: string; stale: boolean; kafka: string; error: string | null; rejected_events: number; replay_interval_ms: number; stale_after_ms: number };
