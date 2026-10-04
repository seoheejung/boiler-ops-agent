import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    dataset: Path
    interval_ms: int
    brokers: str
    topic: str
    encoding: str
    time_column: str
    stale_ms: int
    history_limit: int
    start_row: int

    @classmethod
    def load(cls):
        load_dotenv(override=False)
        required = ("BOILER_DATASET_PATH", "REPLAY_INTERVAL_MS", "KAFKA_BOOTSTRAP_SERVERS", "KAFKA_TOPIC")
        missing = [key for key in required if not os.getenv(key)]
        if missing:
            raise ValueError(f"Missing environment variables: {', '.join(missing)}")
        interval = int(os.environ["REPLAY_INTERVAL_MS"])
        stale = int(os.getenv("STALE_AFTER_MS", str(max(5000, interval * 3))))
        history = int(os.getenv("HISTORY_LIMIT", "3600"))
        start_row = int(os.getenv("REPLAY_START_ROW", "1"))
        if start_row < 1:
            raise ValueError("REPLAY_START_ROW must be positive")
        if interval < 1 or stale <= interval or not 10 <= history <= 100000:
            raise ValueError("Require interval >= 1, stale > interval, history in [10, 100000]")
        path = Path(os.environ["BOILER_DATASET_PATH"])
        if not path.is_file():
            raise ValueError(f"Dataset file does not exist: {path}")
        return cls(path, interval, os.environ["KAFKA_BOOTSTRAP_SERVERS"], os.environ["KAFKA_TOPIC"],
                   os.getenv("CSV_ENCODING", "utf-8-sig"), os.getenv("CSV_TIME_COLUMN", "일자"), stale, history, start_row)
