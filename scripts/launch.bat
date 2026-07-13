@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem GateWars / webWars launcher — Windows
set "ROOT=%~dp0.."
cd /d "%ROOT%" || exit /b 1

set "NODE_MAJOR_MIN=20"
if not defined PORT set "PORT=3000"

where node >nul 2>&1
if errorlevel 1 (
  echo [launch] Node.js not found. Run scripts\setup.bat first.
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [launch] npm not found. Run scripts\setup.bat first.
  exit /b 1
)

set "NODE_MAJOR="
for /f "tokens=1 delims=v." %%A in ('node -v 2^>nul') do (
  set "NODE_MAJOR=%%A"
  goto :have_major
)
:have_major
if not defined NODE_MAJOR (
  echo [launch] Could not read Node version.
  exit /b 1
)
if !NODE_MAJOR! LSS %NODE_MAJOR_MIN% (
  echo [launch] Node %NODE_MAJOR_MIN%+ required ^(found: !NODE_MAJOR!^). Run scripts\setup.bat first.
  exit /b 1
)

if not exist "node_modules\" (
  echo [launch] node_modules missing — running npm install...
  call npm install
  if errorlevel 1 (
    echo [launch] npm install failed.
    exit /b 1
  )
)

echo [launch] Starting GateWars at http://localhost:!PORT!
echo [launch] Press Ctrl+C to stop.
echo.

if "!PORT!"=="3000" (
  call npm run dev
) else (
  call npx next dev -p !PORT!
)
exit /b %ERRORLEVEL%
