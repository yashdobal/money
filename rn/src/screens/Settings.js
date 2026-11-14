/* Settings (app.css .set-h / .set-list / .set-row): security, appearance, alerts and SMS, your data, sync, account. */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Share, View, useColorScheme } from "react-native";
import Constants from "expo-constants";
import { E, pref, email, signOut, toast, MONEY } from "../store";
import { openSheet } from "../nav";
import { useC, F, PALETTES, swatch } from "../theme";
import { T, Press, Switch, Seg, Rise, TrayCtx, cardLook, money, plural, buzz, Page } from "../kit";
import { Bob } from "../alive";
import { Icon } from "../icons";
import { S, springTo, motionOn } from "../motion";
import * as Lock from "../native/lock";
import * as Alerts from "../native/alerts";
import * as Sms from "../native/sms";
import { WEB, inApp, call, saveFile } from "../host";

function Group({ title, children, i }) {
  const C = useC();
  const kids = React.Children.toArray(children).filter(Boolean);
  return (
    <Rise i={i} first>
      <T f={F.semi} s={14} lh={19} c={C.ink2} style={{ marginTop: 6, marginHorizontal: 6, marginBottom: 8 }}>{title}</T>
      <View style={{ backgroundColor: C.tray, borderRadius: 22, padding: 8, gap: 6, marginBottom: 16 }}>
        {kids.map((k, j) => React.cloneElement(k, { k: j }))}
      </View>
    </Rise>
  );
}
/** .set-row: a white card in its group's tray: an icon (it bobs, in turn down the group), a title and a line, then a
    switch, a chevron or nothing. */
function SetRow({ icon, title, detail, right, onPress, danger, k = 0, children }) {
  const C = useC();
  const inner = (
    <TrayCtx.Provider value="w">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 60, paddingVertical: 10, paddingHorizontal: 14 }}>
        <Bob k={k} on={k < 6}><Icon name={icon} size={20} color={danger ? C.alert : C.ink2} /></Bob>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T f={F.medium} s={14.5} lh={19} c={danger ? C.alert : C.ink}>{title}</T>
          {detail ? <T s={12.5} lh={17} c={C.ink3}>{detail}</T> : null}
        </View>
        {right !== undefined ? right : onPress ? <Icon name="chev" size={18} color={C.ink3} /> : null}
      </View>
      {children}
    </TrayCtx.Provider>
  );
  return onPress ? <Press onPress={onPress} scale={0.985} wash style={cardLook(C)}>{inner}</Press> : <View style={cardLook(C)}>{inner}</View>;
}

