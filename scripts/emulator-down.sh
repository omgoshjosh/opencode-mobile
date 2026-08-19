#!/usr/bin/env bash
# Tear down the project's local AVD through the device pool: release our
# recorded claim, then stop the emulator via adb (graceful) — NEVER by
# pattern-matching ps output. Identity, not names.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/devpool-adapter.sh
source "${SCRIPT_DIR}/lib/devpool-adapter.sh"

AVD_NAME="${OPENCODEX_AVD:-opencodex_android12}"
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"

# Find OUR emulator's adb serial by asking each emulator for its AVD name —
# an identity check against the running device, not a ps pattern.
for serial in $("${ADB}" devices | awk '/^emulator-/{print $1}'); do
  if [ "$("${ADB}" -s "${serial}" emu avd name 2>/dev/null | head -1 | tr -d '\r')" = "${AVD_NAME}" ]; then
    echo "Stopping ${AVD_NAME} (${serial})..."
    "${ADB}" -s "${serial}" emu kill || true
  fi
done

opx_devpool_release avd "${AVD_NAME}"
echo "Released ${AVD_NAME} in devpool (no-op if devpool absent)."
