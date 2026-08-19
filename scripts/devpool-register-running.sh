#!/usr/bin/env bash
# Adopt an ALREADY-RUNNING opencodex_android12 into the device pool — the
# one-time migration for the hand-started emulator that predates devpool
# adoption (it currently looks like a leaked qemu process to everyone else).
# Idempotent and safe when devpool is absent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/devpool-adapter.sh
source "${SCRIPT_DIR}/lib/devpool-adapter.sh"

AVD_NAME="${OPENCODEX_AVD:-opencodex_android12}"
PID="$(pgrep -f "${AVD_NAME}" | head -1 || true)"

if [ -z "${PID}" ]; then
  echo "No running ${AVD_NAME} found; nothing to register."
  exit 0
fi

opx_devpool_record avd "${AVD_NAME}" "${PID}"
if devpool_available; then
  echo "Registered running ${AVD_NAME} (pid ${PID}) as ${DEVPOOL_PROJECT}/${DEVPOOL_AGENT}."
else
  echo "devpool not present yet — rerun after it lands to register pid ${PID}."
fi
