import asyncio
import json
import os
from datetime import UTC, datetime
from urllib.request import Request, urlopen
from uuid import uuid4

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.errors import KafkaError
from backend.app.config import Settings
from backend.app.streaming.security import kafka_options


async def denied(client, operation):
    try:
        async with asyncio.timeout(12):
            await client.start()
            await operation(client)
    except (KafkaError, TimeoutError):
        return True
    finally:
        await client.stop()
    return False


async def main():
    settings = Settings.load()
    async def write(client):
        await client.send_and_wait(settings.topic, b'{}', partition=0)
    async def read(client):
        await client.getmany(timeout_ms=3000)
    results = {}
    results['anonymous_write_denied'] = await denied(AIOKafkaProducer(bootstrap_servers=settings.brokers, request_timeout_ms=3000), write)
    results['consumer_write_denied'] = await denied(AIOKafkaProducer(bootstrap_servers=settings.brokers, request_timeout_ms=3000, **kafka_options('consumer', settings.brokers)), write)
    results['producer_read_denied'] = await denied(AIOKafkaConsumer(settings.topic, bootstrap_servers=settings.brokers, group_id='boiler-monitor-probe', request_timeout_ms=3000, **kafka_options('producer', settings.brokers)), read)
    with urlopen(Request('http://127.0.0.1:8000/api/state', headers={'Cookie': os.environ['E2E_SESSION_COOKIE']})) as response:
        current = json.load(response)['current']
    captured = {'run_id': current['run_id'], 'sequence': 1, 'source_time': current['source_time'], 'source_row': current['source_row'], 'emitted_at': current['emitted_at'], 'measurements': {tag: reading['raw'] for tag, reading in current['sensors'].items()}}
    new = {**captured, 'run_id': str(uuid4()), 'emitted_at': datetime.now(UTC).isoformat()}
    producer = AIOKafkaProducer(bootstrap_servers=settings.brokers, **kafka_options('producer', settings.brokers))
    await producer.start()
    try:
        for event in (new, captured):
            await producer.send_and_wait(settings.topic, json.dumps(event).encode(), partition=0)
    finally:
        await producer.stop()
    results['new_run_id'] = new['run_id']
    print(json.dumps(results))


if __name__ == '__main__':
    asyncio.run(main())
