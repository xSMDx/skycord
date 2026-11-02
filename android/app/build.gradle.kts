plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// The release workflow passes -PappVersion=X.Y.Z from the tag. versionCode
// must only ever grow, so it is derived from the version, not counted.
val appVersion = (findProperty("appVersion") as String?) ?: "0.20.99"
require(Regex("""\d+\.\d{1,2}\.\d{1,2}""").matches(appVersion)) {
    "appVersion must be X.Y.Z with Y and Z below 100 (versionCode is X*10000 + Y*100 + Z); got '$appVersion'"
}
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
            // Read from the environment, only when SKYCORD_KEYSTORE is set. The release
            // workflow does not set it for the build — the build, and the npm and Gradle
            // code it runs, never sees the key; a separate step signs the unsigned APK.
            // A local release build is unsigned too, so it cannot be mistaken for a real one.
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
            // Unsigned (app-release-unsigned.apk) unless the keystore is in the environment.
            signingConfig = if (System.getenv("SKYCORD_KEYSTORE") != null) signingConfigs.getByName("release") else null
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
    // The background connection (notify/LiveConnection): the Java client of the socket.io the
    // server and the web client speak. It brings OkHttp 3.12 and Okio. Android has org.json
    // built in, so the library's own copy stays out, as the client's Android guide says.
    implementation(libs.socketio.client) {
        exclude(group = "org.json", module = "json")
    }
    // socket.io-client 2.1.1 reaches OkHttp through engine.io-client 2.1.0, which asks for 3.12.12 (the
    // 3.12 line is the last that still runs on Android 5). 3.12.13 is the last release of that line, so
    // it is pinned here: the newest patch, and strictly 3.x, whatever else may one day be added.
    constraints {
        implementation("com.squareup.okhttp3:okhttp") {
            version { strictly("3.12.13") }
            because("the last patch release of the 3.12 line socket.io's engine.io client builds on; engine.io asks for 3.12.12")
        }
    }
    testImplementation(libs.junit)
    // Android's own org.json is a stub in JVM unit tests; this is the real one.
    testImplementation(libs.orgjson)
}

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
