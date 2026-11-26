@echo off
setlocal
cd /d "%~dp0"
curl.exe --noproxy "*" -fsS --max-time 2 http://127.0.0.1:8000/api/state >nul 2>nul
if not errorlevel 1 (
  start "" "http://127.0.0.1:8000/"
  exit /b 0
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js 24 tro len de mo Cho Phu Thinh.
  pause
  exit /b 1
)
set PORT=8000
set MARKET_HOST=127.0.0.1
set MARKET_ORIGIN=
node server.cjs --open
if errorlevel 1 pause
