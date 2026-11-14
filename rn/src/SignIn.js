/* Sign in (app.css .si-wrap / .si-brand / .si-card, money-data.js showSignIn): a white card on the page colour, its top
   in the hero's graphite with the line art and the Money mark; "Your money, in one place"; your email; then "Check your
   email" and the 6-digit code from the email Supabase sends (the same account as the website). */
import React, { useEffect, useRef, useState } from "react";
import { Animated, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { sb, storage } from "./store";
import { useC, F, rgba } from "./theme";
import { T, Btn, buzz, useShake } from "./kit";
import { S, springTo, motionOn } from "./motion";
import { MARK } from "./mark.gen";
import RAnimated, { useSharedValue, useAnimatedStyle, useFrameCallback, withSpring } from "react-native-reanimated";
import { PanResponder } from "react-native";
import { rs } from "./motion";

/* ---------------- a fan of cards in 3D (choreo.js illo "cards"): it sways slowly; drag it to spin it ---------------- */
const TILT = -0.35, P = 700, ZOOM = 1.05;
const FAN = [0, 1, 2].map((i) => ({ z: (1 - i) * 14, y: (i - 1) * -6, rz: (i - 1) * 0.16 }));
function FanCard({ i, t, spin, color }) {
  const f = FAN[i];
  const st = useAnimatedStyle(() => {
    const th = Math.sin(t.value / 2600) * 0.45 + spin.value;
    const x = f.z * Math.sin(th), zr = f.z * Math.cos(th);
    const y = f.y * Math.cos(TILT) - zr * Math.sin(TILT), z = f.y * Math.sin(TILT) + zr * Math.cos(TILT);
    const k = (P / (P - z)) * ZOOM;
    return { transform: [{ translateX: x * k }, { translateY: y * k }, { perspective: P }, { rotateX: TILT + "rad" }, { rotateY: th + "rad" }, { rotateZ: f.rz + "rad" }, { scale: k }] };
  });
  return (
    <RAnimated.View style={[{ position: "absolute", left: 150 - 65, top: 100 - 43, width: 130, height: 86, borderRadius: 9, backgroundColor: color,
      shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4 }, st]}>
      <View style={{ position: "absolute", left: 65 - 36 - 9, top: 43 - 8 - 6.5, width: 18, height: 13, borderRadius: 3, backgroundColor: "#D8D8D4" }} />
      <View style={{ position: "absolute", left: 65 - 40, top: 43 + 20 - 1.5, width: 50, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.55)" }} />
    </RAnimated.View>
  );
}
function Coin3D({ t, face, back }) {
  const st = useAnimatedStyle(() => {
    const a = 0.6 + t.value / 900, c = Math.cos(a);
    return { backgroundColor: c >= 0 ? face : back, transform: [{ translateY: Math.sin(t.value / 700) * 2 }, { scaleX: Math.max(0.1, Math.abs(c)) }] };
  });
  return <RAnimated.View style={[{ position: "absolute", left: 150 + 56 * ZOOM - 17, top: 100 + 36 * ZOOM - 17, width: 34, height: 34, borderRadius: 17 }, st]} />;
}
function CardsIllo() {
  const C = useC();
  const t = useSharedValue(900), spin = useSharedValue(0);
  const on = motionOn();
  useFrameCallback((info) => { "worklet"; if (on) t.value = 900 + info.timeSinceFirstFrame; });
  const base = useRef(0);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { base.current = spin.value; },
    onPanResponderMove: (e, g) => { spin.value = base.current + g.dx / 70; },
    onPanResponderRelease: () => { spin.value = withSpring(0, rs(S.page)); },
  })).current;
  const colour = C.palette !== "minimal";
  const faces = colour ? [C.accent, "#3A3A37", "#8E8E89"] : ["#2A2A28", "#55554F", "#9C9C97"];
  return (
    <View {...pan.panHandlers} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 300, maxWidth: "100%", height: 200, alignSelf: "center", marginTop: -6, marginBottom: 6 }}>
      {[2, 1, 0].map((i) => <FanCard key={i} i={i} t={t} spin={spin} color={faces[i]} />)}
      <Coin3D t={t} face={colour ? C.accent : "#D9D4C7"} back="#B8B2A4" />
    </View>
  );
}

