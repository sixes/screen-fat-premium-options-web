#!/usr/bin/env bash
# Usage: ./run.sh {start|stop|restart|status|logs}
# Runs the backend (uvicorn on :9188) and frontend (vite on :5173) as
# detached background processes managed by PID files under ./.run/

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="$SCRIPT_DIR/.run"
mkdir -p "$RUN_DIR"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$RUN_DIR/backend.log"
FRONTEND_LOG="$RUN_DIR/frontend.log"

is_running() {
    local pid_file="$1"
    [ -f "$pid_file" ] || return 1
    local pid
    pid=$(cat "$pid_file")
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

start_backend() {
    if is_running "$BACKEND_PID_FILE"; then
        echo "Backend already running (PID $(cat "$BACKEND_PID_FILE"))"
        return
    fi
    cd "$SCRIPT_DIR/backend"
    # Force system Python (where uvicorn is installed); ignore any venv the
    # caller's shell may have activated.
    env -u VIRTUAL_ENV -u PYTHONHOME PATH="/usr/local/bin:/usr/bin:/bin" \
        nohup /usr/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 9188 --reload \
        >>"$BACKEND_LOG" 2>&1 &
    echo $! >"$BACKEND_PID_FILE"
    disown
    echo "Backend started (PID $(cat "$BACKEND_PID_FILE")) → http://localhost:9188"
}

start_frontend() {
    if is_running "$FRONTEND_PID_FILE"; then
        echo "Frontend already running (PID $(cat "$FRONTEND_PID_FILE"))"
        return
    fi
    cd "$SCRIPT_DIR/frontend"
    nohup npx vite --host 0.0.0.0 \
        >>"$FRONTEND_LOG" 2>&1 &
    echo $! >"$FRONTEND_PID_FILE"
    disown
    echo "Frontend started (PID $(cat "$FRONTEND_PID_FILE")) → http://localhost:5173"
}

stop_process() {
    local name="$1"
    local pid_file="$2"
    if is_running "$pid_file"; then
        local pid
        pid=$(cat "$pid_file")
        echo "Stopping $name (PID $pid)..."
        kill "$pid" 2>/dev/null || true
        # give it a moment
        for _ in 1 2 3 4 5; do
            kill -0 "$pid" 2>/dev/null || break
            sleep 0.5
        done
        if kill -0 "$pid" 2>/dev/null; then
            echo "  force killing..."
            kill -9 "$pid" 2>/dev/null || true
        fi
    else
        echo "$name not running"
    fi
    rm -f "$pid_file"
}

status_of() {
    local name="$1"
    local pid_file="$2"
    if is_running "$pid_file"; then
        echo "$name: running (PID $(cat "$pid_file"))"
    else
        echo "$name: stopped"
    fi
}

case "${1:-start}" in
    start)
        start_backend
        start_frontend
        echo ""
        echo "Logs: $RUN_DIR/*.log"
        echo "Stop with: $0 stop"
        ;;
    stop)
        stop_process "Frontend" "$FRONTEND_PID_FILE"
        stop_process "Backend"  "$BACKEND_PID_FILE"
        ;;
    restart)
        "$0" stop
        sleep 1
        "$0" start
        ;;
    status)
        status_of "Backend"  "$BACKEND_PID_FILE"
        status_of "Frontend" "$FRONTEND_PID_FILE"
        ;;
    logs)
        tail -F "$BACKEND_LOG" "$FRONTEND_LOG"
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
