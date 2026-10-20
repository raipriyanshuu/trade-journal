@echo off
REM One-command start for Windows. Installs deps on first run, runs migrations,
REM builds the frontend if needed, then serves everything at 127.0.0.1:8000.
setlocal
cd /d "%~dp0"

REM --- Backend virtual environment ---
if not exist "backend\.venv\Scripts\python.exe" (
  echo [setup] Creating Python virtual environment...
  python -m venv backend\.venv
)
call "backend\.venv\Scripts\activate.bat"

echo [setup] Installing backend dependencies...
python -m pip install --upgrade pip >nul
pip install -q -r backend\requirements.txt
if errorlevel 1 (
  echo [error] Failed to install backend dependencies. Is Python 3.11+ installed?
  pause
  exit /b 1
)

REM --- Safety snapshot, then database migrations ---
pushd backend
python -m app.core.autobackup pre-migrate
echo [setup] Running database migrations...
alembic upgrade head
popd

REM --- Frontend build (only if not built yet) ---
if not exist "frontend\dist\index.html" (
  echo [setup] Building frontend...
  pushd frontend
  if not exist "node_modules" (
    echo [setup] Installing frontend dependencies...
    call npm install
  )
  call npm run build
  popd
)

REM --- Open the browser shortly after the server starts ---
start "" cmd /c "timeout /t 3 /nobreak >nul & start "" http://127.0.0.1:8000"

echo.
echo Trade Journal running at http://127.0.0.1:8000  (Ctrl+C to stop)
echo.
pushd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
popd
