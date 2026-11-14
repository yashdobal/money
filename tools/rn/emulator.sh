#!/usr/bin/env bash
# The Money RN demo build in the emulator (made-up data, signed in): every tab, the add sheet from a shortcut's link,
# Settings, and the app's log. Fails if the app crashed or isn't running. Usage: emulator.sh <outDir>
set -u
OUT=${1:-phone}; mkdir -p "$OUT"
PKG=com.yashdobal.money.rn
# the demo data is from early December 2026
adb root > /dev/null 2>&1; sleep 2
adb shell "date 120819302026.00" > "$OUT/date.txt" 2>&1 || true
adb install -r apk/money-rn-*.apk > "$OUT/install.txt" 2>&1 || { cat "$OUT/install.txt"; exit 1; }
adb logcat -c
# the emulator itself is slow on GitHub's machines: no "isn't responding" pop-ups over the app, and close any shown
adb shell settings put global hide_error_dialogs 1 > /dev/null 2>&1 || true
calm() { adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null 2>&1 || true; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1
sleep 40; calm; sleep 2; shot 1-today
# the navigation bar: six tabs across the bottom of a 1080×2400 screen
X=(90 270 450 630 810 990); N=(1-today 2-plan 3-cards 4-spend 5-activity 5b-trips)
for i in 1 2 3 4 5; do calm; adb shell input tap ${X[$i]} 2250; sleep 6; shot "${N[$i]}"; adb exec-out uiautomator dump /dev/tty 2>/dev/null | grep -o 'text="[^"]\+"' | head -40 > "$OUT/${N[$i]}.txt" || true; done
# Trips: further down the screen, a card's sheet, and the sheet scrolled to its end (a tall sheet must scroll inside its frame)
adb shell input swipe 540 1900 540 500 400; sleep 3; shot 5c-trips-cards
calm; adb shell am start -a android.intent.action.VIEW -d "moneyrn://trips?sheet=tripcard:hsbc-travelone" $PKG > /dev/null 2>&1; sleep 6; shot 5d-trip-card
adb shell input swipe 540 1900 540 400 300; sleep 1; adb shell input swipe 540 1900 540 400 300; sleep 1; adb shell input swipe 540 1900 540 400 300; sleep 3; shot 5e-trip-card-end
adb exec-out uiautomator dump /dev/tty 2>/dev/null | grep -o 'text="[^"]\+"' | tail -30 > "$OUT/5e-trip-card-end.txt" || true
adb shell input keyevent KEYCODE_BACK; sleep 2
adb shell am start -a android.intent.action.VIEW -d "moneyrn://today?sheet=add" $PKG > /dev/null 2>&1; sleep 6; shot 6-add
adb shell input keyevent KEYCODE_BACK; sleep 2
calm; adb shell am start -a android.intent.action.VIEW -d "moneyrn://settings" $PKG > /dev/null 2>&1; sleep 7; shot 7-settings; adb exec-out uiautomator dump /dev/tty 2>/dev/null | grep -o 'text="[^"]\+"' | head -40 > "$OUT/7-settings.txt" || true
adb shell am start -a android.intent.action.VIEW -d "moneyrn://today?sheet=explain" $PKG > /dev/null 2>&1; sleep 5; shot 8-explain
# the effects (demo build): payday coins falling into the card, a confetti burst, the salary streams on Plan
calm; adb shell am start -a android.intent.action.VIEW -d "moneyrn://today?fx=coins" $PKG > /dev/null 2>&1; sleep 3; shot 9-coins; sleep 1; shot 9b-coins
calm; adb shell am start -a android.intent.action.VIEW -d "moneyrn://today?fx=paid" $PKG > /dev/null 2>&1; sleep 1.4; shot 10-burst
calm; adb shell am start -a android.intent.action.VIEW -d "moneyrn://plan" $PKG > /dev/null 2>&1; sleep 8; adb shell input swipe 24 1900 24 500 1600; sleep 2; adb shell input swipe 24 1900 24 900 1600; sleep 4; shot 11-flow; adb shell input swipe 24 1900 24 600 1600; sleep 4; shot 11b-calendar
adb shell am start -a android.intent.action.VIEW -d "moneyrn://cards" $PKG > /dev/null 2>&1; sleep 5; (adb shell input swipe 700 600 720 610 2500 &) ; sleep 1.5; shot 12-card-light; sleep 2
# into Settings by the gear (a real tap, so its animation runs natively), then out by a tab, and again out by Back
calm; adb shell am start -a android.intent.action.VIEW -d "moneyrn://today" $PKG > /dev/null 2>&1; sleep 4
adb shell input tap 984 223; sleep 4; shot 13-settings-by-gear
adb shell input tap 270 2250; sleep 4; shot 14-tab-from-settings
adb shell input tap 984 223; sleep 4; adb shell input keyevent KEYCODE_BACK; sleep 4; shot 15-back-from-settings
# the widget at each size (the demo build's gallery)
calm; adb shell am start -a android.intent.action.VIEW -d "moneyrn://today?fx=widgets" $PKG > /dev/null 2>&1; sleep 6; shot 16-widgets
adb shell input swipe 540 1900 540 500 500; sleep 2; shot 17-widgets; adb shell input swipe 540 1900 540 500 500; sleep 2; shot 18-widgets
adb logcat -d > "$OUT/logcat-full.txt"
grep -E "ReactNativeJS|FATAL|AndroidRuntime|E ReactNative|Exception" "$OUT/logcat-full.txt" > "$OUT/logcat-app.txt" || true
if grep -A3 "FATAL EXCEPTION" "$OUT/logcat-full.txt" | grep -q "$PKG"; then
  echo "crashed" > "$OUT/result.txt"; grep -A25 "FATAL EXCEPTION" "$OUT/logcat-full.txt" | head -40; echo "::error::Money RN crashed"; exit 1
fi
if adb shell pidof $PKG > /dev/null; then echo "running" > "$OUT/result.txt"; else echo "NOT running" > "$OUT/result.txt"; echo "::error::Money RN isn't running"; exit 1; fi
cat "$OUT/result.txt"
