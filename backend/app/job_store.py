"""
Clip2Guide – Gemeinsamer Job-Speicher
asyncio.Queue-Instanzen pro job_id fuer WebSocket-Events.
"""
import asyncio
from typing import Dict

# job_id -> asyncio.Queue mit JobEvent-Dicts
job_queues: Dict[str, asyncio.Queue] = {}


async def send_event(job_id: str, event: dict) -> None:
    """Event in die Queue des Jobs legen (no-op wenn Queue nicht (mehr) existiert)."""
    queue = job_queues.get(job_id)
    if queue is not None:
        await queue.put(event)


def create_queue(job_id: str) -> asyncio.Queue:
    """Erstellt eine neue Queue fuer den Job und gibt sie zurueck."""
    queue: asyncio.Queue = asyncio.Queue()
    job_queues[job_id] = queue
    return queue


def remove_queue(job_id: str) -> None:
    job_queues.pop(job_id, None)
