import type { Registry } from './types';

export function validateRegistry(value: Registry): Registry {
  if (!value || !Array.isArray(value.equipment) || !Array.isArray(value.flows) || !value.sensors || typeof value.sensors !== 'object') throw new Error('Registry contract is invalid');
  const equipment = new Set([...value.equipment.map(item => item.id), 'generation', 'unmapped']);
  for (const [tag, sensor] of Object.entries(value.sensors)) {
    if (sensor.tag !== tag || !equipment.has(sensor.equipment)) throw new Error(`Registry Tag Mapping 오류: ${tag}`);
    if (!['verified-by-tag', 'logical-group', 'unverified'].includes(sensor.mapping_confidence)) throw new Error(`Registry confidence 오류: ${tag}`);
    const position = sensor.scene_position;
    if (position !== null && (!Array.isArray(position) || position.length !== 3 || position.some(number => typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > 20))) throw new Error(`Sensor Scene Position 오류: ${tag}`);
    if (sensor.mapping_confidence === 'unverified' && position !== null) throw new Error(`Unverified sensor position 오류: ${tag}`);
    if (!Array.isArray(sensor.related_tags) || sensor.related_tags.some(other => !(other in value.sensors))) throw new Error(`Related Tag Mapping 오류: ${tag}`);
  }
  return value;
}
