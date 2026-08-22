@echo off
setlocal
REM Launch the Champions portal on your HOME NETWORK (not just this PC).
REM Binds 0.0.0.0 so phones / other PCs on the same network can open it.
REM serve.py prints the http://<PC-IP>:8737/portal/ address to use elsewhere.
REM Stop by closing this window or pressing Ctrl+C.

where py >nul 2>nul && (set "PY=py") || (set "PY=python")

echo(
echo   Champions data portal - HOME NETWORK mode
echo   -----------------------------------------------
echo   Serving on 0.0.0.0:8737 (this PC and other devices on your network).
echo   Look in the output below for the http://^<PC-IP^>:8737/portal/ address
echo   to open on your phone or another PC.
echo   First run may show a Windows Firewall prompt for Python - allow it on
echo   PRIVATE networks only.
echo   Close this window or press Ctrl+C to stop.
echo(

REM Auto-refresh the data if it's stale (fresh/throttled = instant). Never
REM blocks serving. Runs before scheduling the browser.
%PY% "%~dp0..\scripts\refresh_if_stale.py"

start "" powershell -NoProfile -Command "Start-Sleep -Seconds 1; Start-Process 'http://127.0.0.1:8737/portal/'"

%PY% "%~dp0serve.py" --bind 0.0.0.0
