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

## Firebase App Distribution (configured 2026-08-15)

Live and working. Builds reach the phone over HTTPS via the Firebase App Tester
app — no cable, no ADB pairing.

| | |
|---|---|
| Firebase project | `opencodex-mobile-eval` |
| App ID | `1:710010541266:android:0d3ebbc82c6e565531890b` |
| Package | `cc.agentlabs.opencode.eval` |
| Tester group | `evaluation-testers` |

### Distributing manually

```bash
firebase appdistribution:distribute \
  android/app/build/outputs/apk/release/app-release.apk \
  --app 1:710010541266:android:0d3ebbc82c6e565531890b \
  --project opencodex-mobile-eval \
  --groups evaluation-testers \
  --release-notes "..."
```

### Side-by-side install

`EVALUATION_APP_ID_SUFFIX=.eval` builds under a distinct `applicationId` and
launcher label ("OpenCode (Eval)"), so the evaluation build installs *alongside*
a Play-Store build signed with a different key. Without it, Android refuses the
install (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) and the only way through is an
uninstall that destroys the store build's settings.

### CI secrets

Set on `omgoshjosh/opencode-mobile`:

- `EVALUATION_KEYSTORE_BASE64` ✅
- `EVALUATION_KEYSTORE_PASSWORD` ✅
- `FIREBASE_APP_ID` ✅
- `FIREBASE_TESTER_GROUP` ✅
- `FIREBASE_SERVICE_ACCOUNT_JSON` ❌ **outstanding**

**Why the last one is outstanding.** Minting a service-account key needs
`gcloud` (not installed) or the Google Cloud console — both require an
interactive OAuth login, which cannot be done from an automated session. It is
also a long-lived credential, so it is the right thing to create deliberately.

To finish, in the [service accounts console](https://console.cloud.google.com/iam-admin/serviceaccounts?project=opencodex-mobile-eval):

1. **Create service account** — name e.g. `app-distribution-ci`
2. Grant the role **Firebase App Distribution Admin**
3. **Keys → Add key → Create new key → JSON**, download it
4. `gh secret set FIREBASE_SERVICE_ACCOUNT_JSON -R omgoshjosh/opencode-mobile < ~/Downloads/<key>.json`
5. Delete the downloaded file

Until then, distribution runs from this machine with the developer's own
Firebase login, which works but is not automated.
