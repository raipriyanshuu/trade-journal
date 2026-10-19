#!/usr/bin/env bash
# One-command start for macOS/Linux. Installs deps on first run, runs migrations,
# builds the frontend if needed, then serves everything at 127.0.0.1:8000.
set -e
cd "$(dirname "$0")"

# --- Backend virtual environment ---
if [ ! -x "backend/.venv/bin/python" ]; then
  echo "[setup] Creating Python virtual environment..."
  python3 -m venv backend/.venv
fi
# shellcheck disable=SC1091
source backend/.venv/bin/activate

echo "[setup] Installing backend dependencies..."
python -m pip install --upgrade pip >/dev/null
pip install -q -r backend/requirements.txt

# --- Database migrations ---
echo "[setup] Running database migrations..."
(cd backend && alembic upgrade head)

# --- Frontend build (only if not built yet) ---
if [ ! -f "frontend/dist/index.html" ]; then
  echo "[setup] Building frontend..."
  (cd frontend && { [ -d node_modules ] || npm install; } && npm run build)
fi

# --- Open the browser shortly after the server starts ---
( sleep 3
  if command -v open >/dev/null 2>&1; then open http://127.0.0.1:8000
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://127.0.0.1:8000
  fi ) &

echo
echo "Trade Journal running at http://127.0.0.1:8000  (Ctrl+C to stop)"
echo
cd backend
exec python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
