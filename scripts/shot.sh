#!/usr/bin/env bash
# Capture a screenshot of mom-lens running under a private Xvfb display.
# Usage: scripts/shot.sh "<route>" "<out.png>"   e.g. scripts/shot.sh "/cluster/resources/pods?ns=all" /tmp/pods.png
set -e
cd "$(dirname "$0")/.."
export KUBECONFIG="${KUBECONFIG:-/home/sothana/Desktop/ssh/mpt/sothanav-local.yaml}"
ROUTE="${1:-}"
OUT="${2:-/tmp/lens-ref/shot.png}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
mkdir -p "$(dirname "$OUT")"
export DISPLAY=":${DISPLAY_NUM}"
Xvfb ":${DISPLAY_NUM}" -screen 0 1440x900x24 >/tmp/xvfb.log 2>&1 &
XV=$!
sleep 1.5
SOLENS_ROUTE="$ROUTE" node_modules/.bin/electron . --no-sandbox --disable-gpu >/tmp/electron.log 2>&1 &
EL=$!
sleep "${SHOT_WAIT:-9}"
ffmpeg -y -loglevel error -f x11grab -video_size 1440x900 -framerate 25 -i "${DISPLAY}" -frames:v 1 "$OUT" 2>/tmp/import.log || { echo "capture failed"; cat /tmp/import.log; }
kill "$EL" 2>/dev/null || true
kill "$XV" 2>/dev/null || true
echo "captured $OUT"
ls -la "$OUT"
