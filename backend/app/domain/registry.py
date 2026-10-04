EQUIPMENT = [
    {"id": "feeders", "label": "Feeders", "position": [-6, 0, 1], "size": [1.6, 1.7, 2.4]},
    {"id": "furnace", "label": "Furnace", "position": [-3, 0, 0], "size": [2.3, 5.4, 2.5]},
    {"id": "superheater", "label": "Superheater", "position": [0, 0, -0.4], "size": [1.9, 4.1, 2]},
    {"id": "reheater", "label": "Reheater", "position": [0.1, 0, 2.3], "size": [1.6, 2.8, 1.4]},
    {"id": "economizer", "label": "Economizer", "position": [2.7, 0, -0.2], "size": [1.8, 3.2, 2]},
    {"id": "scr", "label": "SCR", "position": [5.2, 0, -0.3], "size": [1.6, 2.4, 1.8]},
    {"id": "stack", "label": "Stack", "position": [7.6, 0, -0.5], "size": [0.9, 5.2, 0.9]},
]

REPRESENTATIVE = {
    "실제 출력값": ("generation", "logical-group"),
    "목표 발전량": ("generation", "logical-group"),
    "총 주증기 유량": ("superheater", "logical-group"),
    "터빈용 주증기 압력": ("superheater", "logical-group"),
    "최종과열기 출구 온도 평균값": ("superheater", "verified-by-tag"),
    "배기가스 산소 중간값": ("stack", "logical-group"),
    "과열기 스프레이 총 유량": ("superheater", "logical-group"),
    "굴뚝용 질소산화물 분석기": ("stack", "verified-by-tag"),
    "급탄기 A 속도 평균값 ": ("feeders", "verified-by-tag"),
    "노내 상부 좌측부 튜브 헤더 출구 온도 평균값": ("furnace", "verified-by-tag"),
    "절탄기 입구 급수 온도 중간값": ("economizer", "verified-by-tag"),
    "최종재열기 입구 온도 평균값": ("reheater", "verified-by-tag"),
    "선택적 촉매 환원장치A 배기가스 입구 온도 평균값": ("scr", "verified-by-tag"),
}


def make_registry(tags: list[str]):
    equipment_by_id = {item["id"]: item for item in EQUIPMENT}
    result = {}
    for tag in tags:
        equipment, confidence = REPRESENTATIVE.get(tag, ("unmapped", "unverified"))
        item = equipment_by_id.get(equipment)
        position = None if item is None else [item["position"][0], item["size"][1] + .4, item["position"][2]]
        result[tag] = {"tag": tag, "label": tag.strip(), "equipment": equipment, "section": equipment,
                       "measurement_type": "target" if tag.startswith("목표") else "measurement",
                       "unit": None, "mapping_confidence": confidence, "scene_position": position,
                       "mapping_basis": f"CSV column: {tag}" if confidence != "unverified" else "미확인",
                       "representative": tag in REPRESENTATIVE}
    return result
