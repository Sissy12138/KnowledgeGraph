"""Entry point for the self-contained macOS backend/worker runtime."""
from __future__ import annotations

import importlib
import sys


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in {"backend", "worker"}:
        raise SystemExit("usage: yanzhitu-service <backend|worker> [arguments]")

    role = sys.argv.pop(1)
    # ``backend-a`` is mirrored to ``service_backend`` during the native build.
    # The normal repository compatibility package has a dynamic __path__, which
    # frozen-module analyzers cannot discover reliably.
    module_name = "service_backend.api" if role == "backend" else "middleware-b.scripts.run_live_worker"
    module = importlib.import_module(module_name)
    module.main()


if __name__ == "__main__":
    main()