export default function Settings() {
  const C = useC();
  const sys = useColorScheme();
  const [lock, setLock] = useState(Lock.info());
  const [notif, setNotif] = useState(null);
  const [smsOn, setSmsOn] = useState(Sms.enabled());
  const refresh = () => { setLock(Lock.info()); Alerts.state().then(setNotif); setSmsOn(Sms.enabled()); };
  useEffect(() => { refresh(); Lock.available().then(() => setLock(Lock.info())); }, []);
  const theme = pref.get("theme", "auto"), palette = pref.get("palette", "signal"), dark = theme === "dark" || (theme === "auto" && sys === "dark");
  const rules = Object.keys(E.catRules).length;
  const bb = E.bankBalance();
  const nOn = notif && notif.permission === "granted";
  const sysNote = palette !== "system" ? "" : swatch("system", dark) ? "Using your phone's Material You colours; they follow your wallpaper." : "Your phone shares its colours from Android 12; until then this is a soft indigo.";
  const ver = "Money " + String(E.APP_VERSION).split(" · ")[0] + (WEB ? (inApp ? " · Android app " + (call("version") || "") : " · website")
    : " · Money RN " + ((Constants.expoConfig && Constants.expoConfig.version) || ""));
  return (
    <Page id="settings">
      {Lock.kind === "pin" ? (
        /* a browser: the 4-digit code */
        <Group title="Security" i={0}>
          <SetRow icon="lock" title="App lock code" detail={lock.enabled ? "on · tap to change it or turn it off" : "a 4-digit code, asked when you come back after being away"} onPress={() => openSheet("pin")}>
            {lock.enabled ? (
              <View style={{ paddingLeft: 48, paddingRight: 14, paddingBottom: 12, gap: 8 }}>
                <T s={13.5} c={C.ink2}>Lock after</T>
                <Seg value={String(lock.after)} onChange={(v) => { Lock.setAfter(Number(v)); refresh(); }} options={[["0", "Right away"], ["60", "1 min"], ["300", "5 min"]]} label="Lock after" />
              </View>
            ) : null}
          </SetRow>
        </Group>
      ) : (
        <Group title="Security" i={0}>
        <SetRow icon="finger" title="Fingerprint lock" detail={lock.available ? "fingerprint or phone PIN; also asked before you change a balance or sign out" : "set a screen lock on the phone first"}
          onPress={lock.available ? undefined : () => Alerts.openSecuritySettings()}
          right={lock.available ? <Switch value={lock.enabled} label="Fingerprint lock" onChange={async (on) => { const r = await Lock.setEnabled(on); toast(r.ok ? (on ? "Fingerprint lock is on" : "Fingerprint lock is off") : r.message || "Not changed", r.ok ? {} : { tone: "warn" }); refresh(); }} /> : undefined}>
          {lock.available && lock.enabled ? (
            <View style={{ paddingLeft: 48, paddingRight: 14, paddingBottom: 12, gap: 8 }}>
              <T s={13.5} c={C.ink2}>Lock after</T>
              <Seg value={String(lock.after)} onChange={(v) => { Lock.setAfter(Number(v)); refresh(); }} options={[["0", "Right away"], ["60", "1 min"], ["300", "5 min"]]} label="Lock after" />
            </View>
          ) : null}
        </SetRow>
        <SetRow icon="eyeOff" title="Hide in recent apps" detail="also blocks screenshots"
          right={<Switch value={lock.hideRecents} label="Hide in recent apps" onChange={(on) => { Lock.setHideRecents(on); if (on) toast("Hidden in recent apps. Screenshots of Money are blocked too."); refresh(); }} />} />
      </Group>
      )}

      <Group title="Appearance" i={1}>
        <SetRow icon="palette" title="Theme" right={<Seg value={theme} onChange={(v) => pref.set("theme", v)} options={[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]]} label="Theme" />} />
        <SetRow icon="palette" title="Colours" detail={sysNote || null} right={null}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingLeft: 48, paddingRight: 14, paddingBottom: 14, marginTop: -4 }}>
            {PALETTES.map(([k, l]) => <PalChip key={k} k={k} label={l} on={palette === k} dark={dark} />)}
          </View>
        </SetRow>
        <SetRow icon="spark" title="Motion effects" detail="every card keeps moving; off saves battery"
          right={<Switch value={pref.get("fx", "1") !== "0"} label="Motion effects" onChange={(on) => pref.set("fx", on ? null : "0")} />} />
        <SetRow icon="eyeOff" title="Hide amounts" detail="shows dots in place of every amount until you tap the eye"
          right={<Switch value={pref.get("hide", "0") === "1"} label="Hide amounts" onChange={(on) => { pref.set("hide", on ? "1" : null); require("../native/widget").pushWidget(true); }} />} />
        {/* a laptop's browser can't vibrate */}
        {WEB && !inApp && !(typeof navigator !== "undefined" && navigator.vibrate) ? null :
        <SetRow icon="phone" title="Vibrate on taps" detail="a small tick when you press things"
          right={<Switch value={pref.get("haptics", "1") !== "0"} label="Vibrate on taps" onChange={(on) => pref.set("haptics", on ? null : "0")} />} />}
      </Group>

      <Group title="Alerts" i={2}>
        <SetRow icon="bell" title={nOn ? "Send a test alert" : WEB && !inApp ? "Alerts in this browser" : "Alerts on this phone"} onPress={async () => { const r = await Alerts.test(); Alerts.say(r); refresh(); }}
          detail={!notif ? "checking…" : nOn ? (notif.muted ? "muted in phone settings · tap to fix" : "on · bills, EMIs, salary, a 9 PM summary") : notif.permission === "none" ? "this browser can't receive them" : notif.permission === "blocked" ? "blocked · tap to allow" : "off · tap to turn on"} />
        {WEB ? null : <SetRow icon="mail" title="Read bank SMS" detail={smsOn ? "payments show the moment the SMS arrives" : "show payments straight from your bank's SMS, before the email"}
          right={<Switch value={smsOn} label="Read bank SMS" onChange={async (on) => { const r = await Sms.setEnabled(on); if (r) toast(r); refresh(); }} />} />}
        {Platform.OS === "android" ? (
          <SetRow icon="spark" title={Sms.trialStart() ? "SMS first · day " + Sms.trialDay() + " of 7" : Sms.counting() ? "SMS first is on" : "Try SMS first for a week"}
            detail={Sms.trialStart() ? (Sms.trialDone() ? "the week is done: see how it went" : "SMS payments count the moment they arrive; email checks them · tap for the scorecard")
              : Sms.counting() ? "kept on after the trial · tap for the scorecard" : "payments count the moment the SMS arrives; email keeps running so the app can compare the two"}
            onPress={async () => { if (Sms.trialStart() || Sms.counting()) openSheet("sms-trial"); else { const r = await Sms.startTrial(); if (r) toast(r); refresh(); } }} />
        ) : null}
        {WEB && !inApp ? null : <SetRow icon="phone" title="Alert sound and vibration" detail={WEB ? "Android's settings for Money" : "Android's settings for Money RN"} onPress={() => Alerts.openSettings()} />}
        {inApp ? <SetRow icon="mail" title="Sign-in links" detail={{ verified: "open in this app", selected: "open in this app", none: "open in the browser · tap to fix" }[notif && notif.links] || "choose where they open"} onPress={() => Alerts.openLinkSettings()} /> : null}
        {WEB ? null : <SetRow icon="spark" title="Add the widget to your home screen" detail="resize it from a 1×1 square to 5×4; it lays itself out to fit"
          onPress={async () => { const ok = await require("../native/widget").pinWidget(); toast(ok ? "Your home screen will ask to place it" : "Add it from your home screen: long-press, Widgets, Money RN"); }} />}
      </Group>

      <Group title="Your data" i={3}>
        <SetRow icon="download" title="Export to CSV" detail={plural(E.TX.length + E.manual.length, "transaction") + ", for a spreadsheet"}
          onPress={() => {
            const name = "money-" + E.iso(new Date()) + ".csv";
            if (WEB) { const r = saveFile(name, "\ufeff" + E.csvText(), "text/csv"); toast(r === "shared" ? "Ready to share" : r ? "Saved to your downloads" : "Couldn't save the file", r ? {} : { tone: "warn" }); }
            else Share.share({ title: name, message: E.csvText() }).catch(() => {});
          }} />
        <SetRow icon="mail" title="Read emails now" detail="ask the collector to check Gmail" onPress={() => { toast("Asking the collector to check Gmail…"); E.act.refresh(); }} />
        <SetRow icon="rule" title="Saved payee rules" detail={rules ? plural(rules, "rule") : "none yet"} onPress={() => openSheet("rules")} />
        <SetRow icon="card" title="Your banks and cards" detail={E.BANKS.length || Object.keys(E.GROUPS).length ? plural(E.BANKS.length, "bank") + " · " + plural(Object.keys(E.GROUPS).length, "card account") : "not set yet"} onPress={() => openSheet("setup")} />
        <SetRow icon="bank" title="Bank balances" detail={bb ? bb.parts.map((p) => p.name + (p.set ? " " + money(p.bal) : " not set")).join(" · ") : E.BANKS.length ? E.bankNames() + ", not set yet" : "add your banks first"} onPress={() => openSheet(E.BANKS.length ? "balance" : "setup")} />
        <SetRow icon="salary" title="Salary & fixed payments" detail="offer letter, your split, EMIs" onPress={() => openSheet("salary")} />
      </Group>

      <Group title="Sync" i={4}>
        <SetRow icon="cloud" title="Emails last read" detail={E.lastRun ? E.ago(E.lastRun) + " · " + new Date(E.lastRun).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "not yet"} />
        <SetRow icon="db" title="Database" detail={E.NOTES_OK ? "up to date" : MONEY.notesChecked ? "one update is needed for notes and payee rules" : "checking…"} />
        <SetRow icon="refresh" title="Last saved" detail={require("../store").offline.waiting() ? "waiting to sync: it'll send as soon as you're online" : E.SAVE_MSG || "nothing changed yet"} />
      </Group>

      <Group title="Account" i={5}>
        <SetRow icon="user" title={email() || "Signed in"} detail={ver} />
        <SetRow icon="out" title="Sign out" danger onPress={async () => { if (!(await Lock.guard("Sign out of Money"))) return; toast("Signing out…"); signOut(); }} />
      </Group>
    </Page>
  );
}

