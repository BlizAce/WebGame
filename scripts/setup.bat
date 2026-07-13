@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem GateWars / webWars setup — Windows
set "ROOT=%~dp0.."
cd /d "%ROOT%" || exit /b 1

set "NODE_MAJOR_MIN=20"
if not defined SKIP_BUILD set "SKIP_BUILD=0"

echo [setup] Working directory: %CD%

call :ensure_node
if errorlevel 1 exit /b 1

echo [setup] npm install...
call npm install
if errorlevel 1 (
  echo [setup] npm install failed.
  exit /b 1
)

if "%SKIP_BUILD%"=="1" (
  echo [setup] Skipping build ^(SKIP_BUILD=1^)
) else (
  echo [setup] Typecheck / build smoke...
  call npm run build
  if errorlevel 1 (
    echo [setup] Build failed.
    exit /b 1
  )
)

echo.
echo [setup] Done. Start the game with:
echo   scripts\launch.bat
echo   or: npm run dev
echo   -^> http://localhost:3000
exit /b 0

:ensure_node
where node >nul 2>&1
if errorlevel 1 (
  echo [setup] Node.js not found.
  call :try_install_node
  if errorlevel 1 exit /b 1
)

call :read_node_major
if not defined NODE_MAJOR (
  echo [setup] Could not read Node version.
  exit /b 1
)

if !NODE_MAJOR! LSS %NODE_MAJOR_MIN% (
  echo [setup] Node %NODE_MAJOR_MIN%+ required ^(found: !NODE_MAJOR!^).
  call :try_install_node
  if errorlevel 1 exit /b 1
  call :read_node_major
  if !NODE_MAJOR! LSS %NODE_MAJOR_MIN% (
    echo [setup] Node %NODE_MAJOR_MIN%+ still missing after install attempt.
    exit /b 1
  )
)

for /f "delims=" %%V in ('node -v') do set "NODE_VER=%%V"
for /f "delims=" %%V in ('npm -v') do set "NPM_VER=%%V"
echo [setup] Node !NODE_VER! / npm !NPM_VER! OK
exit /b 0

:read_node_major
set "NODE_MAJOR="
for /f "tokens=1 delims=v." %%A in ('node -v 2^>nul') do (
  set "NODE_MAJOR=%%A"
  goto :eof
)
goto :eof

:try_install_node
where winget >nul 2>&1
if errorlevel 1 goto :no_winget

echo [setup] Installing Node.js LTS via winget...
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo [setup] winget install failed. Install Node 20+ from https://nodejs.org/ and re-run.
  exit /b 1
)

rem Refresh PATH for this session from Machine + User
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "MACHINE_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%B"
if defined MACHINE_PATH set "PATH=!MACHINE_PATH!;!USER_PATH!"

where node >nul 2>&1
if errorlevel 1 (
  echo [setup] Node installed but not on PATH yet. Open a new terminal and re-run scripts\setup.bat
  exit /b 1
)
exit /b 0

:no_winget
echo [setup] winget not available. Install Node 20+ from https://nodejs.org/ then re-run this script.
echo [setup] Native build tools may also be needed for better-sqlite3 ^(Visual Studio Build Tools / "Desktop development with C++"^).
exit /b 1
