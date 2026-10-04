import asyncio
import json
import logging
import uuid
import time

from aiokafka import AIOKafkaConsumer
from aiokafka.errors import KafkaError
from aiokafka.admin import AIOKafkaAdminClient
from aiokafka.structs import TopicPartition, OffsetAndMetadata

from backend.app.streaming.topic import ensure_topic

logger = logging.getLogger(__name__)


async def consume(settings, state, hub):
    group = f"boiler-monitor-{uuid.uuid4()}"
    while True:
        consumer = None
        admin = None
        try:
            await ensure_topic(settings)
            consumer = AIOKafkaConsumer(settings.topic, bootstrap_servers=settings.brokers,
                                        group_id=group, auto_offset_reset="earliest", enable_auto_commit=False,
                                        request_timeout_ms=5000, session_timeout_ms=6000,
                                        heartbeat_interval_ms=1000)
            await consumer.start()
            admin = AIOKafkaAdminClient(bootstrap_servers=settings.brokers, request_timeout_ms=2000)
            await admin.start()
            checked = 0
            state.kafka = "CONNECTED"
            while True:
                batches = await consumer.getmany(timeout_ms=500, max_records=50)
                if time.monotonic() - checked > 1:
                    await admin.describe_topics([settings.topic])
                    checked = time.monotonic()
                state.kafka = "CONNECTED"
                for messages in batches.values():
                    for message in messages:
                        try:
                            state.apply(json.loads(message.value), message.offset)
                        except (ValueError, TypeError, UnicodeDecodeError) as error:
                            state.rejected += 1
                            state.error = f"Rejected Kafka offset {message.offset}: {error}"
                            logger.error(state.error)
                        else:
                            await consumer.commit({TopicPartition(message.topic, message.partition): OffsetAndMetadata(message.offset + 1, "")})
                        await hub.publish(state.snapshot())
        except (KafkaError, OSError, ValueError) as error:
            state.kafka = "DISCONNECTED"
            state.error = f"Kafka consumer: {type(error).__name__}: {error}"
            logger.warning(state.error)
            await hub.publish(state.snapshot())
            await asyncio.sleep(1)
        finally:
            if admin is not None:
                await admin.close()
            if consumer is not None:
                await consumer.stop()
