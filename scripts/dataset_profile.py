import hashlib
import json
import math
from collections import Counter

from backend.app.config import Settings
from backend.app.replay.csv_source import columns, rows


def profile():
    settings = Settings.load()
    header = columns(settings)
    missing, invalid = Counter(), Counter()
    first = []
    count = 0
    start, end = None, None
    for sequence, source_time, measurements in rows(settings):
        count += 1
        start = start or source_time
        end = source_time
        if settings.start_row <= sequence < settings.start_row + 16:
            first.append({"sequence": sequence - settings.start_row + 1, "source_row": sequence, "source_time": source_time, "measurements": measurements})
        for tag, raw in measurements.items():
            if not raw.strip():
                missing[tag] += 1
            else:
                try:
                    if not math.isfinite(float(raw)):
                        raise ValueError()
                except ValueError:
                    invalid[tag] += 1
    return {"dataset": settings.dataset.name, "sha256": hashlib.file_digest(settings.dataset.open('rb'), 'sha256').hexdigest(),
            "columns": header, "row_count": count, "source_start": start, "source_end": end,
            "missing": dict(missing), "invalid": dict(invalid), "first_rows": first}


if __name__ == '__main__':
    print(json.dumps(profile(), ensure_ascii=False))
