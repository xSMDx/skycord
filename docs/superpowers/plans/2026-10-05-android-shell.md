# Android Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installable Android app (APK) that opens any Skycord server's own web client, with a server picker, an origin-checked native bridge, the back button, its own updates, and a release pipeline.

**Architecture:** A Kotlin app with one activity around Android's WebView, following the Windows app's model: the WebView loads each saved server's own client; a bridge (`window.skycordAndroid`) exists only on saved-server origins, through `WebViewCompat.addWebMessageListener` plus a document-start shim; a launcher page bundled in the APK (served from `https://appassets.androidplatform.net`) picks and saves servers, reusing the desktop's address module. Decisions live in pure Kotlin classes under `core/`, unit-tested on the JVM; Android glue stays thin.

**Tech Stack:** Kotlin 2.0, Android Gradle Plugin 8.7, Gradle 8.10, AndroidX WebKit 1.12, JUnit 4, org.json (tests); Vite + TypeScript for the launcher; Vitest; Playwright `_android` for end-to-end; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-05-android-shell-design.md`

## Global Constraints

- Android only, APK, `minSdk 26` (Android 8.0), `targetSdk 35`, `compileSdk 35`, JDK 17.
- Application id `xyz.skycord.android`. Releases repo `xSMDx/skycord-android-releases`. Tags `android-vX.Y.Z`.
- Launcher origin `https://appassets.androidplatform.net`; launcher URL `https://appassets.androidplatform.net/assets/launcher/index.html`.
- The bridge exists only on saved-server origins (and the launcher gets only its own launcher API). Every message is re-checked by origin and main frame on the native side.
- WebView must support `WEB_MESSAGE_LISTENER` and `DOCUMENT_START_SCRIPT` (Chromium 86+); otherwise the app shows the "update Android System WebView" screen and loads nothing.
- `http://` servers are allowed; the launcher states voice will not work there.
- Back button: offered to the page; 300 ms of silence counts as unused; unused means `moveTaskToBack(true)`, never quit.
- Toolchain lives on **H:** (`H:\android`); C: has no free space. `GRADLE_USER_HOME`, `ANDROID_USER_HOME`, `ANDROID_AVD_HOME` all point under `H:\android`.
- Downloads (JDK, SDK, Gradle, system images) need the owner's go-ahead before they start.
- Never `git add -A`; stage files by name. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit locally; push only when asked.
- Copy is plain and in the product's voice: sentence case, no exclamation marks, errors say what happened and what to do.

## File structure

```
android/
  README.md                         toolchain, build, test, release — the how-to
  env.sh                            sources the H: toolchain into a bash shell
  settings.gradle.kts  build.gradle.kts  gradle.properties
  gradle/libs.versions.toml         every version in one place
  gradlew  gradlew.bat  gradle/wrapper/   generated wrapper
  app/build.gradle.kts              app module: versions, signing, launcher build task
  app/src/main/AndroidManifest.xml
  app/src/main/res/                 layouts, strings, theme, icon, FileProvider paths
  app/src/main/assets/bridge/app-shim.js        window.skycordAndroid (server pages)
  app/src/main/assets/bridge/launcher-shim.js   window.skycordLauncher (launcher page)
  app/src/main/java/xyz/skycord/android/
    core/Origins.kt                 address → origin, exactly like `new URL(x).origin`
    core/NavigationPolicy.kt        stay in the WebView / browser / block
    core/BackGate.kt                the back button's question to the page, with a timeout
    core/BridgeProtocol.kt          the JSON messages between page and app
    core/SavedServers.kt            the saved list, as desktop/src/servers.ts has it
    core/ServerStore.kt             the list + last-used, over a key-value store
    core/CssColor.kt                CSS colour → ARGB, and light or dark
    core/UpdateFeed.kt              latest.json: parse, trust, compare versions
    core/UpdateState.kt             the desktop's update state machine, in Kotlin
    core/PickerTypes.kt             an <input accept> as MIME types for the picker
    PrefsKeyValue.kt                ServerStore's storage on SharedPreferences
    InstanceFetch.kt                native GET <origin>/instance
    UpdateManager.kt                check, download, verify, hand to the installer
    BridgeHost.kt                   registers the bridge and answers its calls
    SystemBars.kt                   insets padding and bar colours
    MainActivity.kt                 the WebView, its clients, screens, back button
  app/src/test/java/xyz/skycord/android/core/   JVM unit tests
  launcher/index.html  launcher/main.ts  launcher/view.ts  launcher/launcher.css
  launcher/vite.config.ts  launcher/__tests__/view.test.ts
  e2e/shell.e2e.mjs                 Playwright on the emulator
.github/workflows/android-release.yml
src/composables/desktopBridge.ts    appBridge(): desktop or Android
src/composables/androidBack.ts      the page's half of the back button
src/composables/androidChrome.ts    theme colours to the system bars
src/composables/diagnosticsText.ts  an Android line
src/views/ChatApp.vue               wires back + chrome
vitest.config.mts  package.json  landing/index.html
```

---

### Task 1: The toolchain on H:

**Files:**
- Create: `android/env.sh`
- Create: `android/README.md`

**Interfaces:**
- Produces: `source android/env.sh` gives a bash shell with `java` (17), `sdkmanager`, `adb`, `emulator`, `gradle` on PATH and the H: homes set. Every later task runs commands after sourcing it.

- [ ] **Step 1: Ask the owner before downloading.** Tell them exactly what will be fetched, from where, and roughly how big:
  - Eclipse Temurin JDK 17, Windows x64 zip, from `api.adoptium.net` (~190 MB)
  - Android command-line tools for Windows, from `dl.google.com` (~150 MB)
  - Gradle 8.10.2 binary zip, from `services.gradle.org` (~130 MB), used once to generate the wrapper
  - Through `sdkmanager`: platform-tools, `platforms;android-35`, `build-tools;35.0.0`, `emulator`, and `system-images;android-35;google_apis;x86_64` (~2.5 GB together)
  - Optional, for the old-WebView test in Task 12: `system-images;android-26;google_apis;x86` (~900 MB)
  Do not continue until they say yes.

- [ ] **Step 2: Download and unpack into `H:\android`**

```bash
mkdir -p /h/android && cd /h/android
curl -L -o jdk17.zip "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"
unzip -q jdk17.zip && mv jdk-17* jdk-17 && rm jdk17.zip
curl -L -o cmdline-tools.zip "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
mkdir -p sdk/cmdline-tools && unzip -q cmdline-tools.zip -d sdk/cmdline-tools && mv sdk/cmdline-tools/cmdline-tools sdk/cmdline-tools/latest && rm cmdline-tools.zip
curl -L -o gradle.zip "https://services.gradle.org/distributions/gradle-8.10.2-bin.zip"
unzip -q gradle.zip && rm gradle.zip
mkdir -p gradle-home android-home avd
```

- [ ] **Step 3: Write `android/env.sh`**

```bash
#!/usr/bin/env bash
# Source this, don't run it: `source android/env.sh`.
# The Android toolchain lives on H: because C: has no free space, and every
# tool that would otherwise write into the user profile is pointed at H: too.
#
# The variables are Windows paths (H:/...) because Java, Gradle and the SDK
# tools are Windows programs and read them as such; PATH is bash's own, so it
# takes the /h/... form. On Windows the SDK manager is sdkmanager.bat and the
# AVD manager avdmanager.bat — bash does not add the .bat for you.
export ANDROID_ROOT="H:/android"
export JAVA_HOME="$ANDROID_ROOT/jdk-17"
export ANDROID_HOME="$ANDROID_ROOT/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="$ANDROID_ROOT/gradle-home"
export ANDROID_USER_HOME="$ANDROID_ROOT/android-home"
export ANDROID_AVD_HOME="$ANDROID_ROOT/avd"
export PATH="/h/android/jdk-17/bin:/h/android/sdk/cmdline-tools/latest/bin:/h/android/sdk/platform-tools:/h/android/sdk/emulator:/h/android/gradle-8.10.2/bin:$PATH"
```

- [ ] **Step 4: Install SDK packages and create the emulator**

```bash
source android/env.sh
yes | sdkmanager.bat --licenses >/dev/null
sdkmanager.bat "platform-tools" "platforms;android-35" "build-tools;35.0.0" "emulator" "system-images;android-35;google_apis;x86_64"
echo no | avdmanager.bat create avd -n skycord35 -k "system-images;android-35;google_apis;x86_64" -d pixel_6
```

- [ ] **Step 5: Verify**

Run: `source android/env.sh && java -version 2>&1 | head -1 && sdkmanager.bat --list_installed | grep -E "platforms;android-35|build-tools;35" && avdmanager.bat list avd | grep skycord35`
Expected: `openjdk version "17.…"`, both packages listed, `Name: skycord35`.

Run: `source android/env.sh && emulator -avd skycord35 -ports 6554,6555 -no-snapshot -no-audio -gpu swiftshader_indirect &` then `adb wait-for-device && adb shell getprop sys.boot_completed`
Expected (after a minute or two): `1`. If the emulator says hardware acceleration is unavailable, the Windows Hypervisor Platform feature must be on — report that to the owner instead of continuing.

- [ ] **Step 6: Write `android/README.md`**

````markdown
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
````

- [ ] **Step 7: Commit**

```bash
git add android/env.sh android/README.md
git commit -m "Android: toolchain on H:, and the how-to

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The Gradle project, and `Origins`

**Files:**
- Create: `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, `android/gradle/libs.versions.toml`, `android/.gitignore`
- Create: `android/app/build.gradle.kts`, `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/res/values/strings.xml`, `android/app/src/main/res/values/themes.xml`
- Create: `android/app/src/main/java/xyz/skycord/android/MainActivity.kt` (placeholder, replaced in Task 8)
- Create: `android/app/src/main/java/xyz/skycord/android/core/Origins.kt`
- Test: `android/app/src/test/java/xyz/skycord/android/core/OriginsTest.kt`

**Interfaces:**
- Produces: `Origins.normalise(input: String): String?` (no scheme → https), `Origins.of(url: String): String?` (http(s) only; lower-case; default ports dropped). Same answers as the desktop's `normaliseAddress` and `new URL(x).origin`.

- [ ] **Step 1: Write the build files**

`android/settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "skycord-android"
include(":app")
```

`android/build.gradle.kts`:

```kotlin
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
}
```

`android/gradle.properties`:

```properties
org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
```

`android/gradle/libs.versions.toml`:

```toml
[versions]
agp = "8.7.3"
kotlin = "2.0.21"
core = "1.13.1"
appcompat = "1.7.0"
activity = "1.9.3"
webkit = "1.12.1"
junit = "4.13.2"
orgjson = "20240303"

[libraries]
androidx-core = { group = "androidx.core", name = "core-ktx", version.ref = "core" }
androidx-appcompat = { group = "androidx.appcompat", name = "appcompat", version.ref = "appcompat" }
androidx-activity = { group = "androidx.activity", name = "activity-ktx", version.ref = "activity" }
androidx-webkit = { group = "androidx.webkit", name = "webkit", version.ref = "webkit" }
junit = { group = "junit", name = "junit", version.ref = "junit" }
orgjson = { group = "org.json", name = "json", version.ref = "orgjson" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
```

`android/.gitignore`:

```gitignore
.gradle/
build/
local.properties
*.keystore
*.jks
app/src/main/assets/launcher/
```

`android/app/build.gradle.kts`:

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// The release workflow passes -PappVersion=X.Y.Z from the tag. versionCode
// must only ever grow, so it is derived from the version, not counted.
val appVersion = (findProperty("appVersion") as String?) ?: "0.21.0"
val (vMajor, vMinor, vPatch) = appVersion.split(".").map { it.toInt() }

