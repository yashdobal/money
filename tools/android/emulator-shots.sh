#!/usr/bin/env bash
# Runs in the Android emulator in GitHub Actions (.github/workflows/android.yml), with the demo build of the app
# (made-up data, -Pmoney.demo=true). The screens, Back, dark mode and the lock run on the release build (shrunk by
# R8, as installed on the phone); the widget and alert pictures then use the debug build and its test. Saves
# screenshots; fails if the app crashes or Back leaves the app from a sheet.
#   bash tools/android/emulator-shots.sh <out folder>
set -u
OUT="${1:-shots}"; mkdir -p "$OUT"
exec > >(tee -a "$OUT/emulator.log") 2>&1
PKG=com.yashdobal.money
RELEASE_APK=android/app/build/outputs/apk/release/app-release.apk
APK=android/app/build/outputs/apk/debug/app-debug.apk
TEST_APK=android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
fail=0
shot() { sleep "${2:-2}"; adb exec-out screencap -p > "$OUT/$1.png"; echo "shot $1"; }
open() { adb shell "am start -W -a android.intent.action.VIEW -d '$1' $PKG" >/dev/null; }
front() { adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | head -1; }

adb shell settings put system screen_off_timeout 1800000
adb shell svc power stayon true
adb shell input keyevent KEYCODE_WAKEUP
adb install -r -g "$RELEASE_APK" || exit 1
adb logcat -c

# light
open "https://yash-money.pages.dev/#/today";  shot phone-light-today 12
open "https://yash-money.pages.dev/#/cards";  shot phone-light-cards 3
open "https://yash-money.pages.dev/#/settings"; shot phone-light-settings 3
adb shell input swipe 500 1600 500 500 300;   shot phone-light-settings-more 2
# the widget's + while the app is open: the add sheet on Today; Back closes it and stays in the app
open "https://yash-money.pages.dev/#/today?sheet=add"; shot phone-light-add-sheet 3
adb shell input keyevent KEYCODE_BACK;        shot phone-light-after-back 2
if front | grep -q "$PKG"; then echo "::notice::PASS Back from the add sheet stays in the app"; else echo "::error::FAIL Back from the add sheet left the app: $(front)"; fail=1; fi
# a cold start straight on the add sheet (the launcher shortcut / widget with the app closed), then Back
adb shell am force-stop $PKG
open "https://yash-money.pages.dev/#/today?sheet=add"; shot phone-light-cold-add 10
adb shell input keyevent KEYCODE_BACK;        shot phone-light-cold-after-back 2
if front | grep -q "$PKG"; then echo "::notice::PASS cold start on the add sheet, then Back, stays in the app"; else echo "::error::FAIL Back after a cold start on the sheet left the app: $(front)"; fail=1; fi

# dark (the app restarts its screen for the new theme)
adb shell cmd uimode night yes
sleep 6
open "https://yash-money.pages.dev/#/today";  shot phone-dark-today 6
open "https://yash-money.pages.dev/#/cards";  shot phone-dark-cards 3
open "https://yash-money.pages.dev/#/settings"; shot phone-dark-settings 3
adb shell cmd uimode night no
sleep 4

# the fingerprint lock: give the phone a PIN, start cold, cancel the prompt → the lock screen with its Unlock button
adb shell locksettings set-pin 1111
adb shell am force-stop $PKG
adb shell "am start -W -n $PKG/.MainActivity" >/dev/null; shot phone-lock-prompt 4
adb shell input keyevent KEYCODE_BACK;        shot phone-lock-screen 2
adb shell locksettings clear --old 1111

# the widget, drawn by the real code with the numbers the app just sent (they stay across the reinstall); alerts in
# the shade. The debug build has the test that draws them.
adb logcat -d > "$OUT/logcat-release.txt"
adb install -r -g "$APK" && adb install -r "$TEST_APK" || exit 1
adb shell am instrument -w -e class $PKG.Shots $PKG.test/androidx.test.runner.AndroidJUnitRunner | tee "$OUT/instrument.txt"
grep -q "OK (" "$OUT/instrument.txt" || { echo "::error::FAIL widget/notification test: $(tr '\n' ' ' < "$OUT/instrument.txt" | cut -c1-900)"; fail=1; }
adb shell input keyevent KEYCODE_HOME
adb shell cmd statusbar expand-notifications; shot phone-notifications 3
adb shell cmd statusbar collapse
adb pull "/sdcard/Android/data/$PKG/files/shots" "$OUT/widget" >/dev/null && echo "pulled widget shots"

adb logcat -d > "$OUT/logcat.txt"
cat "$OUT/logcat-release.txt" >> "$OUT/logcat.txt"
if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt"; then echo "::error::FAIL the app crashed: $(grep -A12 'FATAL EXCEPTION' "$OUT/logcat.txt" | head -14 | tr '\n' ' ' | cut -c1-900)"; fail=1; fi
js=$(grep -E " Money *:" "$OUT/logcat.txt" | grep -iE "error|uncaught" | head -8 | tr '\n' ' ' | cut -c1-900)
[ -n "$js" ] && echo "::warning::page errors: $js"
echo "::notice::screenshots: $(ls "$OUT" | tr '\n' ' ')"
exit $fail
