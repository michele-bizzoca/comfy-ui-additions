"""Update configured ComfyUI extensions; restart remains Manager-owned."""
import asyncio
import logging
import os
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web
from server import PromptServer

from .restart_button import BOOT_ID

ROOT = Path(__file__).resolve().parent
CUSTOM_NODES = ROOT.parent.resolve()
EXTENSIONS_FILE = ROOT / "extensions.txt"
logger = logging.getLogger(__name__)
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
    root = root.resolve()
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
    probe = await asyncio.create_subprocess_exec(
        'git', '-C', str(root), 'rev-parse', '--show-toplevel',
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env)
    top, error = await probe.communicate()
    if probe.returncode or Path(os.fsdecode(top).strip()).resolve() != root:
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
    output_text = output.decode('utf-8', errors='replace').strip()
    if process.returncode:
        raise RuntimeError(output_text or f'git pull exited with {process.returncode}')
    after = await repository_head(root, env)
    return {'output': output_text, 'changed': before != after, 'before': before, 'after': after}


def configured_extensions():
    if not EXTENSIONS_FILE.is_file():
        logger.error("[Comfy UI Additions] File extensions.txt non trovato: %s", EXTENSIONS_FILE)
        raise FileNotFoundError(f'Missing extension list: {EXTENSIONS_FILE.name}')
    names = []
    for raw_line in EXTENSIONS_FILE.read_text(encoding='utf-8').splitlines():
        name = raw_line.strip()
        if not name or name.startswith('#'):
            continue
        if name in {'.', '..'} or '/' in name or '\\' in name:
            raise ValueError(f'Invalid extension directory name: {name!r}')
        if name not in names:
            names.append(name)
    if not names:
        raise ValueError(f'{EXTENSIONS_FILE.name} does not contain any extension directories')
    return names


async def pull_configured_extensions():
    results = []
    errors = []
    changed = False
    for name in configured_extensions():
        extension_path = (CUSTOM_NODES / name).resolve()
        if extension_path.parent != CUSTOM_NODES or not extension_path.is_dir():
            errors.append({'extension': name, 'error': 'Extension directory was not found directly inside custom_nodes'})
            continue
        try:
            result = await pull_repository(extension_path)
            changed = changed or result['changed']
            results.append({'extension': name, **result})
        except (OSError, RuntimeError, asyncio.TimeoutError) as error:
            errors.append({'extension': name, 'error': str(error) or error.__class__.__name__})
    output = '\n\n'.join(
        f"[{item['extension']}]\n{item['output']}" for item in results
    )
    return {'changed': changed, 'extensions': results, 'errors': errors, 'output': output}


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
            result = await pull_configured_extensions()
        except FileNotFoundError as error:
            return web.json_response({'error': str(error)}, status=404)
        except ValueError as error:
            return web.json_response({'error': str(error)}, status=400)
        except OSError as error:
            return web.json_response({'error': str(error)}, status=409)
        if result['errors']:
            return web.json_response({
                **result,
                'error': 'One or more extensions could not be updated; ComfyUI will not be restarted.',
            }, status=409)
        return web.json_response({**result, 'boot_id': BOOT_ID})