android {
    namespace = "xyz.skycord.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "xyz.skycord.android"
        minSdk = 26
        targetSdk = 35
        versionName = appVersion
        versionCode = vMajor * 10000 + vMinor * 100 + vPatch
    }

    signingConfigs {
        create("release") {
            // From the release workflow's secrets. Absent locally, so a local
            // release build is unsigned and cannot be mistaken for a real one.
            System.getenv("SKYCORD_KEYSTORE")?.let { path ->
                storeFile = file(path)
                storePassword = System.getenv("SKYCORD_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("SKYCORD_KEY_ALIAS")
                keyPassword = System.getenv("SKYCORD_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug { versionNameSuffix = "-debug" }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(libs.androidx.core)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.webkit)
    testImplementation(libs.junit)
    // Android's own org.json is a stub in JVM unit tests; this is the real one.
    testImplementation(libs.orgjson)
}
```

`android/app/src/main/AndroidManifest.xml` (completed in Task 8):

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:label="@string/app_name"
        android:theme="@style/Theme.Skycord"
        android:supportsRtl="true">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

`android/app/src/main/res/values/strings.xml`:

```xml
<resources>
    <string name="app_name">Skycord</string>
</resources>
```

`android/app/src/main/res/values/themes.xml`:

```xml
<resources>
    <style name="Theme.Skycord" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="android:windowBackground">#111214</item>
    </style>
</resources>
```

`android/app/src/main/java/xyz/skycord/android/MainActivity.kt` (placeholder):

```kotlin
package xyz.skycord.android

import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity()
```

- [ ] **Step 2: Generate the wrapper and check the empty build**

Run: `source android/env.sh && cd android && gradle wrapper --gradle-version 8.10.2 && ./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`; `app/build/outputs/apk/debug/app-debug.apk` exists.

- [ ] **Step 3: Write the failing test** — `android/app/src/test/java/xyz/skycord/android/core/OriginsTest.kt`

```kotlin
package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OriginsTest {
    @Test fun anAddressWithoutAScheme_isHttps() {
        assertEquals("https://chat.example.com", Origins.normalise("chat.example.com"))
    }

    @Test fun case_paths_and_defaultPorts_disappear() {
        assertEquals("https://chat.example.com", Origins.normalise("  HTTPS://Chat.Example.com:443/a/b?c=1 "))
        assertEquals("http://box", Origins.normalise("http://box:80/"))
    }

    @Test fun aRealPort_and_plainHttp_stay() {
        assertEquals("http://10.0.0.5:3001", Origins.normalise("http://10.0.0.5:3001"))
        assertEquals("https://chat.example.com:8443", Origins.normalise("https://chat.example.com:8443"))
        assertEquals("http://[::1]:5500", Origins.normalise("http://[::1]:5500/"))
    }

    @Test fun anythingElse_isNotAnAddress() {
        // "host:port" without a scheme reads as scheme "host" — the desktop's
        // normaliseAddress refuses it too, and the two must agree.
        for (bad in listOf("", "   ", "a b", "ftp://x.com", "javascript:alert(1)", "file:///sdcard/x", "https://", "localhost:5500")) {
            assertNull(bad, Origins.normalise(bad))
        }
    }

    @Test fun theOriginOfAFullUrl() {
        assertEquals("https://app.skycord.xyz", Origins.of("https://app.skycord.xyz/channels/1?x=2#y"))
        assertEquals("http://localhost:5500", Origins.of("http://localhost:5500/"))
        assertNull(Origins.of("intent://scan/#Intent;end"))
        assertNull(Origins.of("chat.example.com"))
    }
}
```

- [ ] **Step 4: Run it and see it fail**

Run: `source android/env.sh && cd android && ./gradlew test`
Expected: compilation fails — `Unresolved reference: Origins`.

- [ ] **Step 5: Implement** — `android/app/src/main/java/xyz/skycord/android/core/Origins.kt`

```kotlin
package xyz.skycord.android.core

import java.net.URI

/**
 * Origins as the web means them — scheme://host[:port], lower-case, default
 * ports dropped — the same answer as `new URL(x).origin`, which is what the
 * desktop app and the web client compare. Every origin check in the app goes
 * through here, so the bridge and the navigation rules can never disagree
 * about what "the same server" means.
 */
object Origins {
    // The same test as normaliseAddress in desktop/src/instanceAddress.ts.
    private val SCHEME = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:")

    /** An address as typed ("chat.example.com", "http://10.0.0.5:3001"), or null. No scheme means https. */
    fun normalise(input: String): String? {
        val text = input.trim()
        if (text.isEmpty() || text.any { it.isWhitespace() }) return null
        return of(if (SCHEME.containsMatchIn(text)) text else "https://$text")
    }

    /** The origin of a full URL, or null when it is not an http(s) URL with a host. */
    fun of(url: String): String? {
        val uri = try { URI(url) } catch (e: Exception) { return null }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "https" && scheme != "http") return null
        val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        val default = if (scheme == "https") 443 else 80
        return if (uri.port == -1 || uri.port == default) "$scheme://$host" else "$scheme://$host:${uri.port}"
    }
}
```

- [ ] **Step 6: Run the tests**

Run: `source android/env.sh && cd android && ./gradlew test`
Expected: `BUILD SUCCESSFUL`, 5 tests in `OriginsTest` pass.

- [ ] **Step 7: Commit**

`gradlew` was generated on Windows, so git would record it without the executable bit and CI's `./gradlew` would be refused. Mark it first.

```bash
git add android/gradlew && git update-index --chmod=+x android/gradlew
git add android/settings.gradle.kts android/build.gradle.kts android/gradle.properties android/gradle/libs.versions.toml android/.gitignore android/gradlew android/gradlew.bat android/gradle/wrapper/gradle-wrapper.jar android/gradle/wrapper/gradle-wrapper.properties android/app/build.gradle.kts android/app/src/main/AndroidManifest.xml android/app/src/main/res/values/strings.xml android/app/src/main/res/values/themes.xml android/app/src/main/java/xyz/skycord/android/MainActivity.kt android/app/src/main/java/xyz/skycord/android/core/Origins.kt android/app/src/test/java/xyz/skycord/android/core/OriginsTest.kt
git commit -m "Android: the Gradle project, and origins the way the web means them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Navigation, the back button's gate, and the bridge protocol

**Files:**
- Create: `android/app/src/main/java/xyz/skycord/android/core/NavigationPolicy.kt`
- Create: `android/app/src/main/java/xyz/skycord/android/core/BackGate.kt`
- Create: `android/app/src/main/java/xyz/skycord/android/core/BridgeProtocol.kt`
- Test: `android/app/src/test/java/xyz/skycord/android/core/NavigationPolicyTest.kt`, `BackGateTest.kt`, `BridgeProtocolTest.kt`

**Interfaces:**
- Consumes: `Origins.of(url)`.
- Produces:
  - `enum class Nav { STAY, BROWSER, BLOCK }`; `NavigationPolicy.decide(url: String, server: String?, launcher: String): Nav`
  - `enum class BackAction { DONE, TO_BACKGROUND }`; `class BackGate(timeoutMs: Long = 300)` with `ask(): Int`, `answer(id: Int, used: Boolean): BackAction?`, `timeout(id: Int): BackAction?`, `val timeoutMs: Long`
  - `sealed interface Incoming { data object Hello; data class BackAnswer(id: Int, used: Boolean); data class Call(id: Int?, method: String, args: org.json.JSONArray) }`; `BridgeProtocol.parse(text: String): Incoming?`, `BridgeProtocol.reply(id: Int, value: Any?): String`, `BridgeProtocol.error(id: Int, message: String): String`, `BridgeProtocol.event(name: String, value: Any?): String`

- [ ] **Step 1: Write the failing tests**

`NavigationPolicyTest.kt`:

```kotlin
package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationPolicyTest {
    private val launcher = "https://appassets.androidplatform.net"
    private val server = "https://chat.example.com"

    @Test fun theServersOwnPages_stay() {
        assertEquals(Nav.STAY, NavigationPolicy.decide("https://chat.example.com/channels/1", server, launcher))
    }

    @Test fun theLauncher_stays() {
        assertEquals(Nav.STAY, NavigationPolicy.decide("$launcher/assets/launcher/index.html", null, launcher))
    }

    @Test fun otherSites_openInTheBrowser() {
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("https://example.org/a", server, launcher))
        // Another saved server too: switching happens through the app, not a link.
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("https://other.example.com/", server, launcher))
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("mailto:a@b.c", server, launcher))
        assertEquals(Nav.BROWSER, NavigationPolicy.decide("tel:+100", server, launcher))
    }

    @Test fun anythingThatIsNotAWebPage_isBlocked() {
        for (url in listOf("intent://x#Intent;end", "file:///sdcard/a", "javascript:alert(1)", "content://x", "data:text/html,hi")) {
            assertEquals(url, Nav.BLOCK, NavigationPolicy.decide(url, server, launcher))
        }
    }
}
```

`BackGateTest.kt`:

```kotlin
package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BackGateTest {
    @Test fun thePageUsedIt() {
        val g = BackGate()
        assertEquals(BackAction.DONE, g.answer(g.ask(), used = true))
    }

    @Test fun thePageDidNotUseIt_soTheAppGoesToTheBackground() {
        val g = BackGate()
        assertEquals(BackAction.TO_BACKGROUND, g.answer(g.ask(), used = false))
    }

    @Test fun silence_countsAsUnused_andALateAnswerIsIgnored() {
        val g = BackGate()
        val id = g.ask()
        assertEquals(BackAction.TO_BACKGROUND, g.timeout(id))
        assertNull(g.answer(id, used = true))
    }

    @Test fun anAnswerArrivingFirst_cancelsTheTimeout() {
        val g = BackGate()
        val id = g.ask()
        assertEquals(BackAction.DONE, g.answer(id, used = true))
        assertNull(g.timeout(id))
    }

    @Test fun aNewPress_supersedesTheOld() {
        val g = BackGate()
        val first = g.ask()
        val second = g.ask()
        assertNull(g.answer(first, used = true))
        assertEquals(BackAction.DONE, g.answer(second, used = true))
    }

    @Test fun theTimeoutIs300ms() {
        assertEquals(300L, BackGate().timeoutMs)
    }
}
```

`BridgeProtocolTest.kt`:

```kotlin
package xyz.skycord.android.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeProtocolTest {
    @Test fun hello() {
        assertEquals(Incoming.Hello, BridgeProtocol.parse("""{"type":"hello"}"""))
    }

    @Test fun aBackAnswer() {
        assertEquals(Incoming.BackAnswer(7, true), BridgeProtocol.parse("""{"type":"back","id":7,"used":true}"""))
        assertEquals(Incoming.BackAnswer(7, false), BridgeProtocol.parse("""{"type":"back","id":7}"""))
    }

    @Test fun aCall_withAndWithoutAnId() {
        val c = BridgeProtocol.parse("""{"type":"call","id":3,"method":"launcher.open","args":["https://x.y"]}""") as Incoming.Call
        assertEquals(3, c.id)
        assertEquals("launcher.open", c.method)
        assertEquals("https://x.y", c.args.getString(0))
        val fire = BridgeProtocol.parse("""{"type":"call","method":"colors","args":[{}]}""") as Incoming.Call
        assertNull(fire.id)
    }

    @Test fun garbage_isNothing() {
        for (bad in listOf("", "nope", "[]", """{"type":"call"}""", """{"type":"other"}""", """{"type":"call","method":"${"x".repeat(80)}"}""")) {
            assertNull(bad, BridgeProtocol.parse(bad))
        }
    }

    // Parsed back, not compared as text: org.json's key order is not fixed.
    @Test fun repliesErrorsAndEvents() {
        val empty = JSONObject(BridgeProtocol.reply(3, null))
        assertTrue(empty.getString("type") == "reply" && empty.getInt("id") == 3 && empty.has("value") && empty.isNull("value"))
        val r = JSONObject(BridgeProtocol.reply(4, JSONObject().put("a", 1)))
        assertEquals(1, r.getJSONObject("value").getInt("a"))
        val e = JSONObject(BridgeProtocol.error(5, "nope"))
        assertEquals("nope", e.getString("error"))
        val ev = JSONObject(BridgeProtocol.event("back", 9))
        assertTrue(ev.getString("type") == "event" && ev.getString("name") == "back" && ev.getInt("value") == 9)
    }
}
```

- [ ] **Step 2: Run them and see them fail**

Run: `source android/env.sh && cd android && ./gradlew test`
Expected: compilation fails on `NavigationPolicy`, `BackGate`, `Incoming`, `BridgeProtocol`.

- [ ] **Step 3: Implement**

`NavigationPolicy.kt`:

```kotlin
package xyz.skycord.android.core

enum class Nav { STAY, BROWSER, BLOCK }

/**
 * Where a main-frame navigation goes. The WebView stays on the current
 * server's own pages and the launcher; any other web address opens in the
 * phone's browser; everything else — intent:, file:, javascript:, content:,
 * data: — is refused, because a page should never reach those through us.
 */
object NavigationPolicy {
    private val HANDOFF = setOf("mailto", "tel")

    fun decide(url: String, server: String?, launcher: String): Nav {
        val origin = Origins.of(url)
            ?: return if (url.substringBefore(':', "").lowercase() in HANDOFF) Nav.BROWSER else Nav.BLOCK
        if (origin == launcher) return Nav.STAY
        if (server != null && origin == server) return Nav.STAY
        return Nav.BROWSER
    }
}
```

`BackGate.kt`:

```kotlin
package xyz.skycord.android.core

enum class BackAction { DONE, TO_BACKGROUND }

/**
 * The back button is offered to the page first. The page answers whether it
 * used it; if it says nothing within the timeout it counts as unused, so a
 * hung page cannot trap the button. Only the newest press counts.
 */
class BackGate(val timeoutMs: Long = 300) {
    private var seq = 0
    private var pending: Int? = null

    fun ask(): Int {
        seq += 1
        pending = seq
        return seq
    }

    fun answer(id: Int, used: Boolean): BackAction? =
        settle(id)?.let { if (used) BackAction.DONE else BackAction.TO_BACKGROUND }

    fun timeout(id: Int): BackAction? = settle(id)?.let { BackAction.TO_BACKGROUND }

    private fun settle(id: Int): Unit? {
        if (pending != id) return null
        pending = null
        return Unit
    }
}
```

`BridgeProtocol.kt`:

```kotlin
package xyz.skycord.android.core

import org.json.JSONArray
import org.json.JSONObject

/** What the page sends. Anything that does not parse is dropped, not guessed at. */
sealed interface Incoming {
    data object Hello : Incoming
    data class BackAnswer(val id: Int, val used: Boolean) : Incoming
    data class Call(val id: Int?, val method: String, val args: JSONArray) : Incoming
}

object BridgeProtocol {
    private const val MAX_METHOD = 40

    fun parse(text: String): Incoming? = try {
        val o = JSONObject(text)
        when (o.optString("type")) {
            "hello" -> Incoming.Hello
            "back" -> Incoming.BackAnswer(o.getInt("id"), o.optBoolean("used", false))
            "call" -> {
                val method = o.getString("method")
                if (method.isEmpty() || method.length > MAX_METHOD) null
                else Incoming.Call(if (o.has("id")) o.getInt("id") else null, method, o.optJSONArray("args") ?: JSONArray())
            }
            else -> null
        }
    } catch (e: Exception) {
        null
    }

    fun reply(id: Int, value: Any?): String =
        JSONObject().put("type", "reply").put("id", id).put("value", value ?: JSONObject.NULL).toString()

    fun error(id: Int, message: String): String =
        JSONObject().put("type", "reply").put("id", id).put("error", message).toString()

    fun event(name: String, value: Any?): String =
        JSONObject().put("type", "event").put("name", name).put("value", value ?: JSONObject.NULL).toString()
}
```

- [ ] **Step 4: Run the tests**

Run: `source android/env.sh && cd android && ./gradlew test`
Expected: `BUILD SUCCESSFUL`; all tests in the four test classes pass.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/xyz/skycord/android/core/NavigationPolicy.kt android/app/src/main/java/xyz/skycord/android/core/BackGate.kt android/app/src/main/java/xyz/skycord/android/core/BridgeProtocol.kt android/app/src/test/java/xyz/skycord/android/core/NavigationPolicyTest.kt android/app/src/test/java/xyz/skycord/android/core/BackGateTest.kt android/app/src/test/java/xyz/skycord/android/core/BridgeProtocolTest.kt
git commit -m "Android: where a navigation goes, the back button's gate, and the bridge's messages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Saved servers, their store, and the native `/instance` fetch

**Files:**
- Create: `android/app/src/main/java/xyz/skycord/android/core/SavedServers.kt`
- Create: `android/app/src/main/java/xyz/skycord/android/core/ServerStore.kt`
- Create: `android/app/src/main/java/xyz/skycord/android/PrefsKeyValue.kt`
- Create: `android/app/src/main/java/xyz/skycord/android/InstanceFetch.kt`
- Test: `android/app/src/test/java/xyz/skycord/android/core/SavedServersTest.kt`, `ServerStoreTest.kt`

**Interfaces:**
- Consumes: `Origins.normalise`.
- Produces:
  - `data class SavedServer(val origin: String, val name: String, val icon: String?)` with `toJson(): JSONObject`
  - `SavedServers.read(json: String?): List<SavedServer>`, `write(list): String`, `entry(origin: String?, name: String?, icon: String?): SavedServer?`, `save(list, entry, keepName = false)`, `remove(list, origin)`, `hostOf(origin): String`
  - `fun JSONObject.stringOrNull(key: String): String?` (top-level in `core`) — null for a missing key or JSON null, on both Android's org.json and the JVM's
  - `interface KeyValue { fun get(key: String): String?; fun put(key: String, value: String?) }`
  - `class ServerStore(kv: KeyValue)`: `list()`, `save(origin, name, icon): List<SavedServer>`, `remove(origin)`, `last(): String?`, `setLast(origin: String?)`, `find(origin): SavedServer?`
  - `class PrefsKeyValue(context: Context) : KeyValue`
  - `InstanceFetch.get(origin: String): InstanceFetch.Answer?` — `data class Answer(val status: Int, val body: String)`; call off the main thread

- [ ] **Step 1: Write the failing tests**

`SavedServersTest.kt`:

```kotlin
package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SavedServersTest {
    private val a = SavedServer("https://a.example.com", "A", null)
    private val b = SavedServer("http://10.0.0.5:3001", "Home", "https://10.0.0.5/icon.png")

    @Test fun readsBackDefensively() {
        val json = """[
            {"origin":"https://A.example.com/","name":" A "},
            {"origin":"https://a.example.com","name":"duplicate"},
            {"origin":"ftp://bad"},
            {"name":"no origin"},
            "not an object",
            {"origin":"http://10.0.0.5:3001","name":"","icon":"javascript:alert(1)"}
        ]"""
        assertEquals(
            listOf(SavedServer("https://a.example.com", "A", null), SavedServer("http://10.0.0.5:3001", "10.0.0.5:3001", null)),
            SavedServers.read(json),
        )
        assertEquals(emptyList<SavedServer>(), SavedServers.read(null))
        assertEquals(emptyList<SavedServer>(), SavedServers.read("{oops"))
    }

    @Test fun roundTrips() {
        assertEquals(listOf(a, b), SavedServers.read(SavedServers.write(listOf(a, b))))
    }

    @Test fun aNewServerGoesLast_aKnownOneKeepsItsPlace() {
        val list = SavedServers.save(listOf(a), b)
        assertEquals(listOf(a, b), list)
        val again = SavedServers.save(list, SavedServer("https://a.example.com", "A renamed", "https://a.example.com/i.png"))
        assertEquals(listOf(SavedServer("https://a.example.com", "A renamed", "https://a.example.com/i.png"), b), again)
    }

    @Test fun keepNameKeepsAMembersOwnName_butReplacesTheDefault() {
        val mine = listOf(SavedServer("https://a.example.com", "My crew", null))
        assertEquals("My crew", SavedServers.save(mine, a, keepName = true)[0].name)
        val default = listOf(SavedServer("https://a.example.com", "a.example.com", null))
        assertEquals("A", SavedServers.save(default, a, keepName = true)[0].name)
    }

    @Test fun removeAndHost() {
        assertEquals(listOf(b), SavedServers.remove(listOf(a, b), a.origin))
        assertEquals("10.0.0.5:3001", SavedServers.hostOf(b.origin))
        assertEquals("a.example.com", SavedServers.hostOf(a.origin))
    }

    @Test fun aJsonNull_isNoValue() {
        val o = org.json.JSONObject("""{"icon":null,"name":"x"}""")
        assertNull(o.stringOrNull("icon"))
        assertNull(o.stringOrNull("missing"))
        assertEquals("x", o.stringOrNull("name"))
    }

    @Test fun anEntryNeedsAnAddress() {
        assertNull(SavedServers.entry("not an address", "x", null))
        assertEquals("x".repeat(64), SavedServers.entry("a.example.com", "x".repeat(100), null)!!.name)
    }
}
```

`ServerStoreTest.kt`:

```kotlin
package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerStoreTest {
    private class Memory : KeyValue {
        val map = mutableMapOf<String, String>()
        override fun get(key: String) = map[key]
        override fun put(key: String, value: String?) { if (value == null) map.remove(key) else map[key] = value }
    }

    @Test fun savesAndLists() {
        val store = ServerStore(Memory())
        store.save("chat.example.com", "Chat", null)
        assertEquals(listOf("https://chat.example.com"), store.list().map { it.origin })
        assertEquals("Chat", store.find("https://chat.example.com")?.name)
    }

    @Test fun lastIsOnlyEverASavedServer() {
        val store = ServerStore(Memory())
        store.save("https://chat.example.com", "Chat", null)
        store.setLast("https://chat.example.com")
        assertEquals("https://chat.example.com", store.last())
        store.remove("https://chat.example.com")
        assertNull(store.last())
    }

    @Test fun lastForgetsAnythingThatWasNeverSaved() {
        val kv = Memory()
        kv.put("last", "https://evil.example.com")
        assertNull(ServerStore(kv).last())
    }
}
```

- [ ] **Step 2: Run them and see them fail**

Run: `source android/env.sh && cd android && ./gradlew test`
Expected: compilation fails on `SavedServer`, `SavedServers`, `KeyValue`, `ServerStore`.

- [ ] **Step 3: Implement**

`SavedServers.kt`:

```kotlin
package xyz.skycord.android.core

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

data class SavedServer(val origin: String, val name: String, val icon: String?) {
    fun toJson(): JSONObject =
        JSONObject().put("origin", origin).put("name", name).put("icon", icon ?: JSONObject.NULL)
}

/**
 * A string field, or null when it is missing or JSON null. Android's own
 * org.json turns a JSON null into the text "null" through optString, the
 * JVM's does not; this answers the same on both.
 */
fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else optString(key)

/**
 * The saved servers as plain data, with the rules desktop/src/servers.ts
 * applies: read back defensively, one entry per origin, a name that falls back
 * to the address, and an icon only when it is a web address.
 */
object SavedServers {
    const val MAX_NAME = 64

    fun hostOf(origin: String): String {
        val u = URI(origin)
        return if (u.port == -1) u.host else "${u.host}:${u.port}"
    }

    private fun nameFor(name: String?, origin: String): String =
        name?.trim()?.take(MAX_NAME)?.takeIf { it.isNotEmpty() } ?: hostOf(origin)

    private fun iconFor(icon: String?): String? {
        if (icon == null) return null
        val scheme = try { URI(icon).scheme?.lowercase() } catch (e: Exception) { null }
        return if (scheme == "https" || scheme == "http") icon else null
    }

    fun entry(origin: String?, name: String?, icon: String?): SavedServer? {
        val o = origin?.let { Origins.normalise(it) } ?: return null
        return SavedServer(o, nameFor(name, o), iconFor(icon))
    }

    fun read(json: String?): List<SavedServer> {
        val arr = try { JSONArray(json ?: return emptyList()) } catch (e: Exception) { return emptyList() }
        val out = mutableListOf<SavedServer>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val e = entry(o.stringOrNull("origin"), o.stringOrNull("name"), o.stringOrNull("icon")) ?: continue
            if (out.none { it.origin == e.origin }) out += e
        }
        return out
    }

    fun write(list: List<SavedServer>): String = JSONArray(list.map { it.toJson() }).toString()

    fun save(list: List<SavedServer>, e: SavedServer, keepName: Boolean = false): List<SavedServer> {
        val at = list.indexOfFirst { it.origin == e.origin }
        if (at < 0) return list + e
        val old = list[at]
        val name = if (keepName && old.name != hostOf(old.origin)) old.name else e.name
        return list.mapIndexed { i, s -> if (i == at) SavedServer(e.origin, name, e.icon ?: old.icon) else s }
    }

    fun remove(list: List<SavedServer>, origin: String): List<SavedServer> = list.filter { it.origin != origin }
}
```

`ServerStore.kt`:

```kotlin
package xyz.skycord.android.core

interface KeyValue {
    fun get(key: String): String?
    fun put(key: String, value: String?)
}

/** The saved servers and the one used last, over any key-value store. */
class ServerStore(private val kv: KeyValue) {
    private companion object {
        const val SERVERS = "servers"
        const val LAST = "last"
    }

    fun list(): List<SavedServer> = SavedServers.read(kv.get(SERVERS))

    fun find(origin: String): SavedServer? = list().firstOrNull { it.origin == origin }

    fun save(origin: String, name: String?, icon: String?): List<SavedServer> {
        val e = SavedServers.entry(origin, name, icon) ?: return list()
        return write(SavedServers.save(list(), e, keepName = true))
    }

    fun remove(origin: String): List<SavedServer> = write(SavedServers.remove(list(), origin))

    /** The server opened last — only while it is still saved. */
    fun last(): String? = kv.get(LAST)?.takeIf { o -> list().any { it.origin == o } }

    fun setLast(origin: String?) = kv.put(LAST, origin)

    private fun write(list: List<SavedServer>): List<SavedServer> {
        kv.put(SERVERS, SavedServers.write(list))
        return list
    }
}
```

`PrefsKeyValue.kt`:

```kotlin
package xyz.skycord.android

import android.content.Context
import xyz.skycord.android.core.KeyValue

class PrefsKeyValue(context: Context) : KeyValue {
    private val prefs = context.getSharedPreferences("skycord", Context.MODE_PRIVATE)
    override fun get(key: String): String? = prefs.getString(key, null)
    override fun put(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
}
```

`InstanceFetch.kt`:

```kotlin
package xyz.skycord.android

import java.net.HttpURLConnection
import java.net.URL

/**
 * GET <origin>/instance, natively. The launcher is an https page and the
 * WebView would refuse its fetch to an http:// server — exactly the home
 * servers people add — so the lookup happens here and only the answer goes
 * back. Only ever this one path on an origin that has already been
 * normalised; never a URL a page chose.
 */
object InstanceFetch {
    data class Answer(val status: Int, val body: String)

    private const val MAX_BYTES = 64 * 1024

    fun get(origin: String): Answer? {
        try {
            val conn = URL("$origin/instance").openConnection() as HttpURLConnection
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Accept", "application/json")
            try {
                val status = conn.responseCode
                // -1 is "not HTTP"; anything outside 200–599 the page's Response() would throw on.
                if (status !in 200..599) return null
                val stream = if (status in 200..399) conn.inputStream else conn.errorStream
                val bytes = stream?.use { it.readNBytesCompat(MAX_BYTES) } ?: ByteArray(0)
                return Answer(status, String(bytes, Charsets.UTF_8))
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            return null
        }
    }

    private fun java.io.InputStream.readNBytesCompat(max: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (out.size() < max) {
            val n = read(buf, 0, minOf(buf.size, max - out.size()))
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `source android/env.sh && cd android && ./gradlew test`
Expected: `BUILD SUCCESSFUL`; `SavedServersTest` and `ServerStoreTest` pass with the earlier classes.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/xyz/skycord/android/core/SavedServers.kt android/app/src/main/java/xyz/skycord/android/core/ServerStore.kt android/app/src/main/java/xyz/skycord/android/PrefsKeyValue.kt android/app/src/main/java/xyz/skycord/android/InstanceFetch.kt android/app/src/test/java/xyz/skycord/android/core/SavedServersTest.kt android/app/src/test/java/xyz/skycord/android/core/ServerStoreTest.kt
git commit -m "Android: saved servers with the desktop's rules, and the native instance lookup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The update feed, the update state, and CSS colours

**Files:**
- Create: `android/app/src/main/java/xyz/skycord/android/core/UpdateFeed.kt`
- Create: `android/app/src/main/java/xyz/skycord/android/core/UpdateState.kt`
- Create: `android/app/src/main/java/xyz/skycord/android/core/CssColor.kt`
- Test: `UpdateFeedTest.kt`, `UpdateStateTest.kt`, `CssColorTest.kt` in `android/app/src/test/java/xyz/skycord/android/core/`

**Interfaces:**
- Produces:
  - `data class Feed(val version: String, val url: String, val sha256: String)`; `UpdateFeed.FEED_URL`, `UpdateFeed.DOWNLOAD_PREFIX`, `UpdateFeed.parse(text: String): Feed?`, `UpdateFeed.isNewer(candidate: String, current: String): Boolean`
  - `enum class UpdatePhase(val wire: String)`; `data class UpdateState(...)` with `toJson()`, `UpdateState.INITIAL`; `sealed interface UpdateEvent`; `fun reduce(s: UpdateState, e: UpdateEvent): UpdateState` — the desktop's `reduceUpdate`, transition for transition
  - `CssColor.parse(css: String): Int?` (ARGB), `CssColor.isLight(argb: Int): Boolean`

- [ ] **Step 1: Write the failing tests**

`UpdateFeedTest.kt`:

```kotlin
package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateFeedTest {
    private val sha = "a".repeat(64)
    private val url = "${UpdateFeed.DOWNLOAD_PREFIX}android-v0.21.1/skycord-0.21.1.apk"

    @Test fun readsAGoodFeed() {
        assertEquals(Feed("0.21.1", url, sha), UpdateFeed.parse("""{"version":"0.21.1","url":"$url","sha256":"${sha.uppercase()}","notes":"x"}"""))
    }

    @Test fun refusesAnythingItCannotTrust() {
        for (bad in listOf(
            """{"version":"0.21","url":"$url","sha256":"$sha"}""",
            """{"version":"0.21.1","url":"https://evil.example.com/skycord.apk","sha256":"$sha"}""",
            """{"version":"0.21.1","url":"http://github.com/xSMDx/skycord-android-releases/releases/download/x.apk","sha256":"$sha"}""",
            """{"version":"0.21.1","url":"$url","sha256":"abc"}""",
            "not json",
        )) assertNull(bad, UpdateFeed.parse(bad))
    }

    @Test fun comparesVersions() {
        assertTrue(UpdateFeed.isNewer("0.21.1", "0.21.0"))
        assertTrue(UpdateFeed.isNewer("0.22.0", "0.21.9"))
        assertTrue(UpdateFeed.isNewer("1.0.0", "0.99.99"))
        assertTrue(UpdateFeed.isNewer("0.21.1", "0.21.0-debug"))
        assertFalse(UpdateFeed.isNewer("0.21.0", "0.21.0"))
        assertFalse(UpdateFeed.isNewer("0.20.9", "0.21.0"))
        assertFalse(UpdateFeed.isNewer("garbage", "0.21.0"))
    }
}
```

`UpdateStateTest.kt`:

```kotlin
package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateStateTest {
    @Test fun followsTheDesktopMachine() {
        var s = UpdateState.INITIAL
        s = reduce(s, UpdateEvent.Check)
        assertEquals(UpdatePhase.CHECKING, s.phase)
        s = reduce(s, UpdateEvent.Available("0.21.1"))
        assertEquals(UpdatePhase.AVAILABLE to "0.21.1", s.phase to s.version)
        s = reduce(s, UpdateEvent.Progress(150.0, 1000.0))
        assertEquals(UpdatePhase.DOWNLOADING to 100.0, s.phase to s.percent)
        s = reduce(s, UpdateEvent.Downloaded("0.21.1"))
        assertEquals(UpdatePhase.READY, s.phase)
    }

    @Test fun anErrorAfterTheDownload_keepsItInstallable() {
        val ready = reduce(UpdateState.INITIAL, UpdateEvent.Downloaded("0.21.1"))
        val after = reduce(ready, UpdateEvent.Error("offline", 5))
        assertEquals(UpdatePhase.READY, after.phase)
        assertEquals("offline", after.error)
        assertEquals(UpdatePhase.ERROR, reduce(UpdateState.INITIAL, UpdateEvent.Error("offline", 5)).phase)
    }

    @Test fun nothingNew_isIdleWithTheTime() {
        val s = reduce(reduce(UpdateState.INITIAL, UpdateEvent.Check), UpdateEvent.None(42))
        assertEquals(UpdatePhase.IDLE to 42L, s.phase to s.lastCheckedAt)
    }

    @Test fun speaksTheWebsShape() {
        val j = UpdateState.INITIAL.toJson()
        assertEquals("idle", j.getString("phase"))
        for (k in listOf("version", "percent", "bytesPerSecond", "lastCheckedAt", "error")) assertTrue(k, j.has(k))
    }
}
```

`CssColorTest.kt`:

```kotlin
package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CssColorTest {
    @Test fun parsesWhatGetComputedStyleGives() {
        assertEquals(0xFF111214.toInt(), CssColor.parse("#111214"))
        assertEquals(0xFF112233.toInt(), CssColor.parse("#123"))
        assertEquals(0xFF111214.toInt(), CssColor.parse("rgb(17, 18, 20)"))
        assertEquals(0xFF111214.toInt(), CssColor.parse("rgba(17, 18, 20, 1)"))
        assertNull(CssColor.parse("blue"))
        assertNull(CssColor.parse("rgb(1,2)"))
    }

    @Test fun lightOrDark() {
        assertFalse(CssColor.isLight(0xFF111214.toInt()))
        assertTrue(CssColor.isLight(0xFFF2F3F5.toInt()))
    }
}
```

- [ ] **Step 2: Run them and see them fail**

Run: `source android/env.sh && cd android && ./gradlew test`
Expected: compilation fails on `UpdateFeed`, `Feed`, `UpdateState`, `reduce`, `CssColor`.

- [ ] **Step 3: Implement**

`UpdateFeed.kt`:

```kotlin
package xyz.skycord.android.core

import org.json.JSONObject

data class Feed(val version: String, val url: String, val sha256: String)

/**
 * latest.json, published with every release. Nothing in it is trusted until
 * it passes here: a plain X.Y.Z version, a download from our own releases
 * repo over https, and a SHA-256 the downloaded file must match.
 */
object UpdateFeed {
    const val FEED_URL = "https://github.com/xSMDx/skycord-android-releases/releases/latest/download/latest.json"
    const val DOWNLOAD_PREFIX = "https://github.com/xSMDx/skycord-android-releases/releases/download/"
    private val VERSION = Regex("^\\d+\\.\\d+\\.\\d+$")
    private val SHA = Regex("^[0-9a-f]{64}$")

    fun parse(text: String): Feed? = try {
        val o = JSONObject(text)
        val version = o.getString("version")
        val url = o.getString("url")
        val sha = o.getString("sha256").lowercase()
        if (VERSION.matches(version) && url.startsWith(DOWNLOAD_PREFIX) && SHA.matches(sha)) Feed(version, url, sha) else null
    } catch (e: Exception) {
        null
    }

    fun isNewer(candidate: String, current: String): Boolean {
        val a = parts(candidate) ?: return false
        val b = parts(current.substringBefore('-')) ?: return true
        for (i in 0..2) if (a[i] != b[i]) return a[i] > b[i]
        return false
    }

    private fun parts(v: String): List<Int>? =
        v.split('.').takeIf { it.size == 3 }?.map { it.toIntOrNull() ?: return null }
}
```

`UpdateState.kt`:

```kotlin
package xyz.skycord.android.core

import org.json.JSONObject

enum class UpdatePhase(val wire: String) {
    IDLE("idle"), CHECKING("checking"), AVAILABLE("available"), DOWNLOADING("downloading"), READY("ready"), ERROR("error")
}

/** The desktop's UpdateState (desktop/src/updateState.ts), so the web's Updates page needs nothing new. */
data class UpdateState(
    val phase: UpdatePhase,
    val version: String,
    val percent: Double,
    val bytesPerSecond: Double,
    val lastCheckedAt: Long,
    val error: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("phase", phase.wire).put("version", version).put("percent", percent)
        .put("bytesPerSecond", bytesPerSecond).put("lastCheckedAt", lastCheckedAt).put("error", error)

    companion object {
        val INITIAL = UpdateState(UpdatePhase.IDLE, "", 0.0, 0.0, 0, "")
    }
}

sealed interface UpdateEvent {
    data object Check : UpdateEvent
    data class Available(val version: String) : UpdateEvent
    data class Progress(val percent: Double, val bytesPerSecond: Double) : UpdateEvent
    data class Downloaded(val version: String) : UpdateEvent
    data class None(val at: Long) : UpdateEvent
    data class Error(val message: String, val at: Long) : UpdateEvent
}

private fun clamp(n: Double) = if (n.isFinite()) n.coerceIn(0.0, 100.0) else 0.0

fun reduce(s: UpdateState, e: UpdateEvent): UpdateState = when (e) {
    UpdateEvent.Check -> s.copy(phase = UpdatePhase.CHECKING)
    is UpdateEvent.Available -> s.copy(phase = UpdatePhase.AVAILABLE, version = e.version, percent = 0.0, bytesPerSecond = 0.0, error = "")
    is UpdateEvent.Progress -> s.copy(phase = UpdatePhase.DOWNLOADING, percent = clamp(e.percent), bytesPerSecond = e.bytesPerSecond, error = "")
    is UpdateEvent.Downloaded -> s.copy(phase = UpdatePhase.READY, version = e.version, percent = 100.0, bytesPerSecond = 0.0, error = "")
    is UpdateEvent.None -> s.copy(phase = UpdatePhase.IDLE, version = "", percent = 0.0, bytesPerSecond = 0.0, lastCheckedAt = e.at, error = "")
    // A downloaded update stays installable when a later check fails.
    is UpdateEvent.Error ->
        if (s.phase == UpdatePhase.READY) s.copy(lastCheckedAt = e.at, error = e.message)
        else s.copy(phase = UpdatePhase.ERROR, lastCheckedAt = e.at, error = e.message)
}
```

`CssColor.kt`:

```kotlin
package xyz.skycord.android.core

/**
 * A CSS colour as getComputedStyle reports it (#rgb, #rrggbb, rgb(), rgba()),
 * as ARGB — without android.graphics.Color, which is a stub in JVM tests.
 */
object CssColor {
    private val RGB = Regex("^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*(?:,\\s*[\\d.]+\\s*)?\\)$")

    fun parse(css: String): Int? {
        val t = css.trim().lowercase()
        if (t.startsWith("#")) {
            val hex = t.drop(1)
            val full = when (hex.length) {
                3 -> hex.map { "$it$it" }.joinToString("")
                6 -> hex
                else -> return null
            }
            return full.toLongOrNull(16)?.let { (0xFF000000 or it).toInt() }
        }
        val m = RGB.matchEntire(t) ?: return null
        val (r, g, b) = m.destructured.toList().map { it.toInt().coerceIn(0, 255) }
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    /** Light enough that the status bar needs dark icons. */
    fun isLight(argb: Int): Boolean {
        fun ch(shift: Int): Double {
            val c = ((argb shr shift) and 0xFF) / 255.0
            return if (c <= 0.03928) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4)
        }
        // 0.179: where dark text and light text have equal contrast on it.
        return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0) > 0.179
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `source android/env.sh && cd android && ./gradlew test`
Expected: `BUILD SUCCESSFUL`; the three new test classes pass.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/xyz/skycord/android/core/UpdateFeed.kt android/app/src/main/java/xyz/skycord/android/core/UpdateState.kt android/app/src/main/java/xyz/skycord/android/core/CssColor.kt android/app/src/test/java/xyz/skycord/android/core/UpdateFeedTest.kt android/app/src/test/java/xyz/skycord/android/core/UpdateStateTest.kt android/app/src/test/java/xyz/skycord/android/core/CssColorTest.kt
git commit -m "Android: a feed it can trust, the desktop's update states, and CSS colours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The launcher page

**Files:**
- Create: `android/launcher/index.html`, `android/launcher/main.ts`, `android/launcher/view.ts`, `android/launcher/launcher.css`, `android/launcher/vite.config.ts`
- Test: `android/launcher/__tests__/view.test.ts`
- Modify: `vitest.config.mts` (include the launcher tests), `package.json` (add `build:launcher`)

**Interfaces:**
- Consumes: `lookupInstance(input, fetchImpl)` and `type InstanceProfile` from `desktop/src/instanceAddress.ts`; `hostOf` from `desktop/src/servers.ts`; the native launcher API (Task 9):
  ```ts
  interface LauncherApi {
    list(): Promise<{ servers: { origin: string; name: string; icon: string | null }[]; current: string | null; hosted: string }>
    lookup(origin: string): Promise<{ status: number; body: string } | { unreachable: true }>
    save(entry: { origin: string; name: string; icon: string | null }): Promise<{ origin: string; name: string; icon: string | null }[]>
    remove(origin: string): Promise<{ origin: string; name: string; icon: string | null }[]>
    open(origin: string): Promise<null>
  }
  ```
- Produces: `npm run build:launcher` writes `android/app/src/main/assets/launcher/index.html` and its assets. From `view.ts`: `HOSTED`, `httpWarning(origin)`, `displayName(profile, origin)`, `iconUrl(profile, origin)`, `originOfInstanceUrl(url)`.

- [ ] **Step 1: Write the failing test** — `android/launcher/__tests__/view.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { HOSTED, httpWarning, displayName, iconUrl, originOfInstanceUrl } from '../view'

const profile = { software: 'skycord' as const, name: 'Crew', nameIsAddress: false, icon: '/icon.png', operator: 'Sam', version: '0.20.9' }

describe('the launcher', () => {
  it('offers the hosted instance', () => {
    expect(HOSTED).toBe('https://app.skycord.xyz')
  })

  it('warns that voice needs https, and only for http', () => {
    expect(httpWarning('http://10.0.0.5:3001')).toMatch(/calls won.t work/i)
    expect(httpWarning('https://chat.example.com')).toBeNull()
    // localhost is a secure page to Android, so calls work there.
    expect(httpWarning('http://localhost:5500')).toBeNull()
    expect(httpWarning('http://127.0.0.1:5500')).toBeNull()
  })

  it("names a server by its own name, or its address when it has none", () => {
    expect(displayName(profile, 'https://chat.example.com')).toBe('Crew')
    expect(displayName({ ...profile, nameIsAddress: true }, 'https://chat.example.com')).toBe('chat.example.com')
  })

  it('resolves the icon against the server, and refuses anything but http(s)', () => {
    expect(iconUrl(profile, 'https://chat.example.com')).toBe('https://chat.example.com/icon.png')
    expect(iconUrl({ ...profile, icon: null }, 'https://chat.example.com')).toBeNull()
    expect(iconUrl({ ...profile, icon: 'javascript:alert(1)' }, 'https://chat.example.com')).toBeNull()
  })

  it('takes back the origin from the URL lookupInstance asks for', () => {
    expect(originOfInstanceUrl('https://chat.example.com/instance')).toBe('https://chat.example.com')
    expect(originOfInstanceUrl('http://10.0.0.5:3001/instance')).toBe('http://10.0.0.5:3001')
    expect(originOfInstanceUrl('https://chat.example.com/elsewhere')).toBeNull()
  })
})
```

- [ ] **Step 2: Let Vitest find it, then see it fail**

In `vitest.config.mts`, change the `include` line to:

```ts
    include: ['server/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.ts', 'desktop/src/**/__tests__/**/*.test.ts', 'music/__tests__/**/*.test.ts', 'android/launcher/__tests__/**/*.test.ts'],
```

Run: `npx vitest run android/launcher`
Expected: FAIL — `Cannot find module '../view'`.

- [ ] **Step 3: Implement `view.ts`**

```ts
/**
 * The launcher's decisions, apart from the page so they are tested alone.
 */
import type { InstanceProfile } from '../../desktop/src/instanceAddress'
import { hostOf } from '../../desktop/src/servers'

export const HOSTED = 'https://app.skycord.xyz'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Android only lets secure pages use the microphone. An http:// server is
 * fine for chat, so it is allowed — but said up front rather than letting a
 * call fail later. Loopback counts as secure.
 */
export const httpWarning = (origin: string): string | null => {
  const u = new URL(origin)
  if (u.protocol !== 'http:' || LOOPBACK.has(u.hostname)) return null
  return 'This address isn\u2019t secure (http). Chat works, but calls won\u2019t: Android only gives the microphone to secure (https) addresses.'
}

export const displayName = (p: InstanceProfile, origin: string): string => (p.nameIsAddress ? hostOf(origin) : p.name)

export const iconUrl = (p: InstanceProfile, origin: string): string | null => {
  if (!p.icon) return null
  try {
    const u = new URL(p.icon, origin)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

/** lookupInstance fetches `${origin}/instance`; the native side only ever gets the origin. */
export const originOfInstanceUrl = (url: string): string | null => {
  try {
    const u = new URL(url)
    return u.pathname === '/instance' ? u.origin : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run android/launcher`
Expected: 5 tests pass.

- [ ] **Step 5: Write the page** — `android/launcher/index.html`

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src https: http: data:; style-src 'self'; script-src 'self'" />
  <title>Skycord</title>
  <link rel="stylesheet" href="./launcher.css" />
</head>
<body>
  <main class="lc">
    <header class="lc-head">
      <h1>Skycord</h1>
      <p class="lc-lead">Choose a server to open.</p>
    </header>

    <section class="lc-list" aria-label="Servers">
      <ul id="servers" class="lc-rows"></ul>
    </section>

    <form id="join" class="lc-join" novalidate>
      <label for="address" class="lc-label">Join a server by address</label>
      <div class="lc-field">
        <input id="address" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
               placeholder="chat.example.com" />
        <button id="check" type="submit" class="lc-btn">Check</button>
      </div>
      <p id="problem" class="lc-problem" role="alert" hidden></p>
    </form>

    <section id="found" class="lc-found" hidden aria-live="polite">
      <div class="lc-card">
        <span id="found-icon" class="lc-icon" aria-hidden="true"></span>
        <div class="lc-card-text">
          <strong id="found-name"></strong>
          <span id="found-host" class="lc-sub"></span>
          <span id="found-operator" class="lc-sub"></span>
        </div>
      </div>
      <p id="found-warning" class="lc-warning" hidden></p>
      <div class="lc-actions">
        <button id="found-back" type="button" class="lc-btn lc-btn-quiet">Back</button>
        <button id="found-open" type="button" class="lc-btn lc-btn-primary">Open</button>
      </div>
    </section>
  </main>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

- [ ] **Step 6: The behaviour** — `android/launcher/main.ts`

```ts
import { lookupInstance, type InstanceProfile } from '../../desktop/src/instanceAddress'
import { hostOf } from '../../desktop/src/servers'
import { HOSTED, httpWarning, displayName, iconUrl, originOfInstanceUrl } from './view'

interface Saved { origin: string; name: string; icon: string | null }
interface LauncherApi {
  list(): Promise<{ servers: Saved[]; current: string | null; hosted: string }>
  lookup(origin: string): Promise<{ status: number; body: string } | { unreachable: true }>
  save(entry: Saved): Promise<Saved[]>
  remove(origin: string): Promise<Saved[]>
  open(origin: string): Promise<null>
}

const api = (window as unknown as { skycordLauncher: LauncherApi }).skycordLauncher
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

let found: { origin: string; profile: InstanceProfile } | null = null

// Statuses a Response may not carry a body with; the constructor throws otherwise.
const NO_BODY = new Set([204, 205, 304])

/** lookupInstance's fetch, done by the app: an https page may not fetch an http:// server. */
const nativeFetch = async (url: string): Promise<Response> => {
  const origin = originOfInstanceUrl(url)
  if (!origin) throw new Error('not an instance URL')
  const r = await api.lookup(origin)
  if ('unreachable' in r) throw new Error('unreachable')
  return new Response(NO_BODY.has(r.status) ? null : r.body, { status: r.status, headers: { 'content-type': 'application/json' } })
}

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase()

const iconInto = (el: HTMLElement, src: string | null, name: string) => {
  el.textContent = ''
  if (src) {
    const img = document.createElement('img')
    img.alt = ''
    img.src = src
    img.onerror = () => { el.textContent = initial(name) }
    el.appendChild(img)
  } else {
    el.textContent = initial(name)
  }
}

const row = (s: Saved, note: string | null, onOpen: () => Promise<unknown>) => {
  const li = document.createElement('li')
  li.className = 'lc-row'
  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'lc-open'
  const icon = document.createElement('span')
  icon.className = 'lc-icon'
  icon.setAttribute('aria-hidden', 'true')
  iconInto(icon, s.icon, s.name)
  const text = document.createElement('span')
  text.className = 'lc-row-text'
  const name = document.createElement('strong')
  name.textContent = s.name
  const host = document.createElement('span')
  host.className = 'lc-sub'
  host.textContent = note ?? hostOf(s.origin)
  text.append(name, host)
  open.append(icon, text)
  open.addEventListener('click', () => void onOpen())
  li.appendChild(open)
  return li
}

const render = async () => {
  const { servers } = await api.list()
  const list = $<HTMLUListElement>('servers')
  list.textContent = ''
  // The hosted server is offered until it is saved; one tap saves and opens it.
  if (!servers.some(s => s.origin === HOSTED)) {
    const hosted: Saved = { origin: HOSTED, name: 'Skycord', icon: null }
    list.appendChild(row(hosted, 'app.skycord.xyz \u00b7 the hosted server', async () => {
      await api.save(hosted)
      await api.open(HOSTED)
    }))
  }
  for (const s of servers) {
    const li = row(s, null, () => api.open(s.origin))
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'lc-remove'
    remove.textContent = 'Remove'
    remove.setAttribute('aria-label', `Remove ${s.name}`)
    remove.addEventListener('click', async () => { await api.remove(s.origin); await render() })
    li.appendChild(remove)
    list.appendChild(li)
  }
}

const showProblem = (text: string | null) => {
  const p = $<HTMLParagraphElement>('problem')
  p.hidden = !text
  p.textContent = text ?? ''
}

const showFound = (origin: string, profile: InstanceProfile) => {
  found = { origin, profile }
  const name = displayName(profile, origin)
  iconInto($('found-icon'), iconUrl(profile, origin), name)
  $('found-name').textContent = name
  $('found-host').textContent = hostOf(origin)
  $('found-operator').textContent = profile.operator ? `Run by ${profile.operator}` : ''
  const warning = httpWarning(origin)
  const w = $<HTMLParagraphElement>('found-warning')
  w.hidden = !warning
  w.textContent = warning ?? ''
  $('join').hidden = true
  $('found').hidden = false
  $<HTMLButtonElement>('found-open').focus()
}

const hideFound = () => {
  found = null
  $('found').hidden = true
  $('join').hidden = false
}

$('join').addEventListener('submit', async (e) => {
  e.preventDefault()
  const button = $<HTMLButtonElement>('check')
  button.disabled = true
  showProblem(null)
  try {
    const r = await lookupInstance($<HTMLInputElement>('address').value, nativeFetch)
    if (r.ok) showFound(r.origin, r.profile)
    else showProblem(r.reason)
  } finally {
    button.disabled = false
  }
})

$('found-back').addEventListener('click', hideFound)
$('found-open').addEventListener('click', async () => {
  if (!found) return
  const { origin, profile } = found
  await api.save({ origin, name: displayName(profile, origin), icon: iconUrl(profile, origin) })
  await api.open(origin)
})

void render()
```

- [ ] **Step 7: The look** — `android/launcher/launcher.css`

```css
/* The app's own tokens (dark by default, light when the phone is light), so
   the launcher is the same product as what it opens. */
:root {
  --bg: #111214; --panel: #2b2d31; --input: #1e1f22; --text-1: #dcddde; --text-2: #b5bac1; --text-3: #949ba4;
  --accent: #38b6f1; --on-accent: #0e0f11; --danger: #f23f43; --warn: #f0b232; --divider: rgba(255,255,255,.06);
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f2f3f5; --panel: #ffffff; --input: #e3e5e8; --text-1: #313338; --text-2: #4e5058; --text-3: #5c5e66;
    --divider: rgba(0,0,0,.08); color-scheme: light;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text-1); font: 15px/1.45 system-ui, sans-serif; }
button { font: inherit; border: none; }
.lc { max-width: 520px; margin: 0 auto; padding: 32px 16px 24px; display: grid; gap: 24px; }
.lc-head h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -.01em; }
.lc-lead { margin: 4px 0 0; color: var(--text-3); }
.lc-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.lc-row { display: flex; align-items: center; gap: 8px; background: var(--panel); border-radius: 12px; padding: 4px 8px 4px 4px; }
.lc-open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 10px; min-height: 56px;
  background: none; color: inherit; text-align: left; border-radius: 10px; }
.lc-open:active { background: var(--divider); }
.lc-icon { flex: none; width: 40px; height: 40px; border-radius: 12px; background: var(--input); display: grid; place-items: center;
  font-weight: 700; color: var(--text-2); overflow: hidden; }
.lc-icon img { width: 100%; height: 100%; object-fit: cover; }
.lc-row-text, .lc-card-text { display: grid; min-width: 0; }
.lc-row-text strong, .lc-card-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-sub { color: var(--text-3); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-remove { background: none; color: var(--text-3); padding: 10px 12px; min-height: 44px; border-radius: 8px; }
.lc-remove:active { color: var(--danger); background: var(--divider); }
.lc-label { display: block; margin-bottom: 8px; font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--text-3); }
.lc-field { display: flex; gap: 8px; }
.lc-field input { flex: 1; min-width: 0; height: 48px; padding: 0 14px; border-radius: 10px; border: 1px solid transparent;
  background: var(--input); color: var(--text-1); font: inherit; font-size: 16px; }
.lc-field input:focus { outline: none; border-color: var(--accent); }
.lc-btn { height: 48px; padding: 0 18px; border-radius: 10px; background: var(--panel); color: var(--text-1); font-weight: 600; }
.lc-btn:disabled { opacity: .5; }
.lc-btn-primary { background: var(--accent); color: var(--on-accent); }
.lc-btn-quiet { background: none; color: var(--text-2); }
.lc-problem { margin: 10px 0 0; color: var(--danger); }
.lc-found { display: grid; gap: 14px; }
.lc-card { display: flex; gap: 14px; align-items: center; background: var(--panel); border-radius: 12px; padding: 16px; }
.lc-card .lc-icon { width: 56px; height: 56px; border-radius: 16px; font-size: 20px; }
.lc-warning { margin: 0; padding: 12px 14px; border-radius: 10px; background: rgba(240,178,50,.12); color: var(--text-1); }
.lc-actions { display: flex; justify-content: flex-end; gap: 8px; }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

- [ ] **Step 8: Build config** — `android/launcher/vite.config.ts`

```ts
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Built into the APK's assets and served from
// https://appassets.androidplatform.net/assets/launcher/ — relative paths,
// and a target the oldest WebView the app accepts (Chromium 86) understands.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../app/src/main/assets/launcher', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome86',
    assetsDir: '.',
  },
})
```

In `package.json` `scripts`, add after `"build"`:

```json
    "build:launcher": "vite build --config android/launcher/vite.config.ts",
```

- [ ] **Step 9: Build it**

Run: `npm run build:launcher && ls android/app/src/main/assets/launcher`
Expected: `index.html` and one `.js` and one `.css` file.

- [ ] **Step 10: Commit**

```bash
git add android/launcher/index.html android/launcher/main.ts android/launcher/view.ts android/launcher/launcher.css android/launcher/vite.config.ts android/launcher/__tests__/view.test.ts vitest.config.mts package.json
git commit -m "Android: the launcher page, built on the desktop's address check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The update manager

**Files:**
- Create: `android/app/src/main/java/xyz/skycord/android/UpdateManager.kt`
- Create: `android/app/src/main/res/xml/update_paths.xml`

**Interfaces:**
- Consumes: `UpdateFeed`, `Feed`, `UpdateState`, `UpdateEvent`, `reduce`, `BuildConfig.VERSION_NAME`, `BuildConfig.DEBUG`.
- Produces: `class UpdateManager(activity: Activity, onChange: (UpdateState) -> Unit)` with `val state: UpdateState`, `checkOnLaunch()`, `check()`, `install()`. FileProvider authority `"${applicationId}.updates"` (declared in Task 8's manifest).

- [ ] **Step 1: FileProvider paths** — `android/app/src/main/res/xml/update_paths.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<paths>
    <cache-path name="updates" path="updates/" />
</paths>
```

- [ ] **Step 2: Implement** — `android/app/src/main/java/xyz/skycord/android/UpdateManager.kt`

```kotlin
package xyz.skycord.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import xyz.skycord.android.core.Feed
import xyz.skycord.android.core.UpdateEvent
import xyz.skycord.android.core.UpdateFeed
import xyz.skycord.android.core.UpdatePhase
import xyz.skycord.android.core.UpdateState
import xyz.skycord.android.core.reduce
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Checks latest.json, downloads a newer APK, checks it against the feed's
 * SHA-256, and hands it to Android's installer when the person taps Install.
 * Every change goes through the shared reducer, so the web's Updates page sees
 * exactly what it sees on the desktop.
 */
class UpdateManager(private val activity: Activity, private val onChange: (UpdateState) -> Unit) {
    var state: UpdateState = UpdateState.INITIAL
        private set

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var apk: File? = null

    private fun emit(e: UpdateEvent) = main.post { state = reduce(state, e); onChange(state) }

    /** Debug builds never offer a release over themselves. */
    fun checkOnLaunch() { if (!BuildConfig.DEBUG) check() }

    fun check() {
        if (state.phase == UpdatePhase.CHECKING || state.phase == UpdatePhase.DOWNLOADING) return
        emit(UpdateEvent.Check)
        io.execute {
            val feed = fetchText(UpdateFeed.FEED_URL)?.let(UpdateFeed::parse)
            when {
                feed == null -> emit(UpdateEvent.Error("couldn\u2019t read the update feed", System.currentTimeMillis()))
                !UpdateFeed.isNewer(feed.version, BuildConfig.VERSION_NAME) -> emit(UpdateEvent.None(System.currentTimeMillis()))
                else -> { emit(UpdateEvent.Available(feed.version)); download(feed) }
            }
        }
    }

    private fun download(feed: Feed) {
        val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, "skycord-${feed.version}.apk")
        try {
            val conn = URL(feed.url).openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            val total = conn.contentLengthLong.takeIf { it > 0 }
            val digest = MessageDigest.getInstance("SHA-256")
            val started = System.currentTimeMillis()
            var read = 0L
            var lastEmit = 0L
            conn.inputStream.use { input ->
                file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        digest.update(buf, 0, n)
                        read += n
                        val now = System.currentTimeMillis()
                        if (total != null && now - lastEmit > 250) {
                            lastEmit = now
                            val bps = read * 1000.0 / maxOf(1L, now - started)
                            emit(UpdateEvent.Progress(read * 100.0 / total, bps))
                        }
                    }
                }
            }
            conn.disconnect()
            val sha = digest.digest().joinToString("") { "%02x".format(it) }
            if (sha != feed.sha256) {
                file.delete()
                emit(UpdateEvent.Error("the download didn\u2019t match what was published", System.currentTimeMillis()))
                return
            }
            apk = file
            emit(UpdateEvent.Downloaded(feed.version))
        } catch (e: Exception) {
            file.delete()
            emit(UpdateEvent.Error("the download stopped", System.currentTimeMillis()))
        }
    }

    fun install() {
        val file = apk ?: return
        if (!activity.packageManager.canRequestPackageInstalls()) {
            // Android asks once per app. After allowing it, Install works.
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            return
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
        activity.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    private fun fetchText(url: String): String? = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 10000
        conn.readTimeout = 10000
        try {
            if (conn.responseCode == 200) conn.inputStream.use { String(it.readBytes(), Charsets.UTF_8) } else null
        } finally {
            conn.disconnect()
        }
    } catch (e: Exception) {
        null
    }
}
```

- [ ] **Step 3: Compile**

Run: `source android/env.sh && cd android && ./gradlew compileDebugKotlin`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/xyz/skycord/android/UpdateManager.kt android/app/src/main/res/xml/update_paths.xml
git commit -m "Android: check, download, verify, and hand an update to the installer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The main screen — WebView, launcher, server, screens, permissions, bars

**Files:**
- Create: `android/app/src/main/java/xyz/skycord/android/MainActivity.kt` (replaces the placeholder)
- Create: `android/app/src/main/java/xyz/skycord/android/SystemBars.kt`
- Create: `android/app/src/main/res/layout/activity_main.xml`, `android/app/src/main/res/layout/screen_old_webview.xml`
- Create: `android/app/src/main/res/drawable/ic_launcher_foreground.xml`, `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`, `android/app/src/main/res/values/colors.xml`
- Modify: `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/values/strings.xml`, `android/app/build.gradle.kts` (launcher build task)

**Interfaces:**
- Consumes: `Origins`, `NavigationPolicy`, `Nav`, `ServerStore`, `PrefsKeyValue`, `UpdateManager`, `CssColor`.
- Produces (used by Task 9's `BridgeHost` and Task 10's back button):
  - `MainActivity.LAUNCHER_ORIGIN = "https://appassets.androidplatform.net"`, `MainActivity.LAUNCHER_URL = "$LAUNCHER_ORIGIN/assets/launcher/index.html"`
  - `val currentServer: String?`, `fun openServer(origin: String)`, `fun showLauncher()`, `fun applyBarColour(css: String)`
  - `lateinit var store: ServerStore`, `lateinit var updates: UpdateManager`
  - `SystemBars.install(root: View)`, `SystemBars.paint(window: Window, root: View, argb: Int)`

- [ ] **Step 1: Manifest** — replace `android/app/src/main/AndroidManifest.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />

    <!-- usesCleartextTraffic: a server on a home network often has no certificate. -->
    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:theme="@style/Theme.Skycord"
        android:supportsRtl="true"
        android:usesCleartextTraffic="true"
        android:allowBackup="false">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:configChanges="orientation|screenSize|screenLayout|keyboardHidden|smallestScreenSize|uiMode"
            android:windowSoftInputMode="adjustNothing">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.updates"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/update_paths" />
        </provider>
    </application>
</manifest>
```

`configChanges` keeps the WebView (and a call in it) alive through rotation and theme changes; `adjustNothing` because the IME inset is applied as padding (SystemBars).

- [ ] **Step 2: Strings, colours, icon, layouts**

`android/app/src/main/res/values/strings.xml`:

```xml
<resources>
    <string name="app_name">Skycord</string>
    <string name="unreachable_title">Can\u2019t reach %1$s</string>
    <string name="unreachable_body">Check your connection, or that the server is running.</string>
    <string name="retry">Retry</string>
    <string name="choose_another">Choose another server</string>
    <string name="old_webview_title">Android System WebView needs an update</string>
    <string name="old_webview_body">Skycord runs inside Android System WebView, and the version on this phone is too old. Update it, then open Skycord again.</string>
    <string name="old_webview_action">Update Android System WebView</string>
</resources>
```

`android/app/src/main/res/values/colors.xml`:

```xml
<resources>
    <color name="floor">#111214</color>
    <color name="panel">#2B2D31</color>
    <color name="text1">#DCDDDE</color>
    <color name="text3">#949BA4</color>
    <color name="accent">#38B6F1</color>
    <color name="on_accent">#0E0F11</color>
</resources>
```

`android/app/src/main/res/drawable/ic_launcher_foreground.xml` (placeholder mark: a speech bubble; the real icon comes with the redesign slice):

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#38B6F1"
        android:pathData="M34,36h40a8,8 0 0 1 8,8v18a8,8 0 0 1 -8,8H52l-10,9v-9h-8a8,8 0 0 1 -8,-8V44a8,8 0 0 1 8,-8z" />
</vector>
```

`android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/floor" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
```

`android/app/src/main/res/layout/activity_main.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/floor">

    <WebView
        android:id="@+id/web"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

    <LinearLayout
        android:id="@+id/unreachable"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:background="@color/floor"
        android:gravity="center"
        android:orientation="vertical"
        android:padding="24dp"
        android:visibility="gone">

        <TextView
            android:id="@+id/unreachable_title"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:gravity="center"
            android:textColor="@color/text1"
            android:textSize="20sp"
            android:textStyle="bold" />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="8dp"
            android:gravity="center"
            android:text="@string/unreachable_body"
            android:textColor="@color/text3"
            android:textSize="15sp" />

        <Button
            android:id="@+id/unreachable_retry"
            android:layout_width="wrap_content"
            android:layout_height="48dp"
            android:layout_marginTop="24dp"
            android:backgroundTint="@color/accent"
            android:text="@string/retry"
            android:textAllCaps="false"
            android:textColor="@color/on_accent" />

        <Button
            android:id="@+id/unreachable_choose"
            style="?android:attr/borderlessButtonStyle"
            android:layout_width="wrap_content"
            android:layout_height="48dp"
            android:layout_marginTop="8dp"
            android:text="@string/choose_another"
            android:textAllCaps="false"
            android:textColor="@color/text1" />
    </LinearLayout>
</FrameLayout>
```

`android/app/src/main/res/layout/screen_old_webview.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/floor"
    android:gravity="center"
    android:orientation="vertical"
    android:padding="24dp">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:gravity="center"
        android:text="@string/old_webview_title"
        android:textColor="@color/text1"
        android:textSize="20sp"
        android:textStyle="bold" />

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:gravity="center"
        android:text="@string/old_webview_body"
        android:textColor="@color/text3"
        android:textSize="15sp" />

    <Button
        android:id="@+id/old_webview_update"
        android:layout_width="wrap_content"
        android:layout_height="48dp"
        android:layout_marginTop="24dp"
        android:backgroundTint="@color/accent"
        android:text="@string/old_webview_action"
        android:textAllCaps="false"
        android:textColor="@color/on_accent" />
</LinearLayout>
```

- [ ] **Step 3: System bars** — `android/app/src/main/java/xyz/skycord/android/SystemBars.kt`

```kotlin
package xyz.skycord.android

import android.view.View
import android.view.Window
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import xyz.skycord.android.core.CssColor

/**
 * Android 15 draws every app edge to edge, and ignores a status bar colour.
 * So the content is padded clear of the bars (and of the keyboard), and the
 * root view behind them is painted the theme's colour; the icons go light or
 * dark by that colour's luminance.
 */
object SystemBars {
    fun install(window: Window, root: View) {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
    }

    fun paint(window: Window, root: View, argb: Int) {
        root.setBackgroundColor(argb)
        val light = CssColor.isLight(argb)
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }
}
```

- [ ] **Step 4: The activity** — replace `android/app/src/main/java/xyz/skycord/android/MainActivity.kt`

```kotlin
package xyz.skycord.android

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature
import xyz.skycord.android.core.CssColor
import xyz.skycord.android.core.Nav
import xyz.skycord.android.core.NavigationPolicy
import xyz.skycord.android.core.Origins
import xyz.skycord.android.core.ServerStore

class MainActivity : AppCompatActivity() {
    companion object {
        const val LAUNCHER_ORIGIN = "https://appassets.androidplatform.net"
        const val LAUNCHER_URL = "$LAUNCHER_ORIGIN/assets/launcher/index.html"
        private const val WEBVIEW_PACKAGE = "com.google.android.webview"
    }

    lateinit var web: WebView
        private set
    lateinit var store: ServerStore
        private set
    lateinit var updates: UpdateManager
        private set

    /** The server whose page is showing; null on the launcher. */
    var currentServer: String? = null
        private set

    private lateinit var root: View
    private lateinit var unreachable: View
    private lateinit var assetLoader: WebViewAssetLoader
    private var pendingPermission: Pair<PermissionRequest, List<String>>? = null

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val (request, resources) = pendingPermission ?: return@registerForActivityResult
        pendingPermission = null
        val granted = resources.filter { ContextCompat.checkSelfPermission(this, androidPermissionFor(it)) == PackageManager.PERMISSION_GRANTED }
        if (granted.isEmpty()) request.deny() else request.grant(granted.toTypedArray())
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!webViewIsNewEnough()) {
            showOldWebView()
            return
        }
        setContentView(R.layout.activity_main)
        root = findViewById(R.id.root)
        web = findViewById(R.id.web)
        unreachable = findViewById(R.id.unreachable)
        SystemBars.install(window, root)

        store = ServerStore(PrefsKeyValue(this))
        updates = UpdateManager(this) { onUpdateState() }
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        configureWebView()

        findViewById<Button>(R.id.unreachable_retry).setOnClickListener { currentServer?.let(::openServer) }
        findViewById<Button>(R.id.unreachable_choose).setOnClickListener { showLauncher() }

        onCreateBridge()

        val last = store.last()
        if (last != null) openServer(last) else showLauncher()
        updates.checkOnLaunch()
    }

    /** Hooks for Tasks 9 and 10; empty until then. */
    private fun onCreateBridge() {}
    private fun onUpdateState() {}

    private fun webViewIsNewEnough(): Boolean =
        WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    private fun showOldWebView() {
        setContentView(R.layout.screen_old_webview)
        findViewById<Button>(R.id.old_webview_update).setOnClickListener {
            openExternally(Uri.parse("market://details?id=$WEBVIEW_PACKAGE"))
                || openExternally(Uri.parse("https://play.google.com/store/apps/details?id=$WEBVIEW_PACKAGE"))
        }
    }

    private fun configureWebView() {
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString SkycordAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                return when (NavigationPolicy.decide(request.url.toString(), currentServer, LAUNCHER_ORIGIN)) {
                    Nav.STAY -> false
                    Nav.BROWSER -> { openExternally(request.url); true }
                    Nav.BLOCK -> true
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceErrorCompat) {
                val server = currentServer ?: return
                if (request.isForMainFrame && Origins.of(request.url.toString()) == server) showUnreachable(server)
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) = handlePermission(request)
        }
    }

    fun openServer(origin: String) {
        unreachable.visibility = View.GONE
        currentServer = origin
        store.setLast(origin)
        onServerChanged()
        web.loadUrl("$origin/")
    }

    fun showLauncher() {
        unreachable.visibility = View.GONE
        currentServer = null
        onServerChanged()
        web.loadUrl(LAUNCHER_URL)
    }

    /** Hook for Task 9 (the bridge re-registers when the saved list changes). */
    private fun onServerChanged() {}

    private fun showUnreachable(origin: String) {
        val name = store.find(origin)?.name ?: origin
        findViewById<TextView>(R.id.unreachable_title).text = getString(R.string.unreachable_title, name)
        unreachable.visibility = View.VISIBLE
    }

    fun applyBarColour(css: String) {
        CssColor.parse(css)?.let { SystemBars.paint(window, root, it) }
    }

    /** The phone's browser, or another app for mailto:/tel:. False when nothing can open it. */
    private fun openExternally(uri: Uri): Boolean = try {
        startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        true
    } catch (e: ActivityNotFoundException) {
        false
    }

    private fun androidPermissionFor(resource: String): String =
        if (resource == PermissionRequest.RESOURCE_AUDIO_CAPTURE) Manifest.permission.RECORD_AUDIO else Manifest.permission.CAMERA

    /** Microphone and camera: only for the current server's page, and only after Android's own prompt. */
    private fun handlePermission(request: PermissionRequest) {
        val origin = Origins.of(request.origin.toString())
        if (origin == null || origin != currentServer) { request.deny(); return }
        val wanted = request.resources.filter {
            it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
        }
        if (wanted.isEmpty()) { request.deny(); return }
        val missing = wanted.map(::androidPermissionFor).distinct()
            .filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) { request.grant(wanted.toTypedArray()); return }
        pendingPermission = request to wanted
        askPermissions.launch(missing.toTypedArray())
    }
}
```

- [ ] **Step 5: Build the launcher with the app** — append to `android/app/build.gradle.kts`

```kotlin
// The launcher is a Vite build (android/launcher) that lands in this app's
// assets. Run before every build so a stale page can never ship.
val buildLauncher by tasks.registering(Exec::class) {
    val repoRoot = rootProject.projectDir.parentFile
    workingDir = repoRoot
    val windows = System.getProperty("os.name").lowercase().contains("windows")
    commandLine(if (windows) listOf("cmd", "/c", "npm", "run", "build:launcher") else listOf("npm", "run", "build:launcher"))
    inputs.dir(File(repoRoot, "android/launcher"))
    inputs.file(File(repoRoot, "desktop/src/instanceAddress.ts"))
    inputs.file(File(repoRoot, "desktop/src/servers.ts"))
    outputs.dir(layout.projectDirectory.dir("src/main/assets/launcher"))
}
tasks.named("preBuild") { dependsOn(buildLauncher) }
```

- [ ] **Step 6: Build and run it on the emulator**

Run: `source android/env.sh && cd android && ./gradlew test assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk && adb shell pm clear xyz.skycord.android && adb shell am start -n xyz.skycord.android/.MainActivity`
Expected: unit tests pass; the emulator shows the launcher with the "Skycord · app.skycord.xyz · the hosted server" row and the address form. (The launcher's buttons do nothing yet — its bridge is Task 9.)

Run: `adb shell input keyevent 4` (back) — Expected: the app goes to the background (the default activity behaviour until Task 10).

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml android/app/src/main/java/xyz/skycord/android/MainActivity.kt android/app/src/main/java/xyz/skycord/android/SystemBars.kt android/app/src/main/res/layout/activity_main.xml android/app/src/main/res/layout/screen_old_webview.xml android/app/src/main/res/drawable/ic_launcher_foreground.xml android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml android/app/src/main/res/values/colors.xml android/app/src/main/res/values/strings.xml android/app/build.gradle.kts
git commit -m "Android: the main screen — launcher, servers, outside links, permissions, bars

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The bridge

**Files:**
- Create: `android/app/src/main/assets/bridge/app-shim.js`, `android/app/src/main/assets/bridge/launcher-shim.js`
- Create: `android/app/src/main/java/xyz/skycord/android/BridgeHost.kt`
- Modify: `android/app/src/main/java/xyz/skycord/android/MainActivity.kt` (wire the hooks)

**Interfaces:**
- Consumes: `BridgeProtocol`, `Incoming`, `Origins`, `ServerStore`, `InstanceFetch`, `UpdateManager`, `MainActivity` (`currentServer`, `openServer`, `showLauncher`, `applyBarColour`, `LAUNCHER_ORIGIN`).
- Produces:
  - In server pages: `window.skycordAndroid` = `{ platform: 'android', changeInstance(), openServers(), colors({ bar, text }), onBack(cb: () => boolean): () => void, updates: { state(), onChange(cb), check(), install() }, about() }`
  - In the launcher: `window.skycordLauncher` = the `LauncherApi` of Task 6
  - `class BridgeHost(activity: MainActivity)`: `refresh()`, `pushUpdates(state: UpdateState)`, `askBack(id: Int): Boolean` (false when the page has no bridge yet), `var onBackAnswer: (Int, Boolean) -> Unit`

- [ ] **Step 1: The server-page shim** — `android/app/src/main/assets/bridge/app-shim.js`

```js
// window.skycordAndroid — injected by the app into saved servers' pages only
// (addDocumentStartJavaScript with their origins). __skycordPort exists only
// there too (addWebMessageListener), so on any other page this does nothing.
(() => {
  const port = window.__skycordPort
  if (!port || window.skycordAndroid) return
  let seq = 0
  const pending = new Map()
  const backHandlers = new Set()
  const updateHandlers = new Set()
  const send = (msg) => port.postMessage(JSON.stringify(msg))
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    send({ type: 'call', id, method, args })
  })
  const fire = (method, ...args) => send({ type: 'call', method, args })
  port.onmessage = (event) => {
    let m
    try { m = JSON.parse(event.data) } catch { return }
    if (m.type === 'reply') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.value)
    } else if (m.type === 'event' && m.name === 'back') {
      // Offered to the page first; the first handler that uses it wins.
      let used = false
      for (const cb of backHandlers) {
        try { if (cb()) { used = true; break } } catch { /* a broken handler must not trap the button */ }
      }
      send({ type: 'back', id: m.value, used })
    } else if (m.type === 'event' && m.name === 'updates') {
      for (const cb of updateHandlers) { try { cb(m.value) } catch { /* next */ } }
    }
  }
  const on = (set) => (cb) => { set.add(cb); return () => { set.delete(cb) } }
  window.skycordAndroid = Object.freeze({
    platform: 'android',
    changeInstance: () => call('changeInstance'),
    openServers: () => call('openServers'),
    colors: (c) => fire('colors', c),
    onBack: on(backHandlers),
    updates: Object.freeze({
      state: () => call('updates.state'),
      onChange: on(updateHandlers),
      check: () => fire('updates.check'),
      install: () => fire('updates.install'),
    }),
    about: () => call('about'),
  })
  send({ type: 'hello' })
})()
```

- [ ] **Step 2: The launcher shim** — `android/app/src/main/assets/bridge/launcher-shim.js`

```js
// window.skycordLauncher — injected into the app's own launcher page only.
// Its call/reply plumbing mirrors app-shim.js on purpose: each shim is
// injected alone into a different origin's page at document start, before
// any script of the page runs, so there is no shared module to put it in.
(() => {
  const port = window.__skycordPort
  if (!port || window.skycordLauncher) return
  let seq = 0
  const pending = new Map()
  port.onmessage = (event) => {
    let m
    try { m = JSON.parse(event.data) } catch { return }
    if (m.type !== 'reply') return
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m.value)
  }
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    port.postMessage(JSON.stringify({ type: 'call', id, method, args }))
  })
  window.skycordLauncher = Object.freeze({
    list: () => call('launcher.list'),
    lookup: (origin) => call('launcher.lookup', origin),
    save: (entry) => call('launcher.save', entry),
    remove: (origin) => call('launcher.remove', origin),
    open: (origin) => call('launcher.open', origin),
  })
})()
```

- [ ] **Step 3: The host** — `android/app/src/main/java/xyz/skycord/android/BridgeHost.kt`

```kotlin
package xyz.skycord.android

