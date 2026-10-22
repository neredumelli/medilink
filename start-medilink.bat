@echo off
setlocal EnableDelayedExpansion
title MediLink - starting
cd /d "%~dp0"

echo.
echo  ==========================================
echo    MediLink - one-click start
echo  ==========================================
echo.
echo  Usage:  start-medilink.bat          start the app
echo          start-medilink.bat reset    wipe the database and reload demo data
echo.

REM ---------- 1. Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [1/7] Node.js is not installed. Installing Node.js 20 LTS...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo.
    echo  Please install Node.js 20 LTS from https://nodejs.org and run this file again.
    goto :fail
  )
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo  Node.js installed. Close this window and double-click start-medilink.bat again.
  pause
  exit /b 0
)
for /f "tokens=1,2 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
if !NODE_MAJOR! LSS 20 (
  echo  Your Node.js is too old. Please install Node.js 20 LTS or newer from https://nodejs.org
  goto :fail
)
echo [1/7] Node.js found:
node -v

REM ---------- 1b. Company network certificates ----------
REM Office networks often inspect HTTPS with their own certificate. Windows trusts it, Node.js does not.
REM We export the certificates Windows already trusts, so npm, pnpm and Prisma can download safely.
set "CA_FILE=%~dp0.certs\windows-trusted-ca.pem"
if /i "%~1"=="reset" if exist "%CA_FILE%" del "%CA_FILE%"
if not exist "%CA_FILE%" (
  echo [1/7] Reading trusted certificates from Windows...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$sb = New-Object System.Text.StringBuilder; foreach ($store in 'Cert:\LocalMachine\Root','Cert:\LocalMachine\CA','Cert:\CurrentUser\Root','Cert:\CurrentUser\CA') { Get-ChildItem $store -ErrorAction SilentlyContinue | Where-Object { $_.NotAfter -gt (Get-Date) } | ForEach-Object { [void]$sb.AppendLine('-----BEGIN CERTIFICATE-----'); [void]$sb.AppendLine([Convert]::ToBase64String($_.RawData, 'InsertLineBreaks')); [void]$sb.AppendLine('-----END CERTIFICATE-----') } }; New-Item -ItemType Directory -Force -Path (Split-Path $env:CA_FILE) | Out-Null; [IO.File]::WriteAllText($env:CA_FILE, $sb.ToString())"
)
if exist "%CA_FILE%" (
  set "NODE_EXTRA_CA_CERTS=%CA_FILE%"
  set "npm_config_cafile=%CA_FILE%"
  echo [1/7] Company certificates loaded.
) else (
  echo [1/7] Could not read Windows certificates. Downloads may fail on an office network.
)

REM ---------- 2. pnpm ----------
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [2/7] Installing pnpm...
  call npm install -g pnpm@9
  if errorlevel 1 goto :fail
) else (
  echo [2/7] pnpm found.
)

REM ---------- 3. Docker ----------
where docker >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Docker Desktop is needed for the database.
  echo  Install it from https://www.docker.com/products/docker-desktop and run this file again.
  where winget >nul 2>nul
  if not errorlevel 1 (
    choice /m "Install Docker Desktop now with winget"
    if !errorlevel! EQU 1 winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
    echo  After Docker Desktop is installed, restart the PC, open Docker Desktop once, then run this file again.
  )
  goto :fail
)
docker info >nul 2>nul
if not errorlevel 1 goto :dockerok
echo [3/7] Starting Docker Desktop. This can take a minute...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
set /a tries=0
:waitdocker
timeout /t 5 /nobreak >nul
docker info >nul 2>nul
if not errorlevel 1 goto :dockerok
set /a tries+=1
if !tries! GEQ 36 goto :dockerfail
goto :waitdocker
:dockerfail
echo  Docker did not start. Open Docker Desktop yourself, wait until it says "running", then run this file again.
goto :fail
:dockerok
echo [3/7] Docker is running.

REM ---------- 4. Settings files ----------
if not exist "apps\api\.env" copy /y ".env.example" "apps\api\.env" >nul
if not exist "apps\web\.env.local" copy /y ".env.example" "apps\web\.env.local" >nul
echo [4/7] Settings files ready.

REM ---------- 5. Libraries ----------
echo [5/7] Installing libraries (first time takes a few minutes)...
call pnpm install
if errorlevel 1 goto :fail

REM ---------- 6. Database ----------
echo [6/7] Starting the database...
docker compose -f infra\docker-compose.yml up -d postgres redis
if errorlevel 1 goto :fail
set /a tries=0
:waitdb
docker compose -f infra\docker-compose.yml exec -T postgres pg_isready -U medilink >nul 2>nul
if not errorlevel 1 goto :dbok
set /a tries+=1
if !tries! GEQ 30 (
  echo  The database did not start. Check Docker Desktop for errors.
  goto :fail
)
timeout /t 2 /nobreak >nul
goto :waitdb
:dbok

if /i "%~1"=="reset" (
  echo  Resetting the database...
  docker compose -f infra\docker-compose.yml exec -T postgres psql -U medilink -d medilink -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >nul
  if exist ".seeded" del ".seeded"
)

call pnpm --filter @medilink/api prisma:deploy
if errorlevel 1 goto :fail
if not exist ".seeded" (
  echo  Loading Hyderabad demo data...
  call pnpm --filter @medilink/api prisma:seed
  if errorlevel 1 goto :fail
  echo done> ".seeded"
)

REM ---------- 7. Start ----------
echo.
echo [7/7] Starting MediLink...
echo.
echo  ==========================================
echo    Web app:   http://localhost:3000
echo    API docs:  http://localhost:4000/api/docs
echo.
echo    Demo logins (mobile number):
echo      Shop owner   9848012345
echo      Distributor  9876500001
echo      Admin        9000000001
echo.
echo    The 6-digit OTP appears in THIS window,
echo    in a line like:  OTP for 9848012345: 123456
echo.
echo    To stop: close this window or press Ctrl+C
echo  ==========================================
echo.
title MediLink - running (close to stop)
start "" cmd /c "timeout /t 30 /nobreak >nul & start http://localhost:3000"
call pnpm dev
goto :eof

:fail
echo.
echo  Something went wrong. Copy the text above and send it to Claude for a fix.
echo  On an office network you may also need to ask IT to allow registry.npmjs.org, binaries.prisma.sh and Docker Hub.
pause
exit /b 1
