@echo off
rem ── Skycord dev launcher ─────────────────────────────────────────────
rem Double-click this to start BOTH dev servers in their own windows,
rem fully independent of any editor/agent session:
rem   • API server  → http://localhost:8790  (PORT from .env)
rem   • Vite client → http://localhost:5173
rem Close the windows to stop them. If a port is stuck, check:
rem   netstat -ano | findstr :8790
cd /d "%~dp0"
start "sykord-api"    cmd /k npm run dev:server
start "sykord-client" cmd /k npm run dev:client
echo Started sykord-api (:8790) and sykord-client (:5173) in separate windows.