import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONObject
import xyz.skycord.android.core.BridgeProtocol
import xyz.skycord.android.core.Incoming
import xyz.skycord.android.core.Origins
import xyz.skycord.android.core.SavedServer
import xyz.skycord.android.core.UpdateState
import xyz.skycord.android.core.stringOrNull
import java.util.concurrent.Executors

/**
 * The bridge between pages and the app. One message listener, registered for
 * the saved servers' origins and the launcher's; two document-start shims,
 * each only where it belongs. Every message is checked again here — main frame
 * only, and its origin must be the current server (app calls) or the
 * launcher (launcher calls) — so a page can never reach what it should not,
 * whatever the registration says.
 */
class BridgeHost(private val activity: MainActivity) {
    private companion object {
        const val PORT = "__skycordPort"
    }

    private val web: WebView get() = activity.web
    private val appShim = activity.assets.open("bridge/app-shim.js").use { String(it.readBytes()) }
    private val launcherShim = activity.assets.open("bridge/launcher-shim.js").use { String(it.readBytes()) }
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    private var listening = false
    private var appScript: ScriptHandler? = null
    private var launcherScript: ScriptHandler? = null

    /**
     * The current server page's way back to its bridge, from its hello. The
     * newest hello always wins — a reload sends a new one — and it is cleared
     * whenever the server changes. (Not on onPageStarted: that and the new
     * page's hello arrive in no fixed order, and clearing after the hello
     * would leave the back button unoffered.)
     */
    private var appProxy: JavaScriptReplyProxy? = null

