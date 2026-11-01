"""Explicit update action for this extension; restart remains Manager-owned."""
import asyncio
import os
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web
from server import PromptServer

ROOT = Path(__file__).resolve().parent
BOOT_ID = uuid.uuid4().hex
_lock = asyncio.Lock()


async def repository_head(root, env):
    process = await asyncio.create_subprocess_exec(
        'git', '-C', str(root), 'rev-parse', '--verify', 'HEAD',
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env)
    try:
        output, error = await asyncio.wait_for(process.communicate(), timeout=15)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        process.kill()
        await process.communicate()
        raise
    if process.returncode:
        raise RuntimeError(error.decode('utf-8', errors='replace').strip())
    return output.decode('ascii').strip()


async def pull_repository(root):
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
    probe = await asyncio.create_subprocess_exec(
        'git', '-C', str(root), 'rev-parse', '--show-toplevel',
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env)
    top, error = await probe.communicate()
    if probe.returncode or Path(os.fsdecode(top).strip()).resolve() != root.resolve():
        raise RuntimeError('The extension directory must be its own Git checkout')
    before = await repository_head(root, env)
    process = await asyncio.create_subprocess_exec(
        'git', '-C', str(root), 'pull', '--ff-only',
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=env)
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout=120)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        process.kill()
        await process.communicate()
        raise
    text = output.decode('utf-8', errors='replace').strip()
    if process.returncode:
        raise RuntimeError(text or f'git pull exited with {process.returncode}')
    after = await repository_head(root, env)
    return {'output': text, 'changed': before != after, 'before': before, 'after': after}


@PromptServer.instance.routes.get('/manga-rework/update-status')
async def update_status(request):
    return web.json_response({'boot_id': BOOT_ID, 'busy': bool(PromptServer.instance.prompt_queue.get_tasks_remaining())}, headers={'Cache-Control': 'no-store'})


@PromptServer.instance.routes.post('/manga-rework/update')
async def update_extension(request):
    # Require a JSON request from the ComfyUI page, never a cross-site form.
    origin = request.headers.get('Origin')
    if (request.content_type != 'application/json'
            or request.headers.get('Sec-Fetch-Site') == 'cross-site'
            or (origin and urlsplit(origin).netloc != request.host)):
        return web.json_response({'error': 'Same-origin JSON request required'}, status=403)
    try:
        payload = await request.json()
    except (ValueError, UnicodeDecodeError):
        return web.json_response({'error': 'Invalid JSON'}, status=400)
    if payload != {}:
        return web.json_response({'error': 'This action accepts no repository or command arguments'}, status=400)
    if _lock.locked():
        return web.json_response({'error': 'An update is already running'}, status=409)
    async with _lock:
        if PromptServer.instance.prompt_queue.get_tasks_remaining():
            return web.json_response({'error': 'Wait until the ComfyUI queue is empty before updating and restarting'}, status=409)
        reboot_available = any(
            route.method == 'POST' and route.resource.canonical == '/v2/manager/reboot'
            for route in request.app.router.routes())
        if not reboot_available:
            return web.json_response({'error': 'ComfyUI-Manager restart endpoint is unavailable'}, status=503)
        try:
            result = await pull_repository(ROOT)
        except asyncio.TimeoutError:
            return web.json_response({'error': 'Git update timed out; no restart requested'}, status=504)
        except (OSError, RuntimeError) as error:
            return web.json_response({'error': str(error)}, status=409)
        return web.json_response({**result, 'boot_id': BOOT_ID})
