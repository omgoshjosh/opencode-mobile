#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)

# Resolve the SDK explicitly rather than inheriting it. Gradle needs it to
# configure :app at all, and apksigner is looked up under it below; leaving it
# to the caller's shell meant the script passed interactively and failed under
# CI/background shells with a misleading "SDK location not found".
ANDROID_HOME=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}
export ANDROID_HOME
if [[ ! -d "$ANDROID_HOME/build-tools" ]]; then
  echo "Android SDK not found at: $ANDROID_HOME" >&2
  echo "Set ANDROID_HOME (or ANDROID_SDK_ROOT) to your SDK location." >&2
  exit 1
fi

KEYSTORE=${OPENCODEX_MOBILE_KEYSTORE:-$HOME/.config/opencodex-mobile/evaluation-release.keystore}
KEY_ALIAS=${OPENCODEX_MOBILE_KEY_ALIAS:-opencodex-evaluation}
KEYCHAIN_SERVICE=${OPENCODEX_MOBILE_KEYCHAIN_SERVICE:-opencodex-mobile-evaluation-keystore}
BUILD_VERSION_CODE=${BUILD_VERSION_CODE:-$(($(date +%s) / 60))}

if [[ ! -f "$KEYSTORE" ]]; then
  echo "Missing signing key: $KEYSTORE" >&2
  exit 1
fi

if (( BUILD_VERSION_CODE < 1 || BUILD_VERSION_CODE > 2100000000 )); then
  echo "BUILD_VERSION_CODE must be between 1 and 2100000000" >&2
  exit 1
fi

PASSWORD=$(security find-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w)

cd "$ROOT"
npm ci --legacy-peer-deps
npm run check:versions
npm run typecheck
npm test

cd android
NODE_ENV=production \
SENTRY_DISABLE_AUTO_UPLOAD=true \
BUILD_VERSION_CODE="$BUILD_VERSION_CODE" \
RELEASE_STORE_FILE="$KEYSTORE" \
RELEASE_STORE_PASSWORD="$PASSWORD" \
RELEASE_KEY_ALIAS="$KEY_ALIAS" \
RELEASE_KEY_PASSWORD="$PASSWORD" \
./gradlew assembleRelease

APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
APKSIGNER=$(ls "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)
"$APKSIGNER" verify --verbose --print-certs "$APK"
echo "Built $APK (version code $BUILD_VERSION_CODE)"
