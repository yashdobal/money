/* The 4-digit code: the lock for a browser (native/lock.web.js keeps and checks it; the phone app uses the fingerprint).
     PinPad    four dots and a keypad (the keyboard's digits and Backspace work too)
     PinLock   the locked screen: enter the code, or sign in another way
     PinSheet  Settings → App lock code: set it, change it or turn it off */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, View } from "react-native";
import { useC, F } from "./theme";
import { T, Btn, Press, Note, buzz, useShake } from "./kit";
import { Icon } from "./icons";
import { Card } from "./SignIn";
import * as Lock from "./native/lock";
import { signOut, toast } from "./store";
import { closeSheet } from "./nav";

/** onCode(code) runs at the fourth digit; it returns a line to show when the code is wrong (the dots shake and clear). */
export function PinPad({ onCode, hint, off }) {
  const C = useC();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [shake, go] = useShake();
  const busy = useRef(false), cur = useRef("");
  cur.current = code;
  const press = async (k) => {
    if (busy.current || off) return;
    if (k === "del") { setCode(cur.current.slice(0, -1)); return; }
    const next = (cur.current + k).slice(0, 4);
    setCode(next); setMsg("");
    if (next.length < 4) return;
    busy.current = true;
    const wrong = await onCode(next);
    busy.current = false;
    if (wrong) { setMsg(wrong); go(); setTimeout(() => setCode(""), 260); } else setCode("");
  };
  const fn = useRef(press); fn.current = press;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const h = (e) => { if (/^\d$/.test(e.key)) { fn.current(e.key); e.preventDefault(); } else if (e.key === "Backspace") { fn.current("del"); e.preventDefault(); } };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);
  const key = (k, i) => (k === "" ? <View key={i} style={{ width: 68, height: 60 }} /> : (
    <Press key={i} onPress={() => { buzz("tick"); press(k); }} scale={0.9} haptic={false} accessibilityLabel={k === "del" ? "Delete" : k}
      style={{ width: 68, height: 60, borderRadius: 20, backgroundColor: k === "del" ? "transparent" : C.inset, alignItems: "center", justifyContent: "center" }}>
      {k === "del" ? <Icon name="back" size={22} color={C.ink2} /> : <T f={F.tile} s={22} lh={28}>{k}</T>}
    </Press>
  ));
  return (
    <View style={{ alignItems: "center" }}>
      <Animated.View accessibilityLabel={code.length + " of 4 digits entered"} style={[{ flexDirection: "row", gap: 14, marginTop: 6, marginBottom: 10 }, shake]}>
        {[0, 1, 2, 3].map((i) => <View key={i} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: i < code.length ? C.accent : "transparent", borderWidth: 1.5, borderColor: i < code.length ? C.accent : C.line2 }} />)}
      </Animated.View>
      <T s={13.5} lh={19} c={msg ? C.alert : C.ink3} style={{ textAlign: "center", minHeight: 38, marginBottom: 6 }} accessibilityLiveRegion="polite">{msg || hint || ""}</T>
      {off ? null : (
        <View style={{ gap: 8 }}>
          {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "del"]].map((row, r) => <View key={r} style={{ flexDirection: "row", gap: 12 }}>{row.map(key)}</View>)}
        </View>
      )}
    </View>
  );
}

/** Locked (a browser): the sign-in card's look, with the code before anything shows. */
export function PinLock({ onOpen }) {
  const [off, setOff] = useState(false);
  const check = async (code) => {
    const r = await Lock.checkPin(code);
    if (r.ok) { buzz("confirm"); onOpen(); return ""; }
    if (r.off) { setOff(true); setTimeout(() => signOut(), 2600); return "Too many wrong codes, so the code is now off on this device. Signing you out…"; }
    return "Wrong code. " + r.left + (r.left === 1 ? " try" : " tries") + " left.";
  };
  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 80 }}>
      <Card>
        <T f={F.title} s={25} lh={31} style={{ marginBottom: 4, textAlign: "center" }} accessibilityRole="header">Money is locked</T>
        <PinPad onCode={check} hint="Enter your code." off={off} />
        <View style={{ alignItems: "center", marginTop: 10 }}><Btn kind="link" label="Sign in another way" onPress={() => { Lock.clearPin(); signOut(); }} /></View>
      </Card>
    </View>
  );
}

/** Settings → App lock code. */
export function PinSheet() {
  const had = useRef(Lock.hasPin()).current;
  const [step, setStep] = useState(had ? "cur" : "new");
  const first = useRef("");
  const done = (m) => { buzz("confirm"); toast(m); closeSheet(); };
  const onCode = async (code) => {
    if (step === "cur") {
      const r = await Lock.checkPin(code);
      if (r.ok) { setStep("new"); return ""; }
      if (r.off) { setTimeout(() => signOut(), 2600); return "Too many wrong codes, so the code is now off on this device. Signing you out…"; }
      return "Wrong code. " + r.left + (r.left === 1 ? " try" : " tries") + " left.";
    }
    if (step === "new") {
      if (Lock.obviousPin(code)) return "Too easy to guess. Try another.";
      first.current = code; setStep("again"); return "";
    }
    if (code !== first.current) { setStep("new"); return "Those didn't match. Choose a code."; }
    await Lock.setPin(code);
    done(had ? "Your code is changed" : "App lock code is on");
    return "";
  };
  const hint = step === "cur" ? "Enter your current code." : step === "new" ? (had ? "Choose a new 4-digit code." : "Choose a 4-digit code.") : "Enter it again.";
  return (
    <View>
      <Note s={14.5}>A quick unlock for this browser, like a phone PIN. Money asks for it when you come back after being away. It is kept only on this device; five wrong tries turn it off and sign you out.</Note>
      <PinPad key={step} onCode={onCode} hint={hint} />
      {had && step !== "cur" ? <View style={{ alignItems: "center", marginTop: 12 }}><Btn kind="ghost" danger label="Turn the code off" onPress={() => { Lock.clearPin(); done("App lock code is off"); }} /></View> : null}
    </View>
  );
}