const ROSE = [[100, 37, 64, 0.55, 1], [92, 29, 52, 0.4, 0.7], [84, 41, 40, 0.4, 0.55]].map(([R, r, d, w, o]) => {
  let p = "";
  for (let i = 0; i <= 900; i++) {
    const t = (i / 900) * Math.PI * 2 * r;
    p += (i ? "L" : "M") + ((R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t)).toFixed(1) + " " + ((R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)).toFixed(1);
  }
  return { p, w, o };
});

/** .si-wrap.si-brand .si-card: the card, centred on the page, rising in. */
export function Card({ children }) {
  const C = useC();
  const insets = useSafeAreaInsets();
  const v = useRef(new Animated.Value(motionOn() ? 0 : 1)).current;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (motionOn()) springTo(v, 1, S.sheet, { delay: 60 }).start();
    if (motionOn()) Animated.loop(Animated.timing(spin, { toValue: 1, duration: 90000, easing: (t) => t, useNativeDriver: Platform.OS !== "web" })).start();
  }, []);
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.ground }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <Animated.View style={{ width: "100%", maxWidth: 420, borderRadius: 28, overflow: "hidden", backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
          paddingTop: 150, paddingHorizontal: 24, paddingBottom: 24, shadowColor: "#16182E", shadowOpacity: C.dark ? 0.6 : 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 6,
          opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] }}>
          {/* the graphite top: the hero's colours, a soft light in the corner */}
          <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 126 }}>
            <Svg width="100%" height="126">
              <Defs>
                <LinearGradient id="sib" x1="0" y1="0" x2="0.35" y2="1"><Stop offset="0" stopColor={C.heroA} /><Stop offset="1" stopColor={C.heroB} /></LinearGradient>
                <RadialGradient id="sig" cx="100%" cy="0%" rx="120%" ry="90%"><Stop offset="0" stopColor="#7882FF" stopOpacity={C.palette === "minimal" ? 0 : 0.28} /><Stop offset="0.55" stopColor="#7882FF" stopOpacity={0} /></RadialGradient>
              </Defs>
              <Rect width="100%" height="126" fill="url(#sib)" /><Rect width="100%" height="126" fill="url(#sig)" />
            </Svg>
          </View>
          <Animated.View pointerEvents="none" style={{ position: "absolute", right: -50, top: -104, width: 230, height: 230, opacity: 0.3, transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>
            <Svg width={230} height={230} viewBox="-110 -110 220 220">{ROSE.map((r, i) => <Path key={i} d={r.p} fill="none" stroke="#B9C1FF" strokeWidth={r.w} opacity={r.o} />)}</Svg>
          </Animated.View>
          <View style={{ position: "absolute", top: 24, left: 24, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" }}>
              <Svg width={19} height={19} viewBox="-60 -60 120 120"><Path d={MARK} fill="none" stroke="#FFFFFF" strokeWidth={7} strokeLinejoin="round" /></Svg>
            </View>
            <T f={F.bold} s={20} lh={24} c="#F3F5FF">Money</T>
          </View>
          {children}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** .si-wrap input: 50 tall, 12 px corners, inset grey; focused, it turns white with an accent ring. */
function Input({ code, shake, ...p }) {
  const C = useC();
  const [focus, setFocus] = useState(false);
  return (
    <Animated.View style={[{ borderRadius: 16, padding: 4, margin: -4, backgroundColor: focus ? rgba(C.accent, C.dark ? 0.25 : 0.12) : "transparent" }, shake]}>
      <TextInput {...p} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholderTextColor={C.ink3} selectionColor={C.accent}
        style={{ minHeight: 50, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: focus ? C.accent : "transparent", backgroundColor: focus ? C.surface : C.inset, color: C.ink,
          fontFamily: code ? F.medium : F.body, fontSize: code ? 24 : 15, letterSpacing: code ? 11.7 : -0.18, textAlign: code ? "center" : "left", paddingLeft: code ? 14 + 11.7 : 14 }} />
    </Animated.View>
  );
}

export default function SignIn() {
  const C = useC();
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState(storage.getItem("money-email") || "");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const timer = useRef(null);
  const [shake, doShake] = useShake();
  useEffect(() => () => clearInterval(timer.current), []);
  const startWait = () => { setLeft(60); clearInterval(timer.current); timer.current = setInterval(() => setLeft((n) => { if (n <= 1) clearInterval(timer.current); return n - 1; }), 1000); };
  const send = async () => {
    const e = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setMsg("Enter the email you signed up with."); doShake(); return; }
    setBusy(true); setMsg("Sending…");
    const { error } = await sb.auth.signInWithOtp({ email: e, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) { setMsg(/rate|seconds|too many/i.test(error.message) ? "Too many emails for now. Wait a minute and try again." : "That didn't work: " + error.message); return; }
    storage.setItem("money-email", e);
    setMsg(""); setStep("code"); setCode(""); startWait();
  };
  const verify = async (c) => {
    setBusy(true); setMsg("Checking…");
    const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: c, type: "email" });
    setBusy(false);
    if (error) { doShake(); setMsg(/expired|invalid/i.test(error.message) ? "That code didn't work. Check the newest email, or send again." : "That didn't work: " + error.message); setCode(""); }
    else { buzz("confirm"); setMsg(""); }
  };
  const masked = email.trim().replace(/^(.)(.*)(@.*)$/, (m, a, mid, d) => a + "•".repeat(Math.min(6, mid.length)) + d);
  const H = (t) => <T f={F.title} s={25} lh={31} style={{ marginBottom: 8 }} accessibilityRole="header">{t}</T>;
  const P = (t) => <T s={15} lh={21} c={C.ink2} style={{ marginBottom: 18 }}>{t}</T>;
  return (
    <Card>
      {step === "email" ? (
        <View>
          <CardsIllo />
          {H("Your money, in one place")}
          {P("Card bills, your salary plan and what's safe to spend today.")}
          <Input shake={shake} accessibilityLabel="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email"
            onSubmitEditing={send} returnKeyType="send" />
          <Btn big full label={busy ? "Sending…" : "Email me a sign-in code"} disabled={busy} onPress={send} style={{ marginTop: 12 }} />
        </View>
      ) : (
        <View>
          {H("Check your email")}
          {P("We sent a 6-digit code to " + masked + ". Type it here.")}
          <Input code shake={shake} accessibilityLabel="6-digit code" value={code} placeholder="••••••" keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} autoFocus editable={!busy}
            onChangeText={(t) => { const c = t.replace(/\D/g, "").slice(0, 6); setCode(c); if (c.length === 6) verify(c); }} />
          <Btn big full kind="ghost" icon="mail" label="Open email" style={{ marginTop: 12 }}
            onPress={() => Linking.openURL(Platform.OS === "android" ? "https://mail.google.com/mail/u/0/#inbox" : "message://").catch(() => {})} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 16 }}>
            <Btn kind="link" small disabled={left > 0 || busy} label={left > 0 ? "Send again in " + left + "s" : "Send again"} onPress={send} />
            <Btn kind="link" small label="Use a different email" onPress={() => { setStep("email"); setMsg(""); }} />
          </View>
        </View>
      )}
      <T s={14} lh={19} c={C.ink2} style={{ textAlign: "center", marginTop: 12, minHeight: 19 }}>{msg}</T>
    </Card>
  );
}
