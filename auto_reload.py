"""Backend process identity endpoint for the Auto Reload feature."""
from uuid import uuid4

from aiohttp import web
from server import PromptServer

_INSTANCE_ID = uuid4().hex


@PromptServer.instance.routes.get("/comfy-ui-additions/auto-reload/instance")
async def additions_auto_reload_instance(request):
    return web.json_response(
        {"instance_id": _INSTANCE_ID},
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )
