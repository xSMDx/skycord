#!/usr/bin/env bash
# Source this, don't run it: `source android/env.sh`.
# The Android toolchain lives on H: because C: has no free space, and every
# tool that would otherwise write into the user profile is pointed at H: too.
#
# The variables are Windows paths (H:/...) because Java, Gradle and the SDK
# tools are Windows programs and read them as such; PATH is bash's own, so it
# takes the /h/... form. On Windows the SDK manager is sdkmanager.bat and the
# AVD manager avdmanager.bat — bash does not add the .bat for you.
#
# The emulator keeps its own settings under ANDROID_EMULATOR_HOME, which
# otherwise lands in C:\Users\<you>\.android.
export ANDROID_ROOT="H:/android"
export JAVA_HOME="$ANDROID_ROOT/jdk-17"
export ANDROID_HOME="$ANDROID_ROOT/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="$ANDROID_ROOT/gradle-home"
export ANDROID_USER_HOME="$ANDROID_ROOT/android-home"
export ANDROID_EMULATOR_HOME="$ANDROID_ROOT/android-home"
export ANDROID_AVD_HOME="$ANDROID_ROOT/avd"
export PATH="/h/android/jdk-17/bin:/h/android/sdk/cmdline-tools/latest/bin:/h/android/sdk/platform-tools:/h/android/sdk/emulator:/h/android/gradle-8.10.2/bin:$PATH"