    var onBackAnswer: (Int, Boolean) -> Unit = { _, _ -> }

    /** Register for the current saved servers. Takes effect from the next page load. */
    fun refresh() {
        appProxy = null
        val servers = activity.store.list().map { it.origin }.toSet()
        if (listening) WebViewCompat.removeWebMessageListener(web, PORT)
        WebViewCompat.addWebMessageListener(web, PORT, servers + MainActivity.LAUNCHER_ORIGIN, ::onMessage)
        listening = true
        appScript?.remove()
        launcherScript?.remove()
        appScript = if (servers.isEmpty()) null else WebViewCompat.addDocumentStartJavaScript(web, appShim, servers)
        launcherScript = WebViewCompat.addDocumentStartJavaScript(web, launcherShim, setOf(MainActivity.LAUNCHER_ORIGIN))
    }

    fun pushUpdates(state: UpdateState) {
        appProxy?.postMessage(BridgeProtocol.event("updates", state.toJson()))
    }

    /** Offer the back button to the page. False when the page has no bridge to ask. */
    fun askBack(id: Int): Boolean {
        if (activity.currentServer == null) return false
        val proxy = appProxy ?: return false
        proxy.postMessage(BridgeProtocol.event("back", id))
        return true
    }

    private fun onMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, proxy: JavaScriptReplyProxy) {
        if (!isMainFrame) return
        val origin = Origins.of(sourceOrigin.toString()) ?: return
        val incoming = message.data?.let(BridgeProtocol::parse) ?: return
        when {
            origin == MainActivity.LAUNCHER_ORIGIN && activity.currentServer == null -> onLauncher(incoming, proxy)
            origin == activity.currentServer -> onApp(incoming, proxy)
        }
    }

    private fun onApp(m: Incoming, proxy: JavaScriptReplyProxy) {
        when (m) {
            Incoming.Hello -> appProxy = proxy
            is Incoming.BackAnswer -> onBackAnswer(m.id, m.used)
            is Incoming.Call -> {
                val reply = { value: Any? -> m.id?.let { proxy.postMessage(BridgeProtocol.reply(it, value)) } }
                when (m.method) {
                    "changeInstance", "openServers" -> { reply(null); activity.showLauncher() }
                    "colors" -> m.args.optJSONObject(0)?.optString("bar")?.let(activity::applyBarColour)
                    "about" -> reply(about())
                    "updates.state" -> reply(activity.updates.state.toJson())
                    "updates.check" -> activity.updates.check()
                    "updates.install" -> activity.updates.install()
                    else -> m.id?.let { proxy.postMessage(BridgeProtocol.error(it, "unknown method")) }
                }
            }
        }
    }

    private fun onLauncher(m: Incoming, proxy: JavaScriptReplyProxy) {
        val call = m as? Incoming.Call ?: return
        val id = call.id ?: return
        val reply = { value: Any? -> proxy.postMessage(BridgeProtocol.reply(id, value)) }
        val servers = { list: List<SavedServer> -> JSONArray(list.map { it.toJson() }) }
        when (call.method) {
            "launcher.list" -> reply(
                JSONObject()
                    .put("servers", servers(activity.store.list()))
                    .put("current", activity.currentServer ?: JSONObject.NULL)
                    .put("hosted", "https://app.skycord.xyz"),
            )
            "launcher.lookup" -> {
                val origin = call.args.optString(0)
                // Only an origin that is already normal; never a URL the page chose.
                if (Origins.normalise(origin) != origin) { reply(JSONObject().put("unreachable", true)); return }
                io.execute {
                    val answer = InstanceFetch.get(origin)
                    main.post {
                        reply(
                            if (answer == null) JSONObject().put("unreachable", true)
                            else JSONObject().put("status", answer.status).put("body", answer.body),
                        )
                    }
                }
            }
            "launcher.save" -> {
                val e = call.args.optJSONObject(0) ?: return reply(servers(activity.store.list()))
                val list = activity.store.save(e.stringOrNull("origin") ?: "", e.stringOrNull("name"), e.stringOrNull("icon"))
                refresh()
                reply(servers(list))
            }
            "launcher.remove" -> {
                val list = activity.store.remove(call.args.optString(0))
                refresh()
                reply(servers(list))
            }
            "launcher.open" -> {
                val origin = call.args.optString(0)
                if (activity.store.find(origin) == null) { proxy.postMessage(BridgeProtocol.error(id, "not a saved server")); return }
                reply(null)
                activity.openServer(origin)
            }
            else -> proxy.postMessage(BridgeProtocol.error(id, "unknown method"))
        }
    }

    /** The desktop's AboutFacts shape, so the web's Debug page reads it unchanged. */
    private fun about(): JSONObject = JSONObject()
        .put("app", BuildConfig.VERSION_NAME)
        .put("electron", "")
        .put("chromium", WebViewCompat.getCurrentWebViewPackage(activity)?.versionName ?: "")
        .put("node", "")
        .put("platform", "android")
        .put("osVersion", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        .put("addonLoaded", false)
        .put("perAppAudio", false)
}
```

- [ ] **Step 4: Wire it into the activity** — in `MainActivity.kt`:

Add a field after `updates`:

```kotlin
    lateinit var bridge: BridgeHost
        private set
