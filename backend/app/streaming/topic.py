from aiokafka.admin import AIOKafkaAdminClient, NewTopic
from aiokafka.errors import TopicAlreadyExistsError


async def ensure_topic(settings):
    admin = AIOKafkaAdminClient(bootstrap_servers=settings.brokers, request_timeout_ms=5000)
    try:
        await admin.start()
        try:
            await admin.create_topics([NewTopic(settings.topic, num_partitions=1, replication_factor=1)])
        except TopicAlreadyExistsError:
            pass
        metadata = await admin.describe_topics([settings.topic])
        if len(metadata[0]["partitions"]) != 1:
            raise ValueError("Telemetry topic must have exactly one partition")
    finally:
        await admin.close()
