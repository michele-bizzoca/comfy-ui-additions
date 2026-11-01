"""Comfy UI Additions: independent browser utilities."""
from . import auto_reload  # Registers the Auto Reload backend endpoint.
from . import update_buttons  # Registers extension update and restart endpoints.

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./scripts"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