```

Replace the three hooks:

```kotlin
    private fun onCreateBridge() {
        bridge = BridgeHost(this)
        bridge.refresh()
    }

    private fun onUpdateState() {
        if (::bridge.isInitialized) bridge.pushUpdates(updates.state)
    }

    private fun onServerChanged() {
        if (::bridge.isInitialized) bridge.refresh()
    }
```

- [ ] **Step 5: Try it on the emulator**

Run: `source android/env.sh && cd android && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk && adb shell pm clear xyz.skycord.android && adb reverse tcp:5500 tcp:5500 && adb shell am start -n xyz.skycord.android/.MainActivity`

With the dev client running on 5500 (and its API on 3050): type `http://localhost:5500` → **Check**.
Expected: the dev server's name card appears with no http warning (localhost is secure); **Open** loads the sign-in page. After signing in, Settings › Servers › **Manage servers** returns to the launcher, which now lists the saved server.

Run: `chrome://inspect` on the PC (Chrome), inspect the WebView, and evaluate `typeof window.skycordAndroid` on the server page → `"object"`; on `https://example.org` reached by `location.href = 'https://example.org'` in the console → the WebView stays on the server and the link goes to the browser instead.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/assets/bridge/app-shim.js android/app/src/main/assets/bridge/launcher-shim.js android/app/src/main/java/xyz/skycord/android/BridgeHost.kt android/app/src/main/java/xyz/skycord/android/MainActivity.kt
git commit -m "Android: the bridge — only on saved servers, checked again on every message

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The back button (native half)

