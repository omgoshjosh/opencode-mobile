#!/usr/bin/env bash
# Boot the project's local AVD and RECORD it in the machine device pool, so
# it never again looks like a leaked qemu process to other projects' cleanup.
#
# Local-machine tool. CI boots its own emulator on GitHub-hosted runners and
# must never run this. Safe when devpool is absent (adapter no-ops).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/devpool-adapter.sh
source "${SCRIPT_DIR}/lib/devpool-adapter.sh"

AVD_NAME="${OPENCODEX_AVD:-opencodex_android12}"
EMULATOR_BIN="${ANDROID_HOME:-$HOME/Library/Android/sdk}/emulator/emulator"

if pgrep -f "${AVD_NAME}" >/dev/null 2>&1; then
  echo "AVD ${AVD_NAME} already running (pid $(pgrep -f "${AVD_NAME}" | head -1))."
  echo "If it predates devpool adoption, run scripts/devpool-register-running.sh"
  exit 0
fi

"${EMULATOR_BIN}" -avd "${AVD_NAME}" -no-snapshot-save >/dev/null 2>&1 &
EMULATOR_PID=$!
echo "Booting ${AVD_NAME} (pid ${EMULATOR_PID})..."
opx_devpool_record avd "${AVD_NAME}" "${EMULATOR_PID}"
echo "Recorded in devpool as ${DEVPOOL_PROJECT}/${DEVPOOL_AGENT} (no-op if devpool absent)."
