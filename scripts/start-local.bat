@echo off
start "Yanzhitu Backend" cmd /k "set PYTHONPATH=.&& python -m backend.api --host 127.0.0.1 --port 8000"
start "Yanzhitu Frontend" cmd /k "cd frontend && set VITE_DATA_MODE=api&& npm run dev -- --host 127.0.0.1 --port 5173"
start http://127.0.0.1:5173
