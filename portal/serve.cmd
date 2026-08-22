@echo off
setlocal
REM One-click launcher for the Champions data portal (localhost only).
REM Runs portal\serve.py, which serves the project root (so the page can fetch
REM /data/dex/... alongside /portal/) AND persists ownership toggles server-side.
REM serve.py locates the project root off its own path, so no cd is needed.
REM Stop the server by closing this window or pressing Ctrl+C.

REM Prefer the Python launcher (py); fall back to python on PATH.
where py >nul 2>nul && (set "PY=py") || (set "PY=python")

echo(
echo   Champions data portal
echo   -----------------------------------------------
echo   Serving at http://127.0.0.1:8737/portal/
echo   Bound to 127.0.0.1 (this PC only).
echo   Close this window or press Ctrl+C to stop.
echo(

REM Auto-refresh the data if it's stale. Fresh/throttled = instant; a genuine
REM new-month/old-battledata refresh streams a couple-minute pipeline here.
REM Never blocks serving (any failure just warns and continues on cached data).
REM Runs BEFORE scheduling the browser so a slow refresh can't open it early.
%PY% "%~dp0..\scripts\refresh_if_stale.py"

REM Open the browser a moment after the server has had time to bind.
start "" powershell -NoProfile -Command "Start-Sleep -Seconds 1; Start-Process 'http://127.0.0.1:8737/portal/'"

%PY% "%~dp0serve.py"