**Files:**
- Modify: `android/app/src/main/java/xyz/skycord/android/MainActivity.kt`

**Interfaces:**
- Consumes: `BackGate`, `BackAction`, `BridgeHost.askBack`, `BridgeHost.onBackAnswer`.
- Produces: pressing back offers it to the page (`skycordAndroid.onBack` handlers, wired in Task 11); unused or silent → `moveTaskToBack(true)`.

- [ ] **Step 1: Implement** — in `MainActivity.kt` add imports `androidx.activity.OnBackPressedCallback`, `android.os.Handler`, `android.os.Looper`, `xyz.skycord.android.core.BackAction`, `xyz.skycord.android.core.BackGate`, then the fields:

```kotlin
    private val backGate = BackGate()
    private val main = Handler(Looper.getMainLooper())
```

At the end of `onCreateBridge()`:

```kotlin
        bridge.onBackAnswer = { id, used -> backGate.answer(id, used)?.let(::act) }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = onBack()
        })
```

And the methods:

```kotlin
    /** Offered to the page first; 300 ms of silence counts as unused. */
    private fun onBack() {
        val id = backGate.ask()
        if (!bridge.askBack(id)) { backGate.timeout(id)?.let(::act); return }
        main.postDelayed({ backGate.timeout(id)?.let(::act) }, backGate.timeoutMs)
    }

    private fun act(action: BackAction) {
        if (action == BackAction.TO_BACKGROUND) moveTaskToBack(true)
    }
```

- [ ] **Step 2: Run the unit tests and build**

Run: `source android/env.sh && cd android && ./gradlew test assembleDebug`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Try it** — install, open the dev server, sign in; press back with `adb shell input keyevent 4`.
Expected: until Task 11 the page has no handler, so back sends the app to the background (`adb shell dumpsys window | grep mCurrentFocus` no longer shows `xyz.skycord.android`). Relaunching shows the same page, still signed in.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/xyz/skycord/android/MainActivity.kt
git commit -m "Android: the back button asks the page first, and never waits on it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10b: The file picker

Added 2026-10-05 at the owner's request: Android's WebView does nothing for `<input type="file">` unless the app opens a picker itself. Today the web client has two file inputs — a server or profile icon (`accept="image/*"`, `src/components/modals/ChangeIconModal.vue:45`) and a music upload (`accept="audio/*,.mp3,.flac,.ogg,.opus,.wav,.m4a,.aac"`, `src/components/music/MusicModal.vue:919`). There are no message attachments and nothing to download yet, so downloads are out of scope.

**Files:**
- Create: `android/app/src/main/java/xyz/skycord/android/core/PickerTypes.kt`
- Test: `android/app/src/test/java/xyz/skycord/android/core/PickerTypesTest.kt`
- Modify: `android/app/src/main/java/xyz/skycord/android/MainActivity.kt`

**Interfaces:**
- Consumes: `Origins.of`, `MainActivity.currentServer`.
- Produces: `PickerTypes.mimeTypes(accept: List<String>, mimeForExtension: (String) -> String?): List<String>`; the current server's page can open Android's file picker (single or multiple), and a cancelled pick tells the page nothing was chosen.

- [ ] **Step 1: Write the failing test** — `PickerTypesTest.kt`

```kotlin
package xyz.skycord.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

class PickerTypesTest {
    private val known = mapOf("mp3" to "audio/mpeg", "flac" to "audio/flac", "m4a" to "audio/mp4")
    private val guess = { ext: String -> known[ext] }

    @Test fun mimeTypesPassThrough_extensionsAreLookedUp_unknownOnesDropped() {
        assertEquals(
            listOf("audio/*", "audio/mpeg", "audio/flac", "audio/mp4"),
            PickerTypes.mimeTypes(listOf("audio/*,.mp3,.flac,.opus,.m4a"), guess),
        )
    }

    @Test fun webViewMaySplitTheAttributeOrNot_andCaseAndSpacesDoNotMatter() {
        assertEquals(listOf("image/*", "audio/mpeg"), PickerTypes.mimeTypes(listOf(" IMAGE/* ", ".MP3", "image/*"), guess))
    }

    @Test fun nothingUsable_meansAnything() {
        assertEquals(emptyList<String>(), PickerTypes.mimeTypes(listOf(""), guess))
        assertEquals(emptyList<String>(), PickerTypes.mimeTypes(emptyList(), guess))
        assertEquals(emptyList<String>(), PickerTypes.mimeTypes(listOf("junk", ".opus"), guess))
    }
}
```

- [ ] **Step 2: Run it and see it fail**

Run: `source android/env.sh && cd android && ./gradlew test`
Expected: compilation fails — `Unresolved reference: PickerTypes`.

- [ ] **Step 3: Implement** — `PickerTypes.kt`

```kotlin
package xyz.skycord.android.core

/**
 * An `<input accept>` as MIME types for Android's picker. WebView hands the
 * attribute over either whole ("audio/*,.mp3") or split; extensions such as
 * .flac are looked up, because Android's picker filters by type only. An
 * empty answer means any file.
 */
object PickerTypes {
    fun mimeTypes(accept: List<String>, mimeForExtension: (String) -> String?): List<String> =
        accept.asSequence()
            .flatMap { it.split(',') }
            .map { it.trim().lowercase() }
            .mapNotNull { entry ->
                when {
                    entry.startsWith('.') && entry.length > 1 -> mimeForExtension(entry.drop(1))
                    entry.contains('/') -> entry
                    else -> null
                }
            }
            .distinct()
            .toList()
}
```

