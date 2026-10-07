from typing import Any, Literal, TypedDict

Intent = Literal['current', 'trend', 'target_gap', 'forecast', 'control', 'other']


class Evidence(TypedDict):
    id: str
    tool_id: str
    tool: str
    path: list[str]
    tag: str
    field: str
    value: Any
    source_time: str | None
    quality: str | None


def collect_evidence(call, selected_tag) -> list[Evidence]:
    result, name = call['result'], call['tool']
    entries = []

    def add(path, field, tag=selected_tag, quality=None):
        value = result
        for key in path:
            value = value[key]
        entries.append({'id': '', 'tool_id': call['id'], 'tool': name, 'path': path,
                        'tag': tag, 'field': field, 'value': value,
                        'source_time': result.get('source_time'), 'quality': quality})

    if name == 'get_equipment_status':
        reading = result['sensors'][selected_tag]
        add(['sensors', selected_tag, 'value'], '관측값', quality=reading['quality'])
    elif name == 'get_sensor_history':
        add(['points'], 'history')
    elif name == 'get_deviation_summary':
        add(['rate_per_source_minute'], 'rate_per_source_minute')
    elif name == 'get_operating_targets':
        add(['comparison'], 'target_comparison')
    elif name == 'get_current_controls':
        add(['control_policy'], 'control_policy')
        for tag, reading in result['sensors'].items():
            add(['sensors', tag, 'value'], '제어 관측값', tag, reading['quality'])
    elif name == 'get_temperature_forecast':
        for field in ('prediction', 'horizon_minutes', 'forecast_time', 'selected_model', 'test'):
            add([field], field, result['target'])
    return entries


