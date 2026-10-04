import asyncio


class Hub:
    def __init__(self):
        self.queues = set()

    async def publish(self, message):
        for queue in tuple(self.queues):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(message)

    def subscribe(self):
        queue = asyncio.Queue(maxsize=128)
        self.queues.add(queue)
        return queue

    def unsubscribe(self, queue):
        self.queues.discard(queue)
