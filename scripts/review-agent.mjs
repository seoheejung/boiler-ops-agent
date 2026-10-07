import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const questions = [
  ['current', '선택한 센서의 현재값은?'],
  ['trend', '최근 온도가 상승하고 있나요?'],
  ['target_gap', '목표 온도와 얼마나 차이 나나요?'],
  ['forecast', '5분 예측은 얼마나 믿을 수 있나요?'],
  ['control', '밸브를 얼마나 열어야 하나요?'],
];

function assess(entry, profile, model) {
  const { answer, trace, intent } = entry;
  const text = [answer.answer, answer.explanation ?? '', answer.limitations].join('\n');
  const value = Number(profile.first_rows.at(-1).measurements[model.target]);
  const sourceTime = profile.first_rows.at(-1).source_time;
  const tools = trace.calls.map(call => call.tool);
  const checks = {};
  const includes = number => [...text.matchAll(/-?\d+(?:\.\d+)?/g)].some(match => Math.abs(Number(match[0]) - number) <= 0.00000051);
  if (intent === 'current') {
    checks.selected_sensor = text.includes(model.target) && includes(value);
    checks.source_time = text.includes(sourceTime);
    checks.current_evidence = answer.evidence.some(item => item.tag === model.target && item.value === value);
  } else if (intent === 'trend') {
    checks.history_and_rate = ['get_sensor_history', 'get_deviation_summary'].every(tool => tools.includes(tool));
    const first = profile.first_rows[0], previous = profile.first_rows.at(-2), last = profile.first_rows.at(-1);
    const delta = value - Number(first.measurements[model.target]);
    const rate = (value - Number(previous.measurements[model.target])) / ((Date.parse(last.source_time) - Date.parse(previous.source_time)) / 60000);
    checks.observed_direction = text.includes(delta > 0 ? '상승' : delta < 0 ? '하락' : '같습니다');
    checks.window = text.includes(first.source_time) && text.includes(last.source_time);
    checks.rate = text.includes('분당') && includes(rate);
  } else if (intent === 'target_gap') {
    checks.target_missing = text.includes('목표 재열기 온도') && /결측/.test(text);
    checks.cannot_calculate = /계산할 수 없/.test(text);
  } else if (intent === 'forecast') {
    const prediction = model.selected === 'naive' ? value : model.intercept + model.slope * value;
    checks.prediction = includes(prediction);
    checks.test_comparison = /Naive보다 오차가 커/.test(text) && includes(model.test[model.selected].mae) && includes(model.test.naive.mae);
    checks.mae_explained = /평균 절대 오차/.test(text);
    checks.no_probability_claim = /확률.*아닙니다/.test(text);
  } else if (intent === 'control') {
    checks.cannot_recommend = /밸브.*판단할 수 없/.test(text);
    checks.boundary = /인과관계.*허용 범위.*미확인/.test(text);
    checks.control_tool = tools.includes('get_current_controls');
  }
  return checks;
}

function verifySource(entry, profile, model) {
  for (const call of entry.trace.calls) {
    if (call.tool === 'get_sensor_history') {
      assert.equal(call.result.points.length, profile.first_rows.length);
      call.result.points.forEach((point, index) => {
        const row = profile.first_rows[index];
        assert.equal(point.source_time, row.source_time);
        assert.equal(point.raw, row.measurements[model.target]);
      });
    } else if (call.tool === 'get_deviation_summary') {
      const rows = profile.first_rows, last = rows.at(-1), previous = rows.at(-2);
      const rate = (Number(last.measurements[model.target]) - Number(previous.measurements[model.target])) /
        ((Date.parse(last.source_time) - Date.parse(previous.source_time)) / 60000);
      assert.equal(call.result.rate_per_source_minute, rate);
    } else if (call.tool === 'get_operating_targets') {
      assert.equal(profile.first_rows.at(-1).measurements['목표 재열기 온도'].trim(), '');
      assert.equal(call.result.sensors['목표 재열기 온도'].value, null);
    } else if (call.tool === 'get_temperature_forecast') {
      assert.equal(call.result.dataset_sha256, profile.sha256);
      assert.deepEqual(call.result.test, model.test);
      const input = Number(profile.first_rows.at(-1).measurements[model.target]);
      assert.equal(call.result.prediction, model.selected === 'naive' ? input : model.intercept + model.slope * input);
      const sourceClock = Date.parse(profile.first_rows.at(-1).source_time + 'Z');
      assert.equal(call.result.forecast_time, new Date(sourceClock + 5 * 60000).toISOString().replace('.000Z', ''));
    }
  }
}

