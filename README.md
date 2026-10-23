# Comfy UI Additions

Two independent ComfyUI features, each in its own JavaScript file. Auto Reload also has a dedicated Python backend module (`auto_reload.py`):

- **Auto Reload** (`web/auto_reload.js`): reloads the browser when the backend process changes.
- **IO Reorder** (`web/io_reorder.js`): adds Up/Down to subgraph input/output slot context menus, preserving links.

Both can be toggled independently in **Settings** under **Comfy UI Additions**. Both default to enabled. IO Reorder toggles take effect on the next menu opening; Auto Reload toggles take effect on the next reconnect.

## Install

Extract the `comfy-ui-additions` folder into `ComfyUI/custom_nodes/` and restart ComfyUI. Remove or disable the old `comfy-auto-reload` and `comfy-io-reorder` folders to avoid duplicate functionality.
