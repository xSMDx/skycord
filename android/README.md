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
adb reverse tcp:5500 tcp:5500     # the dev client, as http://localhost:5500 — a secure page
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n xyz.skycord.android/.MainActivity
```

Windows reserves TCP 5541–5740 on this machine, which covers the emulator's
default ports (5554–5682); without `-ports` it exits silently, and adb then
calls the device `emulator-6554`.

Debug builds allow `chrome://inspect` on the WebView.

## End to end

`node android/e2e/shell.e2e.mjs` with the emulator running, the debug APK
installed and the dev servers up. See the script's header.

## Releasing

Tag `android-vX.Y.Z` and push the tag. `.github/workflows/android-release.yml`
builds, signs and publishes to `xSMDx/skycord-android-releases` with
`latest.json`, which installed apps check. The signing key is the GitHub secret
`ANDROID_KEYSTORE_BASE64`; **the owner keeps an offline copy** — without that
key, no installed phone can ever update again.