- [ ] **Step 4: Run the tests**

Run: `source android/env.sh && cd android && ./gradlew test`
Expected: `BUILD SUCCESSFUL`; `PickerTypesTest` 3/3.

- [ ] **Step 5: Open the picker from the page** — in `MainActivity.kt` add imports `android.webkit.MimeTypeMap`, `android.webkit.ValueCallback`, `xyz.skycord.android.core.PickerTypes`, and the field and launcher next to the permission launcher:

```kotlin
    /** The page waiting for files; answered exactly once, with null on cancel. */
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        callback.onReceiveValue(pickedUris(result.resultCode, result.data))
    }
```

In the `WebChromeClient` object, next to `onPermissionRequest`:

```kotlin
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean =
                showFilePicker(view, callback, params)
```

And the methods:

```kotlin
    /** Only the current server's own page may open the phone's files. */
    private fun showFilePicker(view: WebView, callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        val server = currentServer
        if (server == null || Origins.of(view.url ?: "") != server) {
            callback.onReceiveValue(null)
            return true
        }
        fileCallback?.onReceiveValue(null)
        fileCallback = callback
        val types = PickerTypes.mimeTypes(params.acceptTypes.toList()) { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) }
        val intent = Intent(Intent.ACTION_GET_CONTENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(types.singleOrNull() ?: "*/*")
        if (types.size > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
        if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        return try {
            pickFiles.launch(intent)
            true
        } catch (e: ActivityNotFoundException) {
            fileCallback = null
            callback.onReceiveValue(null)
            true
        }
    }

    private fun pickedUris(resultCode: Int, data: Intent?): Array<Uri>? {
        if (resultCode != RESULT_OK || data == null) return null
        data.clipData?.let { clip -> return Array(clip.itemCount) { clip.getItemAt(it).uri } }
        return data.data?.let { arrayOf(it) }
    }
```

- [ ] **Step 6: Build and try it**

Run: `source android/env.sh && cd android && ./gradlew test assembleDebug`
Expected: `BUILD SUCCESSFUL`.

On the emulator (started with `-ports 6554,6555`), with the dev client on 5500 and `adb reverse tcp:5500 tcp:5500`: open `http://localhost:5500`, sign in, open a server's settings and choose to change its icon.
Expected: Android's file picker opens (`adb shell dumpsys window | grep mCurrentFocus` shows `documentsui`); back returns to the app with the dialog still open and nothing chosen. If the dev stack is not running, the end-to-end task covers this instead — say so in the report.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/xyz/skycord/android/core/PickerTypes.kt android/app/src/test/java/xyz/skycord/android/core/PickerTypesTest.kt android/app/src/main/java/xyz/skycord/android/MainActivity.kt
git commit -m "Android: a page's file inputs open the phone's file picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The web side — `appBridge()`, back, bar colours, diagnostics

**Files:**
- Modify: `src/composables/desktopBridge.ts`
- Modify (rename `desktopBridge` → `appBridge`): `src/components/modals/SettingsModal.vue`, `src/components/settings/DebugPage.vue`, `src/components/settings/NotificationsPage.vue`, `src/components/settings/PerformancePage.vue`, `src/components/settings/ServersPage.vue`, `src/composables/desktopTitleBar.ts`, `src/composables/useNotifications.ts`, `src/composables/usePerformance.ts`, `src/composables/useUpdates.ts`, `src/composables/useVoiceMedia.ts`, `src/composables/__tests__/desktopBridge.test.ts`
- Create: `src/composables/androidBack.ts`, `src/composables/androidChrome.ts`
- Modify: `src/composables/diagnosticsText.ts`, `src/views/ChatApp.vue`
- Test: `src/composables/__tests__/androidBack.test.ts`, `src/composables/__tests__/desktopBridge.test.ts`, `src/composables/__tests__/diagnosticsText.test.ts`

**Interfaces:**
- Consumes: `window.skycordAndroid` (Task 9).
- Produces: `appBridge(): DesktopBridge | null` (desktop or Android); `DesktopBridge` gains `onBack?(cb: () => boolean): () => void` and `colors?(c: { bar: string; text: string }): void`; `backAction(s)`, `OVERLAY_SELECTOR`, `overlayOpen(doc)`, `pressEscape(doc)` from `androidBack.ts`; `useAndroidChrome()` from `androidChrome.ts`.

- [ ] **Step 1: Write the failing tests**

`src/composables/__tests__/androidBack.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { backAction, overlayOpen, pressEscape, OVERLAY_SELECTOR } from '../androidBack'

describe('the back button, in the page', () => {
  it('closes the search screen first — it does not close on Escape', () => {
    expect(backAction({ searchOpen: true, overlayOpen: true, onConversation: true })).toBe('close-search')
  })
  it('then whatever is open on top', () => {
    expect(backAction({ searchOpen: false, overlayOpen: true, onConversation: true })).toBe('escape')
  })
  it('then from a conversation to the list', () => {
    expect(backAction({ searchOpen: false, overlayOpen: false, onConversation: true })).toBe('to-list')
  })
  it('and otherwise hands it back to Android', () => {
    expect(backAction({ searchOpen: false, overlayOpen: false, onConversation: false })).toBe('none')
  })
  it('knows an overlay by its role, or as an anchored panel', () => {
    expect(OVERLAY_SELECTOR).toContain('[role="dialog"]')
    expect(OVERLAY_SELECTOR).toContain('[role="menu"]')
    // Not `.ap`: every message's hover buttons have that class too.
    expect(OVERLAY_SELECTOR).toContain('[data-anchored-panel]')
    expect(OVERLAY_SELECTOR).not.toContain('.ap')
  })

  const el = (shown: boolean) => ({ dispatchEvent: vi.fn(), getClientRects: () => (shown ? [{}] : []) })
  const docOf = (...els: ReturnType<typeof el>[]) =>
    ({ querySelectorAll: () => els, body: { dispatchEvent: vi.fn() } }) as unknown as Document

  it('counts only an overlay that is showing, not one mounted and hidden', () => {
    expect(overlayOpen(docOf(el(true)))).toBe(true)
    expect(overlayOpen(docOf(el(false)))).toBe(false)
    expect(overlayOpen(docOf())).toBe(false)
  })

  it('sends Escape to the topmost showing overlay, which is where modals listen', () => {
    ;(globalThis as { KeyboardEvent?: unknown }).KeyboardEvent ??= class { constructor(public type: string, public init: object) {} }
    const first = el(true), top = el(true), hidden = el(false)
    pressEscape(docOf(first, top, hidden))
    expect(top.dispatchEvent).toHaveBeenCalledOnce()
    expect(first.dispatchEvent).not.toHaveBeenCalled()
    expect(hidden.dispatchEvent).not.toHaveBeenCalled()
  })
})
```

Add to `src/composables/__tests__/desktopBridge.test.ts` (and rename every `desktopBridge` in it to `appBridge`):

```ts
describe('appBridge on Android', () => {
  it('is the Android bridge when the app put one there', async () => {
    const { appBridge } = await import('../desktopBridge')
    const android = { platform: 'android', changeInstance: async () => {} }
    ;(globalThis as { skycordAndroid?: unknown }).skycordAndroid = android
    expect(appBridge()).toBe(android)
    delete (globalThis as { skycordAndroid?: unknown }).skycordAndroid
    expect(appBridge()).toBeNull()
  })
})
```

Add to `src/composables/__tests__/diagnosticsText.test.ts`:

```ts
describe('on Android', () => {
  it('names the WebView instead of Electron, and leaves out desktop-only lines', async () => {
    const { diagnosticsText } = await import('../diagnosticsText')
    const text = diagnosticsText(
      { app: '0.21.0', electron: '', chromium: '130.0.6723.58', node: '', platform: 'android', osVersion: 'Android 14 (API 34)', addonLoaded: false, perAppAudio: false },
      { origin: 'https://app.skycord.xyz', bundle: 'index-x.js', workletLoaded: true, update: 'Skycord is up to date' },
    )
    expect(text).toContain('Android WebView 130.0.6723.58')
    expect(text).not.toContain('Electron')
    expect(text).not.toContain('per-app audio')
    expect(text).toContain('instance: https://app.skycord.xyz')
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/composables/__tests__/androidBack.test.ts src/composables/__tests__/desktopBridge.test.ts src/composables/__tests__/diagnosticsText.test.ts`
Expected: FAIL — `androidBack` missing, `appBridge` not exported, the Android text not produced.

- [ ] **Step 3: `appBridge()`** — in `src/composables/desktopBridge.ts`, add to the `DesktopBridge` interface (after `notifications?`):

```ts
  /**
   * Android only: the back button, offered to the page first. A handler
   * returns true when it used the press. Returns a function that stops
   * listening.
   */
  onBack?(cb: () => boolean): () => void
  /** Android only: the theme's colours for the status and navigation bars. */
  colors?(c: { bar: string; text: string }): void
```

and replace the exported function at the end of the file:

```ts
/**
 * The app's bridge — the Windows app's (`skycordDesktop`) or the Android
 * app's (`skycordAndroid`) — or null in a browser. Every member past
 * `changeInstance` is optional and checked where it is used, so one shape
 * serves both.
 */
export const appBridge = (): DesktopBridge | null => {
  const g = globalThis as { skycordDesktop?: unknown; skycordAndroid?: unknown }
  for (const b of [g.skycordDesktop, g.skycordAndroid]) {
    if (b && typeof b === 'object' && typeof (b as DesktopBridge).changeInstance === 'function') return b as DesktopBridge
  }
  return null
}
```

Then rename the call sites:

Every call site imports it as `import { desktopBridge` (sometimes followed by `, type …`), so two substitutions cover them all:

```bash
grep -rl "desktopBridge()\|import { desktopBridge" src --include=*.ts --include=*.vue | grep -v "^src/composables/desktopBridge.ts$" | xargs sed -i -e 's/\bdesktopBridge()/appBridge()/g' -e 's/import { desktopBridge/import { appBridge/' -e "s/describe('desktopBridge'/describe('appBridge'/"
grep -rn "desktopBridge" src --include=*.ts --include=*.vue | grep -v "/desktopBridge'"
```

Expected from the second command: only the `@/composables/desktopBridge.ts` file's own comments, if any — every other remaining match is an import path ending in `/desktopBridge'`.

Then the Servers page, whose copy promises renaming — the Android launcher switches, adds and removes, and does not rename. In `src/components/settings/ServersPage.vue`, change the comment's first line to `Settings › Servers, inside the Windows or Android app only: the servers saved in the` and the description span to:

```vue
        <span class="st-field-value muted">
          {{ desktop.platform === 'android'
            ? 'Switch servers, remove the ones you’ve saved, or add another.'
            : 'Switch servers, rename or remove the ones you’ve saved, or add another.' }}
          The list is kept by the app, so no server can see the others you use.
        </span>
```

- [ ] **Step 4: The page's half of the back button** — `src/composables/androidBack.ts`

```ts
/**
 * The page's half of the Android back button, in this order:
 *  1. the search screen closes (it has its own close button, not Escape);
 *  2. whatever is open on top closes — the same Escape it already obeys;
 *  3. a conversation goes back to the list;
 *  4. otherwise the press is handed back to Android, which puts the app in
 *     the background.
 */
export type BackAction = 'close-search' | 'escape' | 'to-list' | 'none'

export const backAction = (s: { searchOpen: boolean; overlayOpen: boolean; onConversation: boolean }): BackAction =>
  s.searchOpen ? 'close-search' : s.overlayOpen ? 'escape' : s.onConversation ? 'to-list' : 'none'

/**
 * Modals, sheets and popouts are dialogs; context menus are menus; flyouts are
 * AnchoredPanel, which marks itself with data-anchored-panel. (Its class, .ap,
 * is not unique: every message's hover buttons use it too.)
 */
export const OVERLAY_SELECTOR = '[role="dialog"], [role="menu"], [data-anchored-panel]'

/** The overlays actually showing, in document order — a mounted, hidden one has no boxes. */
const openOverlays = (doc: Pick<Document, 'querySelectorAll'>): Element[] =>
  Array.from(doc.querySelectorAll(OVERLAY_SELECTOR)).filter(el => el.getClientRects().length > 0)

export const overlayOpen = (doc: Pick<Document, 'querySelectorAll'> = document): boolean =>
  openOverlays(doc).length > 0

/**
 * Escape, sent to the topmost overlay: modals listen on their own element,
 * and the event bubbles on to the document-level listeners the others use.
 */
export const pressEscape = (doc: Pick<Document, 'querySelectorAll' | 'body'> = document): void => {
  const open = openOverlays(doc)
  const target: EventTarget = open[open.length - 1] ?? doc.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}
```

- [ ] **Step 5: Bar colours** — `src/composables/androidChrome.ts`

```ts
/**
 * The theme's colours to Android's status and navigation bars — the same
 * tokens the Windows title bar takes (--bg-floor, --text-1), resent whenever
 * the theme changes.
 */
import { onScopeDispose } from 'vue'
import { appBridge } from './desktopBridge'

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export const useAndroidChrome = (): void => {
  const bridge = appBridge()
  if (bridge?.platform !== 'android' || !bridge.colors) return
  let sent = ''
  const send = () => {
    const bar = token('--bg-floor'), text = token('--text-1')
    if (!bar || !text || `${bar}${text}` === sent) return
    sent = `${bar}${text}`
    bridge.colors!({ bar, text })
  }
  const observer = new MutationObserver(send)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
  send()
  onScopeDispose(() => observer.disconnect())
}
```

- [ ] **Step 6: Diagnostics** — in `src/composables/diagnosticsText.ts`, replace the `diagnosticsText` body:

```ts
export const diagnosticsText = (f: AboutFacts, x: DiagnosticsExtra): string => {
  const android = f.platform === 'android'
  return [
    `Skycord ${f.app}`,
    android ? `Android WebView ${f.chromium}` : `Electron ${f.electron} · Chromium ${f.chromium} · Node ${f.node}`,
    android ? f.osVersion : `${f.platform} ${f.osVersion}`,
    '',
    `instance: ${x.origin}`,
    `bundle: ${x.bundle}`,
    '',
    ...(android ? [] : [`addon loaded: ${yn(f.addonLoaded)}`, `per-app audio: ${yn(f.perAppAudio)}`]),
    `worklet: ${x.workletLoaded ? 'loaded' : 'not loaded'}`,
    '',
    `updates: ${x.update}`,
  ].join('\n')
}
```

- [ ] **Step 7: Wire it in ChatApp** — in `src/views/ChatApp.vue`, add imports next to the other composables:

```ts
import { appBridge } from '@/composables/desktopBridge'
import { backAction, overlayOpen, pressEscape } from '@/composables/androidBack'
import { useAndroidChrome } from '@/composables/androidChrome'
```

(If `appBridge` is already imported there after the Step 3 rename, do not import it twice.)

`mobileNav` is declared at line 140 and `showSearchScreen` at line 364; both must exist before this runs, so add it directly below the `showSearchScreen` declaration (around line 365):

```ts
// Android: the back button, offered to the page first (see androidBack.ts),
// and the system bars in the theme's colour.
const stopAndroidBack = appBridge()?.onBack?.(() => {
  const a = backAction({ searchOpen: showSearchScreen.value, overlayOpen: overlayOpen(), onConversation: mobileNav.onConversation.value })
  if (a === 'close-search') showSearchScreen.value = false
  else if (a === 'escape') pressEscape()
  else if (a === 'to-list') mobileNav.backToList()
  return a !== 'none'
})
onBeforeUnmount(() => stopAndroidBack?.())
useAndroidChrome()
```

- [ ] **Step 8: Run the tests and the typecheck**

Run: `npx vitest run src/composables/__tests__/androidBack.test.ts src/composables/__tests__/desktopBridge.test.ts src/composables/__tests__/diagnosticsText.test.ts && npx vue-tsc --noEmit -p tsconfig.json`
Expected: all pass; typecheck clean.

Run: `npx vitest run src/ desktop/src android/launcher`
Expected: everything passes.

- [ ] **Step 9: Try it on the emulator** — the dev client serves the changed code. In the app: open a conversation → back → the list; open the emoji picker or a context menu → back → it closes; open search → back → it closes; at the list → back → the app goes to the background. Switch the app's theme to light in Settings › Appearance → the status bar turns light with dark icons.

- [ ] **Step 10: Commit**

```bash
git add src/composables/desktopBridge.ts src/composables/androidBack.ts src/composables/androidChrome.ts src/composables/diagnosticsText.ts src/views/ChatApp.vue src/components/modals/SettingsModal.vue src/components/settings/DebugPage.vue src/components/settings/NotificationsPage.vue src/components/settings/PerformancePage.vue src/components/settings/ServersPage.vue src/composables/desktopTitleBar.ts src/composables/useNotifications.ts src/composables/usePerformance.ts src/composables/useUpdates.ts src/composables/useVoiceMedia.ts src/composables/__tests__/androidBack.test.ts src/composables/__tests__/desktopBridge.test.ts src/composables/__tests__/diagnosticsText.test.ts
git commit -m "Web: the Android app's bridge — back button, bar colours, diagnostics

appBridge() returns the Windows or the Android bridge. The back button
closes search, then what is open on top, then leaves a conversation, and
otherwise lets Android put the app away.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: End to end on the emulator

