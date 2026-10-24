# Skycord for Android

A Kotlin app around Android's WebView. It opens each server's own web client,
the way the Windows app does, and adds what the web cannot do on a phone. The
design is `docs/superpowers/specs/2026-10-05-android-shell-design.md`.

## Toolchain

Everything lives on H: (`H:\android`): JDK 17, the Android SDK, Gradle's cache,
the emulator. In a bash shell:

```bash
source android/env.sh
```

## Build and test

```bash
cd android
./gradlew test             # JVM unit tests (core/)
./gradlew assembleDebug    # app/build/outputs/apk/debug/app-debug.apk
```

The launcher page is built by `npm run build:launcher` (repo root), which Gradle
runs before every build.

## Run on the emulator

```bash
emulator -avd skycord35 -ports 6554,6555 -no-snapshot -no-audio &
adb wait-for-device
adb reverse tcp:6200 tcp:6200     # the dev client, as http://localhost:6200 — a secure page
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n xyz.skycord.android/.MainActivity
```

Windows reserves TCP 5041–5740 on this machine, which covers the emulator's
default ports (5554–5682); without `-ports` it exits silently, and adb then
calls the device `emulator-6554`.

Debug builds allow `chrome://inspect` on the WebView.

## End to end

Both scripts need the emulator running, the debug APK installed and the dev
servers up; each script's header says exactly what it needs and what it does to
the machine.

```bash
node android/e2e/shell.e2e.mjs    # the app shell
node android/e2e/notify.e2e.mjs   # notifications, replies, calls, catch-up, reboot
```

`notify.e2e.mjs` takes several minutes and reboots the emulator at the end. Each
run uses three of the dev API's register and sign-in allowance (10 per address
per 15 minutes). With more than one emulator up, name yours with
`ANDROID_SERIAL`.

## Releasing

Before the first tag, the owner sets these in the repository's Settings, Secrets
and variables, Actions:

| Kind | Name | What |
|---|---|---|
| secret | `ANDROID_KEYSTORE_BASE64` | the signing keystore, `base64 -w0 skycord-release.jks` |
| secret | `ANDROID_KEYSTORE_PASSWORD` | its store password |
| secret | `ANDROID_KEY_ALIAS` | the key's alias (`skycord`) |
| secret | `ANDROID_KEY_PASSWORD` | the key's password |
| secret | `ANDROID_RELEASES_TOKEN` | fine-grained token, Contents read and write on `xSMDx/skycord-android-releases` only |
| **variable** | `ANDROID_CERT_SHA256` | the signing certificate's SHA-256 — the `SHA256:` line of `keytool -list -v -keystore skycord-release.jks -alias skycord` (colons optional) |

Set `ANDROID_CERT_SHA256` when the key is made. The workflow refuses to run if
any of the six is missing, and refuses to publish an APK whose signing
certificate is not that one: phones that already have the app only update to
an APK signed by the same key.

Then tag `android-vX.Y.Z` and push the tag. `.github/workflows/android-release.yml`
checks the tag and the settings first, then builds an **unsigned** APK with no
secrets in the environment (npm, Gradle and the tests never see the key); a
separate step zipaligns and signs it with the keystore and checks the
certificate; then it publishes to `xSMDx/skycord-android-releases` with
`latest.json`, which installed apps check. The signing key is the GitHub secret
`ANDROID_KEYSTORE_BASE64`; **the owner keeps an offline copy** — without that
key, no installed phone can ever update again.

**Before publishing an APK, the hosted server must already serve the new web
client** (the app loads each server's own web client, so a new app talking to an
old client is a broken release). Deploy first, then tag.
