import csv
from datetime import datetime

from backend.app.config import Settings


def columns(settings: Settings) -> list[str]:
    with settings.dataset.open(encoding=settings.encoding, newline="") as source:
        header = next(csv.reader(source), [])
    if not header or any(not tag.strip() for tag in header) or len(set(header)) != len(header):
        raise ValueError("CSV header is empty or contains empty/duplicate tags")
    if settings.time_column not in header:
        raise ValueError(f"CSV time column missing: {settings.time_column}")
    return header


def rows(settings: Settings):
    header = columns(settings)
    previous = None
    with settings.dataset.open(encoding=settings.encoding, newline="") as source:
        reader = csv.reader(source)
        next(reader)
        for sequence, cells in enumerate(reader, 1):
            if len(cells) != len(header):
                raise ValueError(f"CSV row {sequence + 1}: expected {len(header)} columns, got {len(cells)}")
            values = dict(zip(header, cells, strict=True))
            source_time = values.pop(settings.time_column)
            try:
                instant = datetime.fromisoformat(source_time)
            except ValueError as error:
                raise ValueError(f"CSV row {sequence + 1}: invalid source time {source_time!r}") from error
            if previous is not None and instant <= previous:
                raise ValueError(f"CSV row {sequence + 1}: source time must increase")
            previous = instant
            yield sequence, source_time, values