def compose_answer(intents: list[Intent], evidence: list[Evidence], tag: str, status: str):
    conclusions, reasons, limits, gaps = [], [], [], []

    def find(tool, field):
        return next((item for item in evidence if item['tool'] == tool and item['field'] == field), None)

    def require(intent, *items):
        if all(item is not None for item in items):
            return True
        gaps.append(intent)
        conclusions.append({'current': '선택 센서의 현재값 근거가 부족해 답할 수 없습니다.',
                            'trend': '이력과 변화율 근거가 부족해 상승 여부를 판단할 수 없습니다.',
                            'target_gap': '선택 센서에 대응하는 목표 근거가 없어 차이를 계산할 수 없습니다.',
                            'forecast': '예측값과 시험 성능 근거가 부족해 신뢰도를 판단할 수 없습니다.',
                            'control': '밸브 조작량을 판단할 수 없습니다.'}[intent])
        return False

    def cite(*items):
        return ' '.join(f"[{item['id']}]" for item in items)

    def number(value):
        return format(value, '.6f').rstrip('0').rstrip('.') if isinstance(value, float) else str(value)

    for intent in dict.fromkeys(intents):
        if intent == 'current':
            current = find('get_equipment_status', '관측값')
            if not require(intent, current):
                continue
            label = '마지막 관측값' if status != 'LIVE' else '현재값'
            if current['value'] is None:
                problem = '파싱 오류(숫자 해석 실패)' if current['quality'] == 'parse_error' else '결측'
                conclusions.append(f'{tag}은 {problem}으로 값을 확인할 수 없습니다.')
            else:
                conclusions.append(f"{tag}의 {label}은 {number(current['value'])}입니다.")
            reasons.append(f"원본 시각 {current['source_time']}. {cite(current)}")
        elif intent == 'trend':
            history = find('get_sensor_history', 'history')
            rate = find('get_deviation_summary', 'rate_per_source_minute')
            if not require(intent, history):
                continue
            points = history['value']
            if len(points) < 2 or points[0]['value'] is None or points[-1]['value'] is None:
                conclusions.append('관측 이력이 부족하거나 구간 끝값이 결측·숫자 해석 오류여서 상승 여부를 판단할 수 없습니다.')
                reasons.append(f"조회된 이력 {len(points)}개. {cite(history)}")
                continue
            if not require(intent, rate):
                continue
            first, last = points[0], points[-1]
            delta = last['value'] - first['value']
            direction = '상승했습니다' if delta > 0 else '하락했습니다' if delta < 0 else '같습니다'
            conclusions.append(f'최근 {len(points)}개 관측의 처음과 끝을 비교하면 값이 {direction}.')
            reasons.append(f"{tag}: {first['source_time']}의 {number(first['value'])} → "
                           f"{last['source_time']}의 {number(last['value'])}. {cite(history)}")
            if rate['value'] is None:
                reasons.append(f'직전 값이 없거나 결측이어서 직전 관측 대비 변화율은 계산할 수 없습니다. {cite(rate)}')
            else:
                recent = '상승' if rate['value'] > 0 else '하락' if rate['value'] < 0 else '변화 없음'
                reasons.append(f"마지막 두 관측은 {recent}이며, 원본 시각 기준 분당 변화량은 {number(rate['value'])}입니다. {cite(rate)}")
            if any(point['value'] is None for point in points):
                limits.append('중간 결측 구간은 보간하지 않아 연속적인 변화 방향을 판단할 수 없습니다.')
            else:
                changes = [b['value'] - a['value'] for a, b in zip(points, points[1:])]
                if any(change > 0 for change in changes) and any(change < 0 for change in changes):
                    limits.append('구간 안에 상승과 하락이 섞여 있어 지속 상승·하락으로 단정할 수 없습니다.')
            limits.append('관측된 변화이며 원인이나 이후의 방향을 뜻하지 않습니다.')
        elif intent == 'target_gap':
            target = find('get_operating_targets', 'target_comparison')
            if not require(intent, target):
                continue
            comparison = target['value']
            if comparison is None or comparison['actual_tag'] != tag:
                conclusions.append('선택 센서와 목표값의 대응 관계가 미확인이어서 차이를 계산할 수 없습니다.')
            elif comparison['target_quality'] == 'parse_error' or comparison['actual_quality'] == 'parse_error':
                conclusions.append('관측값 또는 목표값에 파싱 오류(숫자 해석 실패)가 있어 차이를 계산할 수 없습니다.')
            elif comparison['target_value'] is None:
                conclusions.append(f"{comparison['target_tag']}가 결측이어서 목표 온도와의 차이를 계산할 수 없습니다.")
            elif comparison['actual_value'] is None:
                conclusions.append('선택 센서의 관측값이 결측이어서 목표값과의 차이를 계산할 수 없습니다.')
            else:
                difference = comparison['actual_value'] - comparison['target_value']
                conclusions.append(f'현재값에서 목표값을 뺀 차이는 {number(difference)}입니다.')
                reasons.append(f"관측값 {number(comparison['actual_value'])}, 목표값 {number(comparison['target_value'])}.")
            reasons.append(f"원본 시각 {target['source_time']}의 목표 대응·관측 결과. {cite(target)}")
            limits.append('결측 목표값을 0이나 임의의 기준으로 대체하지 않습니다.')
        elif intent == 'forecast':
            prediction, horizon, forecast_time, selected, evaluation = [find('get_temperature_forecast', field)
                for field in ('prediction', 'horizon_minutes', 'forecast_time', 'selected_model', 'test')]
            if not require(intent, prediction, horizon, forecast_time, selected, evaluation):
                continue
            test, chosen = evaluation['value'], selected['value']
            mae, naive = test[chosen]['mae'], test['naive']['mae']
            comparison = 'Naive보다 오차가 커 신뢰에 한계가 있습니다' if mae > naive else (
                'Naive와 오차가 같아 성능 개선이 확인되지 않았습니다' if mae == naive else 'Naive보다 평균 오차가 작았습니다')
            conclusions.append(f"{horizon['value']}분 뒤 예측값은 {number(prediction['value'])}입니다. 시험 구간에서는 {comparison}.")
            reasons.append(f"예측 대상은 {prediction['tag']}, 원본 시각 {prediction['source_time']}, "
                           f"예측 시각 {forecast_time['value']}. {cite(prediction, horizon, forecast_time)}")
            model_label = '선형 모델' if chosen == 'linear_ar' else 'Naive'
            reasons.append(f"선택된 {model_label}의 시험 MAE는 {number(mae)}, Naive는 {number(naive)}입니다. "
                           f"MAE는 평균 절대 오차이며 작을수록 좋습니다. Naive는 현재값을 그대로 예측하는 기준입니다. {cite(selected, evaluation)}")
            limits.append('시험 성능은 이번 예측이 맞을 확률이나 보장 범위가 아닙니다. 제어값 변경의 근거로 사용할 수 없습니다.')
        elif intent == 'control':
            policy = find('get_current_controls', 'control_policy')
            if require(intent, policy):
                conclusions.append('밸브를 얼마나 열어야 하는지 판단할 수 없습니다.')
                reasons.append(f'제어 인과관계와 허용 범위가 미확인입니다. {cite(policy)}')
                readings = [item for item in evidence if item['tool'] == 'get_current_controls' and '밸브' in item['tag']]
                for reading in readings[:1]:
                    value = '결측' if reading['value'] is None else number(reading['value'])
                    reasons.append(f"{reading['tag']}의 관측값은 {value}이며 조작 권고량이 아닙니다. "
                                   f"원본 시각 {reading['source_time']}. {cite(reading)}")
            limits.append('제어 효과·허용 범위를 확인할 수 없어 개도나 변경량을 권고하지 않으며 실제 설비를 조작하지 않습니다.')
        else:
            conclusions.append('이 질문에 대한 판단을 내릴 근거가 부족합니다.')
            limits.append('선택 센서의 현재값·추이·목표 차이·예측·제어 가능 여부를 질문해 주세요.')
    limits.append('원본 수치의 단위는 미확인입니다.')
    if status != 'LIVE':
        detail = {'STALE': '새 데이터 수신 지연', 'ERROR': '수신 오류', 'DISCONNECTED': '연결 끊김'}.get(status, '수신 상태 미확인')
        limits.insert(0, f'{status}({detail}) 상태의 마지막 관측입니다. 최신 수신값으로 단정할 수 없습니다.')
    return {'answer': '\n'.join(conclusions), 'explanation': '\n'.join(reasons),
            'limitations': ' '.join(dict.fromkeys(limits)), 'answer_gaps': gaps}
