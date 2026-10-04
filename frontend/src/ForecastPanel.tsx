import { useEffect, useState } from 'react';
import { useTelemetry } from './telemetry';

type Forecast = { target: string; prediction: number; input_value: number; selected_model: string; horizon_minutes: number; forecast_time: string; advisory: string; status: string; beats_naive_on_test: boolean; test: Record<string, { mae: number; rmse: number; samples: number }> };
export function ForecastPanel() {
  const telemetry = useTelemetry();
  const [data, setData] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/forecast', { signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.detail); return data; })
      .then(data => { setData(data); setError(null); }).catch(error => { if (error.name !== 'AbortError') { setError(String(error)); setData(null); } });
    return () => controller.abort();
  }, [telemetry.current?.run_id, telemetry.current?.sequence]);
  return <section className="analysis panel"><div className="panel-heading"><div><span className="eyebrow">TEMPERATURE FORECAST</span><h2>재열기 온도 · 5분 후 관측 예측</h2></div><span className="quiet">CONTROL ADVISORY</span></div><div className="analysis-content">{error && <p className="note" data-testid="forecast-unavailable">{error}</p>}{data && <><div className="analysis-stats"><span>{data.target}<b>{data.input_value.toFixed(2)}</b></span><span>예측값 · 단위 미확인<b data-testid="forecast-value">{data.prediction.toFixed(2)}</b></span><span>선택 모델<b>{data.selected_model}</b></span></div><p className="quiet">예측 시각 {data.forecast_time} · {telemetry.status}</p><table><thead><tr><th>Chronological test</th><th>MAE</th><th>RMSE</th><th>Samples</th></tr></thead><tbody>{Object.entries(data.test).map(([name, metric]) => <tr key={name}><td>{name}</td><td>{metric.mae.toFixed(4)}</td><td>{metric.rmse.toFixed(4)}</td><td>{metric.samples}</td></tr>)}</tbody></table><p className="note">{data.advisory}</p></>}</div></section>;
}
