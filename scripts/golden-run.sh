#!/usr/bin/env bash
# Runs the golden-image export in CI: starts the upload server and Metro (with
# EXPO_PUBLIC_GOLDEN_SERVER so the app runs example/golden/GoldenRunner.tsx), launches the already
# installed debug build of the example app, and waits until the app has uploaded every case.
#
#   scripts/golden-run.sh ios <simulator udid> <outDir>
#   scripts/golden-run.sh android <unused> <outDir>     (inside a running emulator)
set -euo pipefail

platform=$1
device=$2
out=$3
package=expo.modules.photoengine.example

node scripts/golden-server.mjs "$out" 8099 900 &
server=$!
trap 'pkill -f "expo start --port 8081" || true' EXIT

(cd example && EXPO_PUBLIC_GOLDEN_SERVER=http://localhost:8099 CI=1 npx expo start --port 8081 >../metro.log 2>&1) &
for _ in $(seq 1 90); do
  curl -sf http://localhost:8081/status | grep -q running && break
  sleep 2
done
echo "Metro is up"

if [ "$platform" = ios ]; then
  xcrun simctl launch "$device" "$package"
else
  # The emulator reaches the host's Metro and upload server through localhost.
  adb reverse tcp:8081 tcp:8081
  adb reverse tcp:8099 tcp:8099
  adb shell am start -n "$package/.MainActivity"
fi

status=0
wait "$server" || status=$?
if [ "$status" -ne 0 ]; then
  echo "---- metro.log (last 80 lines)"
  tail -80 metro.log || true
  if [ "$platform" = android ]; then
    echo "---- logcat (errors)"
    adb logcat -d '*:E' | tail -80 || true
  fi
fi
exit "$status"