/** .pal: a colour chip (swatch and name); the chosen one is ink with a ring. */
function PalChip({ k, label, on, dark }) {
  const C = useC();
  const c = swatch(k, dark);
  const pop = useRef(new Animated.Value(1)).current;
  return (
    <Press onPress={() => { pref.set("palette", k); if (motionOn()) { pop.setValue(0.9); springTo(pop, 1, S.pop).start(); } }} scale={0.95} accessibilityRole="radio" accessibilityLabel={label}>
      <Animated.View style={{ transform: [{ scale: pop }], flexDirection: "row", alignItems: "center", gap: 7, minHeight: 36, paddingLeft: 8, paddingRight: 12, borderRadius: 18, backgroundColor: on ? C.ink : C.inset }}>
        <View style={{ width: 18, height: 18, borderRadius: 9, overflow: "hidden", borderWidth: on ? 2 : 0, borderColor: C.surface, flexDirection: "row", flexWrap: "wrap" }}>
          {c ? <View style={{ width: "100%", height: "100%", backgroundColor: c }} /> : ["#C2588F", "#D49E25", "#2E6B4E", "#1F5F8B"].map((x) => <View key={x} style={{ width: "50%", height: "50%", backgroundColor: x }} />)}
        </View>
        <T f={F.medium} s={13} lh={18} c={on ? C.surface : C.ink2}>{label}</T>
      </Animated.View>
    </Press>
  );
}
