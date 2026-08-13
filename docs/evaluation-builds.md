# Evaluation Android Builds

This checkout produces privately signed OpencodeX evaluation builds without selecting this client as the permanent mobile base.

## Local build

The signing key is stored outside the repository at:

```text
~/.config/opencodex-mobile/evaluation-release.keystore
```

Its password is stored in macOS Keychain under `opencodex-mobile-evaluation-keystore`. Build and verify an APK with:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
./scripts/build-evaluation-apk.sh
```

The artifact is `android/app/build/outputs/apk/release/app-release.apk`. The script derives an increasing `versionCode` from Unix minutes; override it with `BUILD_VERSION_CODE` when needed.

## Cable-free delivery

Use the manually triggered `Distribute evaluation APK` GitHub Actions workflow with Firebase App Distribution. This requires a private repository and these Actions secrets:

- `EVALUATION_KEYSTORE_BASE64`
- `EVALUATION_KEYSTORE_PASSWORD`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_APP_ID`
- `FIREBASE_TESTER_GROUP`

Register Firebase Android package `cc.agentlabs.opencode`, create a tester group, and invite the Google account used on the phone. Each workflow run must use a version code greater than every prior installed build.

The first evaluation install cannot replace an upstream build signed with another certificate. Uninstalling that build removes its local app data. Once the evaluation build is installed, later builds signed with this evaluation key install as updates and preserve data.

Do not commit the keystore, password, or Firebase service-account JSON. Back up the keystore and password together; losing either prevents future in-place updates.
