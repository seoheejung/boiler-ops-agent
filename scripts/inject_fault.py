import argparse
import asyncio
import csv
import json
import os
import sqlite3
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import Request, urlopen

from aiokafka import AIOKafkaProducer
from backend.app.streaming.security import kafka_options

from backend.app.config import Settings
from backend.app.replay.csv_source import rows, columns


async def telemetry_fault(mode):
    settings = Settings.load()
    with urlopen(Request('http://127.0.0.1:8000/api/state', headers={'Cookie': os.environ['E2E_SESSION_COOKIE']})) as response:
        state = json.load(response)['current']
    next_row = state['source_row'] + 1
    source = next(row for row in rows(settings) if row[0] == next_row)
    event = {"run_id": state['run_id'], "sequence": state['sequence'] + 1, "source_time": source[1],
             "source_row": source[0], "emitted_at": datetime.now(UTC).isoformat(), "measurements": source[2]}
    if mode == 'quality':
        event['measurements']['실제 출력값'] = ''
        event['measurements']['최종과열기 출구 온도 평균값'] = 'not-a-number'
    elif mode == 'duplicate':
        event['sequence'] = state['sequence']
    elif mode == 'reverse':
        event['sequence'] = state['sequence'] - 1
    elif mode == 'tag':
        event['measurements']['UNKNOWN_SENSOR'] = '42'
    producer = AIOKafkaProducer(bootstrap_servers=settings.brokers, **kafka_options("producer", settings.brokers), request_timeout_ms=10000)
    await producer.start()
    try:
        await producer.send_and_wait(settings.topic, json.dumps(event, ensure_ascii=False).encode(), partition=0)
    finally:
        await producer.stop()
    print(json.dumps(event, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['quality', 'duplicate', 'reverse', 'tag', 'valid', 'bad-csv', 'expire', 'corrupt-proposal'])
    parser.add_argument('--path')
    parser.add_argument('--id')
    args = parser.parse_args()
    if args.mode == 'bad-csv':
        settings = Settings.load()
        with Path(args.path).open('w', encoding='utf-8', newline='') as file:
            writer = csv.writer(file)
            writer.writerow(columns(settings))
            writer.writerow(['bad-time', 'too-few-columns'])
    elif args.mode in ('expire', 'corrupt-proposal'):
        with sqlite3.connect(os.environ['SIMULATOR_DB_PATH']) as db:
            payload = json.loads(db.execute('SELECT payload FROM proposals WHERE id=?', (args.id,)).fetchone()[0])
            if args.mode == 'expire':
                payload['expires_at'] = time.time() - 1
            else:
                payload['requested_value'] = 1000
            db.execute('UPDATE proposals SET payload=? WHERE id=?', (json.dumps(payload), args.id))
        print(json.dumps({"fault": args.mode, "proposal_id": args.id}))
    else:
        asyncio.run(telemetry_fault(args.mode))


if __name__ == '__main__':
    main()
