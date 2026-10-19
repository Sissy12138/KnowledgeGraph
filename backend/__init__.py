"""Compatibility package for the A backend.

The implementation remains in ``backend-a`` to preserve the repository
layout, while ``python -m backend.api`` remains the documented entry point.
"""

from pathlib import Path

__path__ = [str(Path(__file__).resolve().parent.parent / "backend-a")]
