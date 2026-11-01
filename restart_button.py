"""Backend status endpoint used by the standalone restart and update buttons."""
import uuid

from aiohttp import web
from server import PromptServer

BOOT_ID = uuid.uuid4().hex


@PromptServer.instance.routes.get('/manga-rework/update-status')
async def update_status(request):
    return web.json_response(
        {
            'boot_id': BOOT_ID,
            'busy': bool(PromptServer.instance.prompt_queue.get_tasks_remaining()),
        },
        headers={'Cache-Control': 'no-store'},
    )