export async function reviewAgentQuestions({ page, apiFetch, out, profile, forecastModel, mode, poll, env, root, python, restartForStale }) {
  const tag = forecastModel.target;
  const report = { mode, started_at: new Date().toISOString(), input_sha256: profile.sha256,
    start_row: forecastModel.test_start_row, tag, model: null, questions: [], passed: false };
  const save = () => writeFileSync(resolve(out, 'questions.json'), JSON.stringify(report, null, 2));
  try {
    await page.getByRole('button', { name: `센서 ${tag}`, exact: false }).click();
    await poll(async () => await page.getByTestId('sequence').textContent() === '16', 'agent review source sequence');
    for (const [intent, question] of questions) {
      const entry = { intent, question, request: { question, equipment: 'reheater', tag } };
      report.questions.push(entry);
      await page.getByLabel('질문', { exact: true }).fill(question);
      const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/agent/query'), { timeout: 360000 });
      const started = performance.now();
      await page.getByRole('button', { name: 'Agent 조회', exact: true }).click();
      const response = await responsePromise;
      entry.elapsed_ms = Math.round(performance.now() - started);
      entry.http_status = response.status();
      entry.answer = await response.json();
      save();
      assert.equal(response.status(), 200, JSON.stringify(entry.answer));
      report.model = entry.answer.model;
      const traceResponse = await apiFetch(`http://127.0.0.1:8000/api/agent/traces/${entry.answer.trace_id}`);
      assert.equal(traceResponse.status, 200);
      entry.trace = await traceResponse.json();
      for (const evidence of entry.answer.evidence) {
        const call = entry.trace.calls.find(call => call.id === evidence.tool_id);
        assert.ok(call, 'Evidence call exists');
        let value = call.result;
        for (const key of evidence.path) value = value[key];
        assert.deepEqual(value, evidence.value, 'Evidence matches actual tool output');
      }
      const currentCall = entry.trace.calls.find(call => call.tool === 'get_equipment_status');
      const source = profile.first_rows.at(-1);
      assert.equal(currentCall.result.source_time, source.source_time);
      for (const [sensor, reading] of Object.entries(currentCall.result.sensors)) {
        assert.equal(reading.raw, source.measurements[sensor]);
        assert.equal(reading.value, source.measurements[sensor].trim() === '' ? null : Number(source.measurements[sensor]));
      }
      await page.getByTestId('agent-answer').waitFor();
      entry.displayed_text = await page.getByTestId('agent-answer').innerText();
      assert.ok(entry.displayed_text.includes(entry.answer.answer), 'Browser displays server answer');
      assert.ok(entry.displayed_text.includes(entry.answer.limitations), 'Browser displays limitations');
      verifySource(entry, profile, forecastModel);
      entry.semantic_checks = assess(entry, profile, forecastModel);
      entry.semantic_passed = Object.values(entry.semantic_checks).every(Boolean);
      if (mode === 'improved') {
        assert.ok(entry.displayed_text.includes(entry.answer.explanation), 'Browser displays evidence explanation');
        assert.deepEqual(entry.answer.intents, [intent], 'Question classified correctly');
        assert.deepEqual(entry.trace.answer_gaps, [], 'No missing required evidence');
        assert.deepEqual(entry.answer.evidence.map(item => item.id), [...new Set(entry.trace.model_findings.evidence_ids)], 'Server preserves model evidence selection');
        const cited = [...(entry.answer.explanation.matchAll(/\[(e\d+)\]/g))].map(match => match[1]);
        assert.ok(cited.length > 0 && cited.every(id => entry.answer.evidence.some(item => item.id === id)), 'Every citation references selected evidence');
        assert.ok(entry.trace.elapsed_ms > 0);
        await page.setViewportSize({ width: 320, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile answer fits viewport');
        await page.locator('#agent').screenshot({ path: resolve(out, `${intent}-mobile.png`) });
        await page.setViewportSize({ width: 1500, height: 1100 });
      }
      await page.locator('#agent').screenshot({ path: resolve(out, `${intent}.png`) });
      if (mode === 'improved' && intent === 'forecast') {
        await page.locator('#agent').screenshot({ path: resolve(out, 'forecast-answer.jpg'), type: 'jpeg', quality: 78 });
      }
      entry.evidence_verified = true;
      save();
      console.log(`RECORDED ${intent}: ${entry.elapsed_ms} ms`);
    }
    if (mode === 'improved') {
      const baselinePath = resolve(out, '../baseline/questions.json');
      if (existsSync(baselinePath)) {
        const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
        assert.equal(baseline.input_sha256, report.input_sha256);
        assert.equal(baseline.start_row, report.start_row);
        assert.equal(baseline.model, report.model);
        report.comparison = questions.map(([intent]) => {
          const before = baseline.questions.find(entry => entry.intent === intent);
          const after = report.questions.find(entry => entry.intent === intent);
          return { intent, before_ms: before.elapsed_ms, after_ms: after.elapsed_ms,
            before_checks: assess(before, profile, forecastModel), after_checks: after.semantic_checks };
        });
      } else {
        report.comparison = null;
        report.comparison_note = 'No baseline artifact; current answers are verified independently.';
      }
      save();
      assert.ok(report.questions.every(entry => entry.semantic_passed), 'Every answer meets the five question criteria');
      report.edge_cases = [];
      async function edge(name, sensor, question, verify) {
        await page.getByLabel('센서 Tag 검색', { exact: true }).fill(sensor);
        await page.getByRole('complementary', { name: '센서 상세' }).getByRole('button', { name: sensor, exact: false }).click();
        await page.getByLabel('질문', { exact: true }).fill(question);
        const pending = page.waitForResponse(response => response.url().endsWith('/api/agent/query'), { timeout: 360000 });
        const started = performance.now();
        await page.getByRole('button', { name: 'Agent 조회', exact: true }).click();
        const response = await pending;
        const answer = await response.json();
        assert.equal(response.status(), 200, JSON.stringify(answer));
        const trace = await (await apiFetch(`http://127.0.0.1:8000/api/agent/traces/${answer.trace_id}`)).json();
        const entry = { name, question, sensor, elapsed_ms: Math.round(performance.now() - started), answer, trace, passed: false };
        report.edge_cases.push(entry);
        save();
        await page.getByTestId('agent-answer').waitFor();
        assert.ok((await page.getByTestId('agent-answer').innerText()).includes(answer.answer));
        verify(answer, trace);
        await page.locator('#agent').screenshot({ path: resolve(out, `${name}.png`) });
        entry.passed = true;
        save();
        console.log(`PASS agent ${name}`);
      }
      await edge('missing-current', '목표 재열기 온도', '선택한 센서의 현재값은?', answer => {
        assert.match(answer.answer, /결측.*확인할 수 없/);
        assert.ok(answer.evidence.some(item => item.tag === '목표 재열기 온도' && item.value === null));
      });
      await edge('unmapped-target', '저온 재열기 압력', '선택 센서와 목표값은 얼마나 차이 나나요?', answer => {
        assert.match(answer.answer, /대응 관계.*미확인.*계산할 수 없/);
      });
      execFileSync(python, ['-m', 'backend.app.replay.producer', '--limit', '1'], { cwd: root, env, stdio: 'pipe', windowsHide: true });
      await poll(async () => (await (await apiFetch('http://127.0.0.1:8000/api/state')).json()).current?.sequence === 1, 'single observation run');
      await edge('short-history', tag, '최근 온도가 상승하고 있나요?', (answer, trace) => {
        assert.equal(trace.calls.find(call => call.tool === 'get_sensor_history').result.points.length, 1);
        assert.match(answer.answer, /이력이 부족.*판단할 수 없/);
      });
      const fault = JSON.parse(execFileSync(python, ['-m', 'scripts.inject_fault', 'quality'], { cwd: root, env, encoding: 'utf8', windowsHide: true }));
      report.quality_input = fault;
      await poll(async () => (await (await apiFetch('http://127.0.0.1:8000/api/state')).json()).current?.sequence === 2, 'quality fault observation');
      await edge('parse-error', '최종과열기 출구 온도 평균값', '선택한 센서의 현재값은?', answer => {
        assert.match(answer.answer, /파싱 오류.*확인할 수 없/);
        assert.ok(answer.evidence.some(item => item.quality === 'parse_error' && item.value === null));
      });
      report.target_quality_input = JSON.parse(execFileSync(python, ['-m', 'scripts.inject_fault', 'target-quality'], { cwd: root, env, encoding: 'utf8', windowsHide: true }));
      await poll(async () => (await (await apiFetch('http://127.0.0.1:8000/api/state')).json()).current?.sequence === 3, 'target quality fault');
      await edge('target-parse-error', tag, '목표 온도와 얼마나 차이 나나요?', answer => {
        assert.match(answer.answer, /파싱 오류.*계산할 수 없/);
        assert.ok(answer.evidence.some(item => item.field === 'target_comparison' && item.value.target_quality === 'parse_error'));
      });
      await restartForStale();
      await poll(async () => (await (await apiFetch('http://127.0.0.1:8000/api/state')).json()).status === 'STALE', 'stale answer source');
      await edge('stale-current', tag, '선택한 센서의 현재값은?', answer => {
        assert.equal(answer.status, 'STALE');
        assert.match(answer.answer, /마지막 관측값/);
        assert.match(answer.limitations, /STALE.*최신 수신값으로 단정할 수 없/);
      });
    }
    report.passed = true;
  } finally {
    report.finished_at = new Date().toISOString();
    save();
  }
}
