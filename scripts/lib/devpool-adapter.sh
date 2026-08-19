#!/usr/bin/env bash
# Devpool adapter for the OpencodeX mobile project.
#
# This Mac hosts several projects' device infrastructure (yondi's AVDs and
# port range 4000-12199 among them). The machine-level pool at
# /Users/josh/agents/devpool owns the truth about which process owns which
# device; this adapter is the ONLY way project scripts talk to it.
#
# Load-bearing guard: devpool lands after yondi PR #476. Until it exists —
# and forever on GitHub-hosted CI runners, which must never depend on this
# Mac — every function here degrades to a no-op and scripts behave exactly
# as they do today.
#
# Ownership is identity-based, never name-based: we record what we boot and
# release/reap only what is recorded under our identity. Killing by
# pattern-matching ps output is forbidden (a foreign process named `node`
# on an owned port was once silently excused by a name ignore-list on this
# machine; identity does not have that failure mode).

DEVPOOL_ROOT="${DEVPOOL_ROOT:-/Users/josh/agents/devpool}"
DEVPOOL_LIB="${DEVPOOL_ROOT}/lib/devpool.sh"
DEVPOOL_PROJECT="opencodex"
# One identity per driving agent; override when a named agent runs the script.
DEVPOOL_AGENT="${DEVPOOL_AGENT:-${USER}-manual}"

devpool_available() {
  [ -f "${DEVPOOL_LIB}" ]
}

# shellcheck disable=SC1090
if devpool_available; then
  source "${DEVPOOL_LIB}" || true
fi

# Record a device we just booted. No-op when devpool is absent.
#   opx_devpool_record avd|sim <device_id> <pid>
opx_devpool_record() {
  devpool_available || return 0
  devpool_record "${DEVPOOL_PROJECT}" "${DEVPOOL_AGENT}" "$1" "$2" "$3" || true
}

# Release a device we own. No-op when devpool is absent.
#   opx_devpool_release avd|sim <device_id>
opx_devpool_release() {
  devpool_available || return 0
  devpool_release "${DEVPOOL_PROJECT}" "${DEVPOOL_AGENT}" "$1" "$2" || true
}

# Reap ONLY devices recorded under our project/agent identity.
opx_devpool_reap() {
  devpool_available || return 0
  devpool_reap "${DEVPOOL_PROJECT}" "${DEVPOOL_AGENT}" || true
}

# Reserved-port lookup with a safe fallback. The 4000-12199 range belongs to
# yondi and is never ours; until devpool's ports.json assigns our block, the
# fallback stays far above it.
#   opx_devpool_port <name> <fallback>
opx_devpool_port() {
  if devpool_available && command -v devpool_port >/dev/null 2>&1; then
    devpool_port "${DEVPOOL_PROJECT}" "$1" 2>/dev/null && return 0
  fi
  echo "$2"
}