**Files:**
- Create: `android/e2e/shell.e2e.mjs`

**Interfaces:**
- Consumes: the debug APK (Tasks 2–10), the web changes (Task 11), the music dev stack — client on 6200 (Vite, `host: 0.0.0.0`), API on 3050 (`node .dev/desk-api.mjs` in `H:\projects\sykord-wt`), Playwright from `desktop/node_modules/playwright-core` (what the desktop probes use).
- Produces: a script that exits 0 with `23/23 passed`.

Port note (2026-10-05): Windows' reserved TCP ranges on this machine grew to cover 5041–5740, so the dev client moved from 5500 to **6200** (`npx vite --host 0.0.0.0 --port 6200 --strictPort` in the worktree), and `.dev/desk-api.mjs` now has `CLIENT_ORIGIN: 'http://localhost:6200'`. Check `netsh interface ipv4 show excludedportrange protocol=tcp` if a port suddenly refuses to bind.

The dev API pins its session cookie to `localhost` (`COOKIE_DOMAIN: 'localhost'` in `.dev/desk-api.mjs`), so in development a session can only live on `http://localhost:6200`. The second server — the same client as `http://127.0.0.1:6200`, a different origin — is therefore checked for asking its own sign-in, and the first for still being signed in after the switch. That is the property the spec cares about: visiting one server never signs you out of another.

- [ ] **Step 1: Write the script** — `android/e2e/shell.e2e.mjs`

```js
/**
 * The Android shell, end to end, on the emulator.
 *
 * Needs: the emulator running (`emulator -avd skycord35 -ports 6554,6555`), the debug APK
 * installed, `adb reverse tcp:6200 tcp:6200`, and the dev stack: the client
 * on 6200 and its API on 3050 (`node .dev/desk-api.mjs` in
 * H:\projects\sykord-wt). It makes its own throwaway account on that local
 * API; nothing here touches a real server.
 *
 * The dev API pins its cookie to `localhost`, so only http://localhost:6200
 * can hold a session. The second server (http://127.0.0.1:6200) is checked
 * for asking its own sign-in, and the first for staying signed in.
 *
 *   node android/e2e/shell.e2e.mjs
 */
import { createRequire } from 'module'
import { execSync } from 'child_process'

const { _android } = createRequire(new URL('../../desktop/package.json', import.meta.url))('playwright-core')

const PKG = 'xyz.skycord.android'
const API = 'http://127.0.0.1:3050'
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const passes = p => p.then(() => true, () => false)
const wait = ms => new Promise(r => setTimeout(r, ms))

// ── a throwaway account, with a server to open, on the local dev API ─────
// The password satisfies server/utils/validators.ts (no hyphen: it is not
// in the accepted set of special characters).
const tag = Date.now().toString(36)
const account = { username: `droid_${tag}`, email: `droid_${tag}@example.com`, password: `Droid!${tag}A1`, displayName: 'Droid' }
const post = async (path, body, token) => {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`)
  return r.json()
}
const { accessToken } = await post('/auth/register', account)
const serverName = `Android E2E ${tag}`
await post('/servers', { name: serverName }, accessToken)

// ── the device ───────────────────────────────────────────────────────────
const [device] = await _android.devices()
if (!device) { console.error('no emulator: start one with `emulator -avd skycord35 -ports 6554,6555`'); process.exit(1) }
const sh = async cmd => (await device.shell(cmd)).toString()
const back = () => sh('input keyevent 4')
const inFront = async () => (await sh('dumpsys window | grep mCurrentFocus')).includes(PKG)
const launch = async () => { await sh(`am start -n ${PKG}/.MainActivity`); await wait(2500) }
const pageOf = async (urlPart) => {
  for (let i = 0; i < 40; i++) {
    for (const wv of device.webViews()) {
      if (wv.pkg() !== PKG) continue
      const p = await wv.page()
      if (p.url().includes(urlPart)) return p
    }
    await wait(500)
  }
  throw new Error(`no WebView page at ${urlPart}`)
}

await sh(`pm clear ${PKG}`)
await launch()

// ── first launch ─────────────────────────────────────────────────────────
let launcher = await pageOf('appassets.androidplatform.net')
await launcher.waitForSelector('#servers li')
check('first launch shows the launcher', await launcher.locator('text=Join a server by address').isVisible())
check('it offers the hosted server', await launcher.locator('text=the hosted server').isVisible())

await launcher.fill('#address', 'not an address at all')
await launcher.click('#check')
await launcher.waitForSelector('#problem:not([hidden])')
check('a wrong address gets a plain reason', /doesn.t look like a server address/.test(await launcher.locator('#problem').textContent()))

await launcher.fill('#address', 'http://localhost:5999')
await launcher.click('#check')
check('an unreachable address says so', await passes(launcher.waitForFunction(
  () => /Couldn.t reach/.test(document.querySelector('#problem')?.textContent ?? ''), null, { timeout: 10000 })))

await launcher.fill('#address', 'http://localhost:6200')
await launcher.click('#check')
const carded = await passes(launcher.waitForSelector('#found:not([hidden])', { timeout: 10000 }))
check('a real server shows its card', carded && (await launcher.locator('#found-host').textContent()) === 'localhost:6200')
check('localhost gets no http warning', await launcher.locator('#found-warning').isHidden())
await launcher.click('#found-open')

// ── sign in ──────────────────────────────────────────────────────────────
let app = await pageOf('localhost:6200')
check('the server\u2019s own sign-in page loads', await passes(app.waitForSelector('#login-identifier', { timeout: 30000 })))
check('the bridge is there', await app.evaluate(() => window.skycordAndroid?.platform === 'android'))
await app.fill('#login-identifier', account.username)
await app.fill('#login-password', account.password)
await app.getByRole('button', { name: 'Sign In', exact: true }).click()
check('signing in works', await passes(app.waitForSelector('#login-identifier', { state: 'detached', timeout: 40000 })))
await wait(2000)

// ── outside links ────────────────────────────────────────────────────────
const before = app.url()
await app.evaluate(() => { location.href = 'https://example.org/' })
await wait(1500)
check('an outside link leaves the WebView where it was', app.url() === before, app.url())
await launch()   // the phone's browser took the front; bring the app back

// ── the back button: overlay → conversation → list → background ─────────
const onConversation = () => app.evaluate(() => !!document.querySelector('.shell.m-chat'))
await app.click(`[role="button"][aria-label="${serverName}"]`)
await wait(1000)
// Entering a server may already open its landing channel on a phone.
if (!(await onConversation())) await app.click('.ch-item:not(.voice)')
await wait(800)
check('a channel opens as a conversation', await onConversation())
await app.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })))
await wait(500)
check('the quick switcher opens', await app.evaluate(() => !!document.querySelector('[role="dialog"]')))
await back(); await wait(600)
check('back closes what is open on top', await app.evaluate(() => !document.querySelector('[role="dialog"]')))
check('\u2026and stays in the conversation', await onConversation())
await back(); await wait(600)
check('back from a conversation goes to the list', !(await onConversation()))
await back(); await wait(800)
check('back at the list puts the app in the background', !(await inFront()))
await launch()
check('reopening shows the same server, still signed in', await app.evaluate(() => !document.querySelector('#login-identifier')))

// ── the file picker ──────────────────────────────────────────────────────
// A real tap (Playwright's click is a user gesture), as the icon and music
// pickers get; Chromium only opens a picker for one.
await app.evaluate(() => {
  const input = Object.assign(document.createElement('input'), { type: 'file', id: 'e2e-file', accept: 'audio/*,.flac' })
  Object.assign(input.style, { position: 'fixed', top: '0', left: '0', width: '200px', height: '60px', zIndex: '99999' })
  input.addEventListener('change', () => { window.__e2ePicked = input.files.length })
  document.body.appendChild(input)
})
await app.click('#e2e-file')
await wait(1500)
check('a file input opens the phone’s picker', (await sh('dumpsys window | grep mCurrentFocus')).includes('documentsui'))
await back(); await wait(800)
check('cancelling the picker returns to the app with nothing chosen',
  (await inFront()) && await app.evaluate(() => { const n = window.__e2ePicked; document.querySelector('#e2e-file')?.remove(); return n === undefined || n === 0 }))

// ── a second server, and the first stays signed in ──────────────────────
// Fire and forget: the page is replaced before the reply could arrive.
await app.evaluate(() => { void window.skycordAndroid.changeInstance() })
launcher = await pageOf('appassets.androidplatform.net')
await launcher.waitForSelector('#address')
await launcher.fill('#address', 'http://127.0.0.1:6200')
await launcher.click('#check')
await launcher.waitForSelector('#found:not([hidden])', { timeout: 10000 })
await launcher.click('#found-open')
const second = await pageOf('127.0.0.1:6200')
check('a new server asks for its own sign-in', await passes(second.waitForSelector('#login-identifier', { timeout: 30000 })))
await second.evaluate(() => { void window.skycordAndroid.changeInstance() })
launcher = await pageOf('appassets.androidplatform.net')
await launcher.locator('.lc-open', { hasText: 'localhost:6200' }).click()
app = await pageOf('localhost:6200')
await wait(3000)
check('switching back keeps the first server signed in', await app.evaluate(() => !document.querySelector('#login-identifier')))

// ── a server that cannot be reached ──────────────────────────────────────
await sh(`am force-stop ${PKG}`)
execSync('adb reverse --remove tcp:6200')
await launch()
check('an unreachable server gets the native screen', await passes(device.wait({ text: 'Retry' }, { timeout: 15000 })))
execSync('adb reverse tcp:6200 tcp:6200')
await device.tap({ text: 'Retry' })
check('Retry loads it once it is back', await passes(device.wait({ text: 'Retry' }, { state: 'gone', timeout: 15000 })))

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
await device.close()
process.exit(results.every(Boolean) ? 0 : 1)
```

- [ ] **Step 2: Run it**

With the dev stack up (client 6200, API 3050), the emulator running and the debug APK from Task 11's state installed:

Run: `source android/env.sh && adb reverse tcp:6200 tcp:6200 && node android/e2e/shell.e2e.mjs`
Expected: `23/23 passed`. A failure is a slice-1 bug: fix it in the task it belongs to (with a unit test where the decision is in `core/`), then rerun.

- [ ] **Step 3: The old-WebView screen (optional, needs the API 26 image from Task 1)**

```bash
sdkmanager.bat "system-images;android-26;google_apis;x86"
echo no | avdmanager.bat create avd -n skycord26 -k "system-images;android-26;google_apis;x86" -d pixel
emulator -avd skycord26 -ports 6554,6555 -no-snapshot -no-audio &
adb wait-for-device && adb install -r android/app/build/outputs/apk/debug/app-debug.apk && adb shell am start -n xyz.skycord.android/.MainActivity
adb shell uiautomator dump /sdcard/ui.xml >/dev/null && adb shell cat /sdcard/ui.xml | grep -o "Android System WebView needs an update"
```

Expected: the last command prints `Android System WebView needs an update` (the stock WebView of the API 26 image predates the message listener). If that image's WebView is new enough, note it and skip — the check is the feature test in `webViewIsNewEnough()`.

- [ ] **Step 4: Commit**

```bash
git add android/e2e/shell.e2e.mjs
git commit -m "Android: end to end on the emulator — launcher, sign-in, links, back, switching, unreachable

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Releasing

**Files:**
- Create: `.github/workflows/android-release.yml`
- Modify: `landing/index.html` (after the first release exists)
- Modify: `android/README.md` (the key and the repo, once made)

**Interfaces:**
- Consumes: the Gradle build (`-PappVersion`, `SKYCORD_KEYSTORE*` env), `npm run build:launcher`.
- Produces: tag `android-vX.Y.Z` → a public release in `xSMDx/skycord-android-releases` with `skycord-X.Y.Z.apk` and `latest.json`.

- [ ] **Step 1: Owner actions (ask; do not do these on their behalf).** These touch accounts and secrets:
  1. Create the public repo `xSMDx/skycord-android-releases` (empty, with a README).
  2. Create a fine-grained token with Contents: read and write on that repo only; save it as the secret `ANDROID_RELEASES_TOKEN` in `xSMDx/skycord`.
  3. Make the signing key on their own machine and keep a copy offline:
     ```bash
     keytool -genkeypair -v -keystore skycord-release.jks -alias skycord -keyalg RSA -keysize 4096 -validity 36500
     base64 -w0 skycord-release.jks > skycord-release.jks.b64
     ```
     Then save the secrets `ANDROID_KEYSTORE_BASE64` (the .b64 contents), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`skycord`), `ANDROID_KEY_PASSWORD`.

- [ ] **Step 2: The workflow** — `.github/workflows/android-release.yml`

```yaml
# The Android app's release. A tag like android-v0.21.0 builds the APK,
# signs it, and publishes it with latest.json — which installed apps check —
# to the public releases-only repo.
name: Android release

on:
  push:
    tags: ['android-v*']

permissions:
  contents: read

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - uses: android-actions/setup-android@v3
      - name: Version from the tag
        id: version
        run: echo "v=${GITHUB_REF_NAME#android-v}" >> "$GITHUB_OUTPUT"
      # Refuse rather than sign with a key nobody can sign with again: an APK
      # signed by a new key cannot update any phone that has the old one.
      - name: The signing key is there
        env:
          KS: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
        run: test -n "$KS" || { echo "ANDROID_KEYSTORE_BASE64 is not set"; exit 1; }
      - name: Unit tests
        working-directory: android
        run: ./gradlew test
      - name: Build and sign
        working-directory: android
        env:
          SKYCORD_KEYSTORE: ${{ runner.temp }}/release.jks
          SKYCORD_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          SKYCORD_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          SKYCORD_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
          KS: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
          V: ${{ steps.version.outputs.v }}
        run: |
          echo "$KS" | base64 -d > "$SKYCORD_KEYSTORE"
          ./gradlew assembleRelease -PappVersion="$V"
          "$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)/apksigner" verify --print-certs app/build/outputs/apk/release/app-release.apk
          cp app/build/outputs/apk/release/app-release.apk "$RUNNER_TEMP/skycord-$V.apk"
          rm -f "$SKYCORD_KEYSTORE"
      - name: latest.json
        env:
          V: ${{ steps.version.outputs.v }}
        run: |
          SHA=$(sha256sum "$RUNNER_TEMP/skycord-$V.apk" | cut -d' ' -f1)
          cat > "$RUNNER_TEMP/latest.json" <<EOF
          {"version":"$V","url":"https://github.com/xSMDx/skycord-android-releases/releases/download/android-v$V/skycord-$V.apk","sha256":"$SHA","notes":"https://skycord.xyz/changelog/"}
          EOF
          cat "$RUNNER_TEMP/latest.json"
      - name: Publish
        env:
          GH_TOKEN: ${{ secrets.ANDROID_RELEASES_TOKEN }}
          V: ${{ steps.version.outputs.v }}
          REPO: xSMDx/skycord-android-releases
        run: |
          gh release create "android-v$V" -R "$REPO" --title "Skycord for Android $V" \
            --notes "Download **skycord-$V.apk** below and open it on your phone. Installed copies offer each update themselves." \
            "$RUNNER_TEMP/skycord-$V.apk" "$RUNNER_TEMP/latest.json"
```

- [ ] **Step 3: Check the workflow file**

The repo has a YAML parser in the desktop project's dependencies; it catches indentation and quoting mistakes before a tag ever runs the file.

Run: `node -e "require('./desktop/node_modules/js-yaml').load(require('fs').readFileSync('.github/workflows/android-release.yml','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/android-release.yml
git commit -m "Android: the release — tag, test, sign, publish with latest.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: After the owner's first `android-v0.21.0` release exists, the landing page.** In `landing/index.html`, after each "Download for Windows" link (lines ~91–94 and ~465–466), add:

```html
      <a class="btn big ghost" href="https://github.com/xSMDx/skycord-android-releases/releases/latest">
        <svg class="ic" aria-hidden="true"><use href="#i-download"/></svg>
        Download for Android
      </a>
```

and change the hero meta line to `v0.21.0 · Windows 10 and 11 · Android 8 and newer · or run it on your own box in one command`. Commit with the v0.21 changelog entry, not before: the page must not offer a download that does not exist.

---

## Self-review notes (done while writing)

- **Spec coverage:** §1 main screen (Task 8), bridge members and origin rules (Task 9; `colors`, `onBack`, `updates`, `about`, `changeInstance`, `openServers`), the 86+ WebView rule and its screen (Task 8, tested Task 12 step 4), `appBridge()` (Task 11), the launcher reusing the desktop modules (Task 6), back button rules incl. 300 ms (Tasks 3, 10, 11), outside links (Tasks 3, 8, 12), permissions only for the current server (Task 8), unreachable screen (Task 8, Task 12), phone chrome (Tasks 5, 8, 11), `http://` warning (Task 6), switching servers kept signed in (Task 12), updates with SHA-256 and the installer (Tasks 5, 7), release and the signing key (Task 13), local toolchain on H: and `adb reverse` localhost (Tasks 1, 9, 12), tests listed in §3 (Tasks 2–6, 11, 12).
- **Types:** `UpdateState` / `toJson` match `src/composables/desktopBridge.ts`'s `UpdateState`; `about()` matches `AboutFacts`; `LauncherApi` matches `launcher-shim.js` and `BridgeHost.onLauncher`; `BackGate.timeoutMs` used by Task 10.
