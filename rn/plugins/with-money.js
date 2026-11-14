// Money RN's own Android settings, applied when GitHub generates the android/ folder (expo prebuild):
//   - long-press shortcuts on the app icon: Add a payment, Cards (open moneyrn://… links the app understands)
//   - release signing from the GitHub secrets (the same key as the Money app), and a version that goes up every build
const { withAndroidManifest, withDangerousMod, withStringsXml, withAppBuildGradle, AndroidConfig } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PKG = "com.yashdobal.money.rn";
const BG = "#FF1E1E1E";

const circleIcon = (pathData) => `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><shape android:shape="oval"><solid android:color="${BG}" /><size android:width="48dp" android:height="48dp" /></shape></item>
    <item android:top="12dp" android:bottom="12dp" android:left="12dp" android:right="12dp">
        <vector android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
            <path android:pathData="${pathData}" android:strokeColor="#FFFFFFFF" android:strokeWidth="2.2" android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000" />
        </vector>
    </item>
</layer-list>
`;

const SHORTCUTS = `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
    <shortcut android:shortcutId="add" android:enabled="true" android:icon="@drawable/money_shortcut_add"
        android:shortcutShortLabel="@string/money_shortcut_add" android:shortcutLongLabel="@string/money_shortcut_add">
        <intent android:action="android.intent.action.VIEW" android:targetPackage="${PKG}"
            android:targetClass="${PKG}.MainActivity" android:data="moneyrn://today?sheet=add" />
    </shortcut>
    <shortcut android:shortcutId="cards" android:enabled="true" android:icon="@drawable/money_shortcut_cards"
        android:shortcutShortLabel="@string/money_shortcut_cards" android:shortcutLongLabel="@string/money_shortcut_cards_long">
        <intent android:action="android.intent.action.VIEW" android:targetPackage="${PKG}"
            android:targetClass="${PKG}.MainActivity" android:data="moneyrn://cards" />
    </shortcut>
</shortcuts>
`;

function withFiles(config) {
  return withDangerousMod(config, ["android", async (cfg) => {
    const res = path.join(cfg.modRequest.platformProjectRoot, "app/src/main/res");
    const put = (rel, text) => { const f = path.join(res, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
    put("xml/money_shortcuts.xml", SHORTCUTS);
    put("drawable/money_shortcut_add.xml", circleIcon("M12,5v14M5,12h14"));
    put("drawable/money_shortcut_cards.xml", circleIcon("M5.5,6.5h13a2,2 0,0 1,2 2v7a2,2 0,0 1,-2 2h-13a2,2 0,0 1,-2 -2v-7a2,2 0,0 1,2 -2zM3.5,10.5h17"));
    return cfg;
  }]);
}

function withManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    main["meta-data"] = (main["meta-data"] || []).filter((m) => m.$["android:name"] !== "android.app.shortcuts");
    main["meta-data"].push({ $: { "android:name": "android.app.shortcuts", "android:resource": "@xml/money_shortcuts" } });
    return cfg;
  });
}

function withStrings(config) {
  return withStringsXml(config, (cfg) => {
    const add = (name, value) => { cfg.modResults = AndroidConfig.Strings.setStringItem([{ $: { name, translatable: "false" }, _: value }], cfg.modResults); };
    add("money_shortcut_add", "Add a payment");
    add("money_shortcut_cards", "Cards");
    add("money_shortcut_cards_long", "Your cards and bills");
    return cfg;
  });
}

/* Signing: GitHub puts the keystore at $MONEY_KEYSTORE with its password in $MONEY_KEYSTORE_PASSWORD (the secrets
   ANDROID_KEYSTORE_B64 / ANDROID_KEYSTORE_PASSWORD). Without them (a local build) the release build stays unsigned
   by our key. versionCode = the GitHub run number, so every build installs over the last. */
function withSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes("MONEY_KEYSTORE")) return cfg;
    g = g.replace(/signingConfigs\s*\{/, `signingConfigs {
        money {
            if (System.getenv("MONEY_KEYSTORE")) {
                storeFile file(System.getenv("MONEY_KEYSTORE"))
                storePassword System.getenv("MONEY_KEYSTORE_PASSWORD")
                keyAlias System.getenv("MONEY_KEY_ALIAS") ?: "money"
                keyPassword System.getenv("MONEY_KEY_PASSWORD") ?: System.getenv("MONEY_KEYSTORE_PASSWORD")
            }
        }`);
    // the release build type signs with our key when it's there
    g = g.replace(/(release\s*\{[^{}]*?)signingConfig\s+signingConfigs\.debug/, (m, a) => a + 'signingConfig System.getenv("MONEY_KEYSTORE") ? signingConfigs.money : signingConfigs.debug');
    g = g.replace(/versionCode\s+\d+/, 'versionCode((System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInteger())');
    g = g.replace(/versionName\s+"[^"]*"/, 'versionName "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")');
    cfg.modResults.contents = g;
    return cfg;
  });
}

module.exports = (config) => withSigning(withStrings(withManifest(withFiles(config))));
