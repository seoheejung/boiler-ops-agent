import argparse
import asyncio
import json
import uuid
from datetime import UTC, datetime

from aiokafka import AIOKafkaProducer

from backend.app.config import Settings
from backend.app.replay.csv_source import rows
from backend.app.streaming.topic import ensure_topic


async def replay(limit: int | None = None):
    settings = Settings.load()
    await ensure_topic(settings)
    producer = AIOKafkaProducer(bootstrap_servers=settings.brokers, enable_idempotence=True,
                               value_serializer=lambda value: json.dumps(value, ensure_ascii=False, allow_nan=False).encode())
    run_id = str(uuid.uuid4())
    await producer.start()
    try:
        for sequence, source_time, measurements in rows(settings):
            event = {"run_id": run_id, "sequence": sequence, "source_time": source_time,
                     "emitted_at": datetime.now(UTC).isoformat(), "measurements": measurements}
            await producer.send_and_wait(settings.topic, event, partition=0)
            print(json.dumps({key: event[key] for key in ("run_id", "sequence", "source_time")}), flush=True)
            if limit is not None and sequence >= limit:
                break
            await asyncio.sleep(settings.interval_ms / 1000)
    finally:
        await producer.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    asyncio.run(replay(args.limit))
