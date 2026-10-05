plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// The release workflow passes -PappVersion=X.Y.Z from the tag. versionCode
// must only ever grow, so it is derived from the version, not counted.
val appVersion = (findProperty("appVersion") as String?) ?: "0.21.0"
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
