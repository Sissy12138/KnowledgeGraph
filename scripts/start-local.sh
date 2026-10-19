#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_port="${YANZHITU_PORT:-8000}"
frontend_port="${VITE_PORT:-5173}"

cleanup() { kill "${backend_pid:-}" "${frontend_pid:-}" "${worker_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

cd "$repo_dir"
PYTHONPATH=. python -m backend.api --host "${YANZHITU_HOST:-127.0.0.1}" --port "$backend_port" &
backend_pid=$!

cd frontend
VITE_DATA_MODE="${VITE_DATA_MODE:-api}" npm run dev -- --host "${VITE_HOST:-127.0.0.1}" --port "$frontend_port" &
frontend_pid=$!

cd "$repo_dir"
PYTHONPATH=. python -m middleware-b.scripts.run_live_worker \
  --a-base-url "http://${YANZHITU_HOST:-127.0.0.1}:${backend_port}" \
  --watch \
  --health-port "${WORKER_HEALTH_PORT:-8765}" &
worker_pid=$!

echo "A backend: http://${YANZHITU_HOST:-127.0.0.1}:${backend_port}"
echo "Frontend:   http://${VITE_HOST:-127.0.0.1}:${frontend_port}"
echo "Worker:     http://127.0.0.1:${WORKER_HEALTH_PORT:-8765}/health"
# macOS 自带 Bash 3.2 不支持 `wait -n`；等待后端即可保持两个服务存活。
wait "$backend_pid"
