from aiokafka.admin import AIOKafkaAdminClient
from backend.app.streaming.security import kafka_options


async def ensure_topic(settings, role="consumer"):
    admin = AIOKafkaAdminClient(bootstrap_servers=settings.brokers, request_timeout_ms=5000,
                               **kafka_options(role, settings.brokers))
    try:
        await admin.start()
        metadata = await admin.describe_topics([settings.topic])
        if metadata[0].get("error_code") or len(metadata[0]["partitions"]) != 1:
            raise ValueError("Initialize the authenticated telemetry topic with exactly one partition")
    finally:
        await admin.close()
