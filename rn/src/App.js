/* Money RN · the app frame, exactly as the Money app draws it (app/app.css "The frame", app/motion.js):
   the app bar (27 px title, the feed line, round glass buttons), the five screens, the floating glass dock with its
   liquid selection, the Add button, toasts that drip out of the dock, Settings zooming out of the gear, the screen
   stepping back while a sheet is up, the fingerprint lock, and links in (shortcuts, the widget, alerts, the tile).
   Native extras: swipe left and right between screens, drag along the dock, haptics matched to each gesture. */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState, BackHandler, Dimensions, Easing, Linking, PanResponder, Platform, Pressable, RefreshControl, ScrollView, StatusBar, View, useColorScheme } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import * as Font from "expo-font";
import * as SystemUI from "expo-system-ui";
import * as Notifications from "expo-notifications";
import { E, ui, pref, preload, readSession, session, startEngine, registerDevice, useTick, dataVer } from "./store";
import { nav, TABS, go, back, openSheet, closeSheet, openLink, firstView } from "./nav";
import { ThemeCtx, tokens, useC, F, FONT_FILES, rgba } from "./theme";
import { T, Btn, Press, buzz, hidden, useWide } from "./kit";
import { Icon, TabIcon, EyeIcon } from "./icons";
import { GestureHandlerRootView, Gesture, GestureDetector } from "react-native-gesture-handler";
import RAnimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay, runOnJS, Easing as REasing } from "react-native-reanimated";
import { BlurView, BlurTargetView } from "expo-blur";
import { BurstLayer } from "./gl";
import { setLive } from "./live";
import { WEB, inApp, chrome } from "./host";
import { PinLock } from "./pin";
import { PaneCtx, Ping, Turn } from "./alive";
import { S, OUT, EASE_OUT, springTo, timeTo, motionOn, NATIVE, rs, screenShown } from "./motion";
import { Dialog } from "./form";
import SheetHost, { sheetLevel } from "./sheet";
import ToastHost from "./toast";
import SignIn, { Card } from "./SignIn";
import Today from "./screens/Today";
import Plan from "./screens/Plan";
import Cards from "./screens/Cards";
import Spend from "./screens/Spend";
import Activity from "./screens/Activity";
import Trips from "./screens/Trips";
import Rewards from "./screens/Rewards";
import Settings from "./screens/Settings";
import * as Lock from "./native/lock";
import * as Alerts from "./native/alerts";
import * as Sms from "./native/sms";
import { pushWidget, WidgetGallery } from "./native/widget";
import { schedule } from "./native/background";

const SCREENS = { today: Today, plan: Plan, cards: Cards, spend: Spend, activity: Activity, trips: Trips, rewards: Rewards, settings: Settings };
const TITLES = { today: "Today", plan: "Plan", cards: "Cards", spend: "Spending", activity: "Activity", trips: "Trips", rewards: "Rewards", settings: "Settings" };
const IDS = TABS.map((t) => t.id);

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await Promise.all([preload(), Font.loadAsync(FONT_FILES).catch(() => {})]);
      firstView();
      Alerts.setup();
      await Lock.available();
      Lock.applySecure();
      await readSession();
      setReady(true);
    })();
  }, []);
  useTick();
  const sys = useColorScheme();
  const t = pref.get("theme", "auto"), dark = t === "dark" || (t === "auto" && sys === "dark");
  const palette = pref.get("palette", "signal");
  const [wall, setWall] = useState(0);        // a new wallpaper changes the phone's colours: pick them up when you come back
  useEffect(() => { const s = AppState.addEventListener("change", (st) => { if (st === "active") setWall((n) => n + 1); }); return () => s.remove(); }, []);
  const C = useMemo(() => tokens(palette, dark), [palette, dark, wall]);
  useEffect(() => { if (WEB) chrome(C); else SystemUI.setBackgroundColorAsync(C.ground).catch(() => {}); }, [C]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <ThemeCtx.Provider value={C}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} backgroundColor="transparent" translucent />
        {!ready ? <View style={{ flex: 1, backgroundColor: C.ground }} /> : session.current ? <Main /> : <SignIn />}
      </ThemeCtx.Provider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Keeps a screen mounted but frozen while it's hidden: no re-renders until it shows again (the trick
    react-freeze uses: a Suspense boundary held in its fallback, which hides the screen without unmounting it). */
const NEVER = new Promise(() => {});
function Suspender({ freeze, children }) { if (freeze) throw NEVER; return children; }
function Freeze({ freeze, children }) { return <React.Suspense fallback={null}><Suspender freeze={freeze}>{children}</Suspender></React.Suspense>; }
const onReselect = { fn: null };
const tapAt = { t: 0 };   // when a tab was touched, to log how long the switch took (the emulator check reads it)

/** One screen in its own scroll view (so each keeps its place), with pull to refresh. */
/* memo: a screen that's already drawn is shown as it is, unless your data or settings changed (ver) or it was opened
   with different details (params) since it last drew */
const Pane = React.memo(function Pane({ v, first, loading, barH, insets, onScroll, register, onShown, ver, params, wide }) {
  const C = useC();
  const ref = useRef(null);
  const firstAtMount = useRef(first).current;
  useEffect(() => { register(ref.current); onShown(); }, []);
  const Screen = SCREENS[v] || Today;
  return (
    <ScrollView ref={ref} onScroll={(e) => onScroll(v, e)} scrollEventThrottle={16} keyboardShouldPersistTaps="handled"
      contentContainerStyle={wide ? { paddingHorizontal: 28, paddingTop: barH + 10, paddingBottom: 48 + (v === "activity" ? 70 : 0), maxWidth: 1136, width: "100%", alignSelf: "center" }
        : { paddingHorizontal: 16, paddingTop: barH + 8, paddingBottom: 64 + 10 + insets.bottom + 26 + (v === "activity" ? 70 : 0) }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => { buzz("heavy"); Sms.scan(); E.act.refresh(); }} colors={[C.accent]} tintColor={C.accent} progressBackgroundColor={C.glassStrong} progressViewOffset={barH} />}>
      {E.BANNER ? (
        <View style={{ backgroundColor: C.warnSoft, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <View style={{ flex: 1 }}>
            <T f={F.semi} s={14.5} c={C.warn}>{E.BANNER.title}</T>
            <T s={13} lh={17} c={C.ink2} lines={2}>{E.BANNER.text}</T>
          </View>
          <Btn kind="link" label="Try again" onPress={() => E.load()} />
        </View>
      ) : null}
      <PaneCtx.Provider value={v}>{loading ? <Skeleton /> : <Screen first={firstAtMount} scrollTo={(y) => ref.current && ref.current.scrollTo({ y, animated: true })} />}</PaneCtx.Provider>
    </ScrollView>
  );
});

function Main() {
  useTick();
  const C = useC();
  const insets = useSafeAreaInsets();
  const wide = useWide();                              // a laptop: a sidebar for the dock, two columns of blocks
  const wideRef = useRef(wide); wideRef.current = wide;
  const [locked, setLockedSt] = useState(Lock.startsLocked());
  const setLocked = (on) => { Lock.held.on = !!on; setLockedSt(!!on); };
  const [offer, setOffer] = useState(false);
  const away = useRef(0);
  const [barH, setBarH] = useState(insets.top + 64);
  const [scrolled, setScrolled] = useState(false);
  const compact = useRef(new Animated.Value(0)).current, compactOn = useRef(false), acc = useRef(0), y0 = useRef(0);
  /* signed in: start, the device key for background work, links in */
  useEffect(() => {
    startEngine();
    Sms.scan();
    setTimeout(async () => {
      if (await registerDevice()) schedule();
      if (process.env.EXPO_PUBLIC_MONEY_DEMO !== "1" && pref.get("alertsOffered", "0") !== "1" && (await Alerts.state()).permission === "ask") setOffer(true);
    }, 1500);
    Linking.getInitialURL().then((u) => u && openLink(u)).catch(() => {});
    const l = Linking.addEventListener("url", (e) => openLink(e.url));
    const n = Platform.OS !== "web" ? Notifications.addNotificationResponseReceivedListener((r) => Alerts.respond(r)) : null;
    if (Platform.OS !== "web") Notifications.getLastNotificationResponseAsync().then((r) => { if (r) { Alerts.respond(r); Notifications.clearLastNotificationResponseAsync().catch(() => {}); } }).catch(() => {});
    const b = BackHandler.addEventListener("hardwareBackPress", () => back());
    return () => { l.remove(); n && n.remove(); b.remove(); };
  }, []);
  /* the lock: after the time you chose away from the app */
  useEffect(() => {
    const s = AppState.addEventListener("change", (st) => {
      if (Lock.busy.on || Date.now() < Lock.busy.until) return;
      if (st !== "active") { away.current = away.current || Date.now(); return; }
      const L = Lock.info(), gone = away.current ? Date.now() - away.current : 0;
      away.current = 0;
      // (inside the Android app the app's own lock stands in front of the page, so the page never locks itself)
      if (Lock.kind !== "app" && L.enabled && gone >= L.after * 1000) { closeSheet(); setLocked(true); }
      Sms.scan();
      pushWidget();
    });
    return () => s.remove();
  }, []);
  useEffect(() => { pushWidget(); }, [E.DATA_IN, E.TX.length, E.manual.length, ui.busy, hidden()]);

  /* the screens. Each one stays mounted once you've been there (frozen while hidden: no re-renders, its scroll kept),
     so switching is just showing it; the tabs you haven't opened yet are built quietly in the background after
     launch. Tabs swap with a short fade; Settings zooms out of the gear and back into it. */
  const view = nav.view;
  const [mounted, setMounted] = useState(() => [view]);
  const settled = useRef({});
  useEffect(() => { if (!mounted.includes(view)) setMounted((m) => m.concat([view])); setLive(view); screenShown(); }, [view]);
  useEffect(() => {
    if (!E.DATA_IN) return;
    const todo = IDS.concat(["settings"]).filter((v) => !mounted.includes(v));
    if (!todo.length) return;
    const t = setTimeout(() => setMounted((m) => (m.includes(todo[0]) ? m : m.concat([todo[0]]))), mounted.length <= 1 ? 900 : 300);
    return () => clearTimeout(t);
  }, [E.DATA_IN, mounted]);
  useEffect(() => { const s = AppState.addEventListener("change", (st) => setLive(nav.view, st === "active")); return () => s.remove(); }, []);
  const panes = useRef({});
  const offsets = useRef({});
  const prev = useRef(view);
  const op = useSharedValue(1), sc = useSharedValue(1);
  const gearRot = useRef(new Animated.Value(0)).current;
  const [W, setW] = useState(Dimensions.get("window").width);     // the screens' own width (beside the sidebar when there is one)
  const [origin, setOrigin] = useState(null);
  useLayoutEffect(() => {
    if (tapAt.t) { console.log("[money] switch " + view + " " + (Date.now() - tapAt.t) + "ms"); tapAt.t = 0; }
    const from = prev.current; prev.current = view;
    setScrolled((offsets.current[view] || 0) > 4); expand();
    if (from === view || !motionOn()) { op.value = 1; sc.value = 1; return; }
    const kind = view === "settings" ? "into" : from === "settings" ? "outof" : "tab";
    setOrigin(kind === "tab" ? null : (W - 37) + "px " + (insets.top + 33) + "px");
    if (kind === "tab") {
      op.value = 0.35; sc.value = 1;
      op.value = withTiming(1, { duration: 140, easing: REasing.bezier(0.2, 0, 0, 1) });
    } else if (kind === "into") {
      op.value = 0; sc.value = 0.6;
      op.value = withTiming(1, { duration: 160 }); sc.value = withSpring(1, rs(S.page));
    } else {
      op.value = 0.3; sc.value = 1.03;
      op.value = withTiming(1, { duration: 140 }); sc.value = withSpring(1, rs(S.page));
      // on the native driver like the rest of the gear button: the gear was pressed natively on the way in, and a JS-driven
      // animation on a value that has gone native throws (it closed the app leaving Settings)
      gearRot.setValue(1); springTo(gearRot, 0, S.icon).start();
    }
  }, [view]);

  /* scrolling down slims the dock to its icons; up, or the top, brings it back */
  function expand() { if (compactOn.current) { compactOn.current = false; springTo(compact, 0, S.liquid).start(); } }
  const onScroll = (v, e) => {
    const y = e.nativeEvent.contentOffset.y;
    offsets.current[v] = y;
    if (v !== nav.view) return;
    const dy = y - y0.current; y0.current = y;
    if (y > 4 !== scrolled) setScrolled(y > 4);
    if (!dy || nav.sheet) return;
    acc.current = Math.sign(dy) === Math.sign(acc.current) ? acc.current + dy : dy;
    if (y < 40 || acc.current < -24) expand();
    else if (acc.current > 40 && !compactOn.current) { compactOn.current = true; springTo(compact, 1, S.liquid).start(); }
  };
  useEffect(() => { y0.current = offsets.current[view] || 0; }, [view]);
  // tap the tab you're on: back to the top
  useEffect(() => { onReselect.fn = (v) => { const p = panes.current[v]; if (p) p.scrollTo({ y: 0, animated: true }); expand(); }; return () => { onReselect.fn = null; }; }, []);

  /* swipe left or right on a screen for the next one (not on Settings, not over a sheet) */
  const swipe = useRef(new Animated.Value(0)).current;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (e, g) => !wideRef.current && nav.view !== "settings" && !nav.sheet && Math.abs(g.dx) > 30 && Math.abs(g.dx) > Math.abs(g.dy) * 2.6,
    onPanResponderTerminationRequest: () => true,
    onPanResponderMove: (e, g) => {
      const i = IDS.indexOf(nav.view), edge = (g.dx > 0 && i === 0) || (g.dx < 0 && i === IDS.length - 1);
      swipe.setValue(g.dx * (edge ? 0.08 : 0.22));
    },
    onPanResponderRelease: (e, g) => {
      const i = IDS.indexOf(nav.view), dir = g.dx < -70 || g.vx < -0.55 ? 1 : g.dx > 70 || g.vx > 0.55 ? -1 : 0, to = i + dir;
      if (dir && to >= 0 && to < IDS.length) {
        buzz("tick");
        swipe.setValue(dir * 28); go(IDS[to]); springTo(swipe, 0, S.page).start();
      } else springTo(swipe, 0, S.press).start();
    },
    onPanResponderTerminate: () => springTo(swipe, 0, S.press).start(),
  })).current;

  const screenSt = useAnimatedStyle(() => ({ opacity: Math.min(1, op.value), transform: [{ scale: sc.value }] }));
  // the same functions every render, so a drawn screen's props don't change
  const scrollFn = useRef(onScroll); scrollFn.current = onScroll;
  const cb = useRef(null);
  if (!cb.current) cb.current = { onScroll: (v, e) => scrollFn.current(v, e), register: {}, shown: {} };
  IDS.concat(["settings"]).forEach((v) => {
    cb.current.register[v] = cb.current.register[v] || ((r) => { panes.current[v] = r; });
    cb.current.shown[v] = cb.current.shown[v] || (() => { settled.current[v + ":seen"] = true; });
  });
  const lastParams = useRef({});
  const firstOf = useRef({});
  const target = useRef(null);
  const fabOn = view === "activity";
  const recede = sheetLevel.interpolate({ inputRange: [0, 1], outputRange: [1, 0.965] });
  const loading = !E.DATA_IN && !E.TX.length;
  return (
    <View style={{ flex: 1, backgroundColor: C.ground, flexDirection: wide ? "row" : "column" }}>
      {wide ? <Side /> : null}
      <View style={{ flex: 1 }} onLayout={(e) => { const w = e.nativeEvent.layout.width; if (Math.abs(w - W) > 1) setW(w); }}>
      {/* everything that scrolls: the glass bar and dock blur what passes under them */}
      <BlurTargetView ref={target} style={{ flex: 1, backgroundColor: C.ground }}>
      <Animated.View style={{ flex: 1, transform: [{ scale: recede }] }} {...pan.panHandlers}>
        <Animated.View style={{ flex: 1, transform: [{ translateX: swipe }] }}>
          <RAnimated.View style={[{ flex: 1, transformOrigin: origin || "50% 0px" }, screenSt]}>
            {mounted.map((v) => {
              const on = v === view;
              return (
                <View key={v} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, display: on ? "flex" : "none" }}>
                  <Freeze freeze={!on && !!settled.current[v + ":seen"]}>
                    <Pane v={v} first={firstOf.current[v] !== undefined ? firstOf.current[v] : (firstOf.current[v] = on && !settled.current[v + ":seen"])} loading={loading && v !== "settings"}
                      barH={barH} insets={insets} onScroll={cb.current.onScroll} register={cb.current.register[v]} onShown={cb.current.shown[v]} ver={dataVer()}
                      params={on ? (lastParams.current[v] = JSON.stringify(nav.params)) : lastParams.current[v] || "{}"} wide={wide} />
                  </Freeze>
                </View>
              );
            })}
          </RAnimated.View>
        </Animated.View>
      </Animated.View>
      </BlurTargetView>
      <AppBar onLayout={(h) => setBarH(h)} scrolled={scrolled} gearRot={gearRot} target={target} wide={wide} />
      {wide ? null : <EdgeFade />}
      {fabOn ? <Fab wide={wide} /> : null}
      {wide ? null : <Dock compact={compact} target={target} />}
      <BurstLayer />
      </View>
      <SheetHost />
      {process.env.EXPO_PUBLIC_MONEY_DEMO === "1" ? <WidgetGallery /> : null}
      <ToastHost wide={wide} />
      <Dialog visible={offer && !locked} onClose={() => { setOffer(false); pref.set("alertsOffered", "1"); }} title={WEB && !inApp ? "Get alerts in this browser?" : "Get alerts on this phone?"}
        actions={[
          <Btn key="l" kind="ghost" full label="Later" onPress={() => { setOffer(false); pref.set("alertsOffered", "1"); }} />,
          <Btn key="o" full label="Turn on" onPress={async () => { setOffer(false); pref.set("alertsOffered", "1"); Alerts.say(await Alerts.test()); }} />,
        ]}>
        <T s={15} lh={21} c={C.ink2}>Bills due in 3 days, EMIs, your salary landing, a quiet collector, and a 9 PM summary. Nothing between 10 PM and 8 AM.{WEB ? "" : " If the Money app's alerts are on too, you'll get each one twice, so keep them on in one app."}</T>
      </Dialog>
      {locked ? <LockScreen onOpen={() => setLocked(false)} /> : null}
    </View>
  );
}

/* ---------------- the app bar ---------------- */
/** Real glass: a blur of what's under it (Android 12 and later; older phones get the same tint without the blur). */
function Glass({ target, radius = 0, tint, edge }) {
  const C = useC();
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, borderRadius: radius, overflow: "hidden" }}>
      <BlurView blurTarget={target} intensity={44} blurReductionFactor={3} tint={C.dark ? "dark" : "light"} blurMethod="dimezisBlurViewSdk31Plus" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: tint }} />
      {edge ? <View style={{ position: "absolute", left: radius * 0.6, right: radius * 0.6, top: 0, height: 1, backgroundColor: C.glassRim, opacity: 0.9 }} /> : null}
    </View>
  );
}

function AppBar({ onLayout, scrolled, gearRot, target, wide }) {
  const C = useC();
  const insets = useSafeAreaInsets();
  const set = nav.view === "settings";
  const fade = useRef(new Animated.Value(1)).current, slide = useRef(new Animated.Value(0)).current;
  const backIn = useRef(new Animated.Value(set ? 1 : 0)).current;
  const was = useRef(nav.view);
  useEffect(() => {
    if (was.current === nav.view) return;
    const into = nav.view === "settings";
    was.current = nav.view;
    if (!motionOn()) return;
    fade.setValue(into ? 0 : 0.4); slide.setValue(into ? -6 : 0);
    if (into) { Animated.parallel([springTo(fade, 1, S.small, { native: false }), springTo(slide, 0, S.small, { native: false })]).start(); backIn.setValue(0); springTo(backIn, 1, S.icon, { native: false }).start(); }
    else timeTo(fade, 1, 120, EASE_OUT, { native: false }).start();
  }, [nav.view]);
  const dot = ui.feed.cls === "warn" ? C.warn : ui.feed.cls === "idle" ? C.ink3 : C.pos;
  return (
    <View onLayout={(e) => onLayout(e.nativeEvent.layout.height)} style={{ position: "absolute", left: 0, right: 0, top: 0, zIndex: 20, flexDirection: "row", alignItems: "center", gap: 10, paddingTop: insets.top + 12, paddingHorizontal: wide ? 28 : 16, paddingBottom: 10,
      borderBottomWidth: 1, borderBottomColor: scrolled ? C.line : "transparent" }}>
      <Glass target={target} tint={rgba(C.ground, scrolled ? 0.62 : 0.86)} />
      {set ? (
        <Animated.View style={{ marginLeft: -6, opacity: backIn, transform: [{ translateX: backIn.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }, { scale: backIn.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
          <GlassBtn icon="back" label="Back" plain onPress={() => back()} nudge={-4} />
        </Animated.View>
      ) : null}
      <Animated.View style={{ flex: 1, minWidth: 0, opacity: fade, transform: [{ translateX: slide }] }}>
        <T f={F.title} s={25} lh={31} lines={1} accessibilityRole="header">{TITLES[nav.view]}</T>
        {(
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginTop: 2 }}>
            <View style={{ width: 7, height: 7 }}><Ping size={7} color={dot} /><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} /></View>
            <T s={12.5} lh={16} c={C.ink3} lines={1} style={{ flexShrink: 1 }}>{ui.feed.txt}</T>
          </View>
        )}
      </Animated.View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <GlassBtn icon="eye" off={hidden()} label={hidden() ? "Show amounts" : "Hide amounts"} onPress={() => { pref.set("hide", hidden() ? null : "1"); pushWidget(true); }} />
        <GlassBtn icon="refresh" label="Check for new emails" turn={-50} spin={ui.busy} onPress={() => { if (!ui.busy) { Sms.scan(); E.act.refresh(); } }} />
        {set || wide ? null : <GlassBtn icon="settings" label="Settings" turn={75} rot={gearRot} onPress={() => go("settings")} />}
      </View>
    </View>
  );
}

/** .ab-btn: a 42 px round glass button that grows under your finger; its icon turns as you press (or spins while busy). */
function GlassBtn({ icon, label, onPress, turn = 0, spin, rot, plain, nudge, off }) {
  const C = useC();
  const s = useRef(new Animated.Value(1)).current, r = useRef(new Animated.Value(0)).current, glow = useRef(new Animated.Value(0)).current;
  const sp = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spin) { sp.stopAnimation(); sp.setValue(0); return; }
    sp.setValue(0);
    const a = Animated.sequence([
      Animated.timing(sp, { toValue: 1, duration: 450, easing: Easing.bezier(0.55, 0, 1, 0.45), useNativeDriver: NATIVE }),
      Animated.loop(Animated.sequence([Animated.timing(sp, { toValue: 2, duration: 700, easing: (t) => t, useNativeDriver: NATIVE }), Animated.timing(sp, { toValue: 1, duration: 0, useNativeDriver: NATIVE })])),
    ]);
    a.start();
    return () => a.stop();
  }, [spin]);
  const deg = Animated.add(Animated.add(r.interpolate({ inputRange: [0, 1], outputRange: [0, turn] }), sp.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 410, 770] })),
    rot ? rot.interpolate({ inputRange: [0, 1], outputRange: [0, -120] }) : 0);
  const rs = rot ? rot.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }) : 1;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={spin} hitSlop={4}
      onPressIn={() => { buzz("tick"); springTo(s, plain ? 1 : 1.1, S.press).start(); timeTo(glow, 1, 60).start(); springTo(r, 1, S.icon).start(); }}
      onPressOut={() => { springTo(s, 1, S.press).start(); timeTo(glow, 0, 420).start(); springTo(r, 0, S.icon).start(); }}
      onPress={onPress}>
      <Animated.View style={[{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", overflow: "hidden", transform: [{ scale: s }] },
        !plain && { backgroundColor: C.glassStrong, borderWidth: 1, borderColor: C.glassEdge, shadowColor: "#16182E", shadowOpacity: C.dark ? 0.5 : 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 }]}>
        {!plain ? <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.glassHi, opacity: glow }} /> : null}
        <Animated.View style={{ transform: [{ translateX: nudge ? r.interpolate({ inputRange: [0, 1], outputRange: [0, nudge] }) : 0 }, { rotate: deg.interpolate({ inputRange: [-1000, 1000], outputRange: ["-1000deg", "1000deg"] }) }, { scale: rs }] }}>
          {icon === "eye" ? <EyeIcon off={off} size={21} color={C.ink} sw={1.9} /> : <Icon name={icon} size={21} color={C.ink} sw={1.9} />}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/* ---------------- the dock ---------------- */
/** .tabbar: floating glass, 64 tall, with a drop that slides to the chosen tab: its leading edge springs fast and its
    trailing edge follows a little later, so it stretches as it moves. Drag along it to pick a tab. */
function Dock({ compact, target }) {
  const C = useC();
  const insets = useSafeAreaInsets();
  const idx = IDS.indexOf(nav.view);
  const [w, setW] = useState(Math.min(480, Dimensions.get("window").width - 24));
  const N = TABS.length, last = N - 1, slot = (w - 12) / N;
  const slotV = useSharedValue(slot);
  useEffect(() => { slotV.value = slot; }, [slot]);
  /* the drop's two edges, in tabs (0..last), on the graphics thread */
  const pl = useSharedValue(Math.max(0, idx)), pr = useSharedValue(Math.max(0, idx));
  const lens = useSharedValue(0), show = useSharedValue(idx < 0 ? 0 : 1), nearV = useSharedValue(-1);
  const at = useRef(Math.max(0, idx)), dragging = useRef(false);
  const [drag, setDrag] = useState(false);
  const [near, setNear] = useState(-1);
  const LIQ = rs(S.liquid), LAG = rs(S.liquidLag), SMALL = rs(S.small);
  const moveTo = (i, from) => {
    if (!motionOn()) { pl.value = i; pr.value = i; return; }
    const right = i > from;
    pl.value = withSpring(i, right ? LAG : LIQ); pr.value = withSpring(i, right ? LIQ : LAG);
  };
  useEffect(() => {
    show.value = withTiming(idx < 0 ? 0 : 1, { duration: 160 });
    if (idx < 0 || dragging.current) return;
    if (idx !== at.current) { moveTo(idx, at.current); at.current = idx; }
  }, [idx]);
  /* a tap: on touch-down the tab lights up and the drop slides there at once (on the graphics thread), with the tick;
     the screen itself switches on the next frame, so nothing waits for it */
  const [sel, setSel] = useState(null);
  useEffect(() => { setSel(null); }, [idx]);
  const shown = sel !== null ? sel : idx;
  const pick = (i) => {
    tapAt.t = Date.now();
    buzz("tick");
    if (IDS[i] === nav.view) { if (onReselect.fn) onReselect.fn(IDS[i]); return; }
    moveTo(i, at.current); at.current = i;
    show.value = withTiming(1, { duration: 120 });
    setSel(i);
    requestAnimationFrame(() => go(IDS[i]));
  };
  const began = () => { dragging.current = true; setDrag(true); buzz("tick"); };
  const nearTo = (k) => { setNear(k); buzz("tick"); };
  const ended = (k) => { dragging.current = false; setDrag(false); setNear(-1); at.current = k; if (IDS[k] !== nav.view) go(IDS[k]); };
  /* drag along the dock: the drop follows your finger exactly (the gesture runs on the graphics thread too) */
  const pan = Gesture.Pan().activeOffsetX([-8, 8]).failOffsetY([-14, 14])
    .onStart(() => { "worklet"; lens.value = withSpring(1, SMALL); show.value = withTiming(1, { duration: 120 }); runOnJS(began)(); })
    .onUpdate((e) => {
      "worklet";
      const f = Math.max(0, Math.min(last, (e.x - 6) / slotV.value - 0.5));
      pl.value = f; pr.value = f;
      const k = Math.round(f);
      if (k !== nearV.value) { nearV.value = k; runOnJS(nearTo)(k); }
    })
    .onEnd((e) => {
      "worklet";
      const k = Math.round(Math.max(0, Math.min(last, (e.x - 6) / slotV.value - 0.5)));
      pl.value = withSpring(k, LIQ); pr.value = withSpring(k, LIQ); lens.value = withSpring(0, SMALL); nearV.value = -1;
      runOnJS(ended)(k);
    });
  const pill = useAnimatedStyle(() => {
    const s = slotV.value, a = 9 + Math.max(0, Math.min(last, pl.value)) * s, b = 3 + (Math.max(0, Math.min(last, pr.value)) + 1) * s;
    return { left: a, width: Math.max(10, b - a), opacity: show.value,
      transform: [{ scaleX: 1 + 0.16 * lens.value }, { scaleY: 1 + 0.2 * lens.value }, { scale: 0.7 + 0.3 * show.value }] };
  });
  const c = compact;
  return (
    <GestureDetector gesture={pan}>
      <Animated.View onLayout={(e) => setW(e.nativeEvent.layout.width)}
        style={{ position: "absolute", zIndex: 30, left: 12, right: 12, bottom: 10 + insets.bottom, maxWidth: 480, height: 64, paddingHorizontal: 6, flexDirection: "row", borderRadius: 32,
          boxShadow: C.dark ? "0px 12px 32px rgba(0,0,0,0.6)" : "0px 12px 30px rgba(22,24,46,0.2)",
          transform: [{ translateY: c.interpolate({ inputRange: [0, 1], outputRange: [0, 6] }) }, { scale: c.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }) }] }}>
        <Glass target={target} radius={32} tint={rgba(C.dark ? "#1C1C1C" : "#FFFFFF", 0.55)} edge />
        <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, borderRadius: 32, borderWidth: 1, borderColor: C.glassEdge }} />
        <RAnimated.View pointerEvents="none" style={[{ position: "absolute", top: 7, bottom: 7, borderRadius: 25, backgroundColor: drag ? rgba(C.dark ? "#2A2A2A" : "#FFFFFF", 0.55) : C.drop,
          borderWidth: 1, borderColor: drag ? C.glassRim : rgba(C.accent, 0.1),
          boxShadow: drag ? "0px 10px 22px rgba(22,24,46,0.28)" : "0px 1px 3px rgba(22,24,46,0.08)" }, pill]} />
        {TABS.map((t, i) => <DockTab key={t.id} t={t} on={i === shown && !drag} near={i === near} c={c} onPick={() => pick(i)} />)}
      </Animated.View>
    </GestureDetector>
  );
}

function DockTab({ t, on, near, c, onPick }) {
  const C = useC();
  const picked = useRef(false);   // picked on touch-down; the web preview only sends the tap, so then it picks on release
  const s = useRef(new Animated.Value(1)).current;
  const col = on ? C.accent : near ? C.ink : C.ink2;
  return (
    <Pressable style={{ flex: 1, alignItems: "center", justifyContent: "center", zIndex: 2 }} accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on} accessibilityLabel={t.label}
      onPressIn={() => { springTo(s, 0.86, S.liquid).start(); picked.current = true; onPick(); }} onPressOut={() => springTo(s, 1, S.liquid).start()}
      onPress={() => { if (!picked.current) onPick(); picked.current = false; }}>
      <Animated.View style={{ width: 30, height: 28, alignItems: "center", justifyContent: "center", transform: [{ translateY: c.interpolate({ inputRange: [0, 1], outputRange: [0, 7] }) }, { scale: s }] }}>
        <TabIcon name={t.id} on={on} size={23} color={col} />
      </Animated.View>
      <Animated.View style={{ marginTop: 1, opacity: c.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateY: c.interpolate({ inputRange: [0, 1], outputRange: [0, 5] }) }, { scale: c.interpolate({ inputRange: [0, 1], outputRange: [1, 0.8] }) }] }}>
        <T f={on ? F.bold : F.medium} s={10.5} lh={14} c={col} lines={1} style={{ letterSpacing: 0 }}>{t.label}</T>
      </Animated.View>
    </Pressable>
  );
}

/** A wide window (a laptop): the dock becomes a sidebar: a tray with the six screens and, at its foot, Settings. The
    one you're on is a white card. */
function Side() {
  const C = useC();
  const insets = useSafeAreaInsets();
  const item = (id, label) => {
    const on = nav.view === id;
    const col = on ? C.accent : C.ink2;
    return (
      <Press key={id} scale={0.97} accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on} accessibilityLabel={label}
        onPress={() => { if (id === nav.view) { if (onReselect.fn) onReselect.fn(id); return; } tapAt.t = Date.now(); go(id); }}
        style={[{ flexDirection: "row", alignItems: "center", gap: 12, height: 46, paddingHorizontal: 12, borderRadius: 14 }, on && { backgroundColor: C.surface, boxShadow: C.card }]}>
        <View style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center" }}>
          {id === "settings" ? <Icon name="settings" size={21} color={col} sw={1.9} /> : <TabIcon name={id} on={on} size={22} color={col} />}
        </View>
        <T f={on ? F.semi : F.medium} s={14.5} lh={20} c={on ? C.ink : C.ink2} lines={1}>{label}</T>
      </Press>
    );
  };
  return (
    <View style={{ width: 240, paddingTop: insets.top + 14, paddingLeft: 14, paddingBottom: 14 + insets.bottom }}>
      <View style={{ flex: 1, backgroundColor: C.tray, borderRadius: 22, padding: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 14 }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: C.heroA, alignItems: "center", justifyContent: "center" }}><T f={F.bold} s={16} lh={20} c={C.heroInk} style={{ letterSpacing: 0 }}>₹</T></View>
          <T f={F.title} s={19} lh={24}>Money</T>
        </View>
        <View style={{ gap: 4 }}>{TABS.map((t) => item(t.id, t.label))}</View>
        <View style={{ flex: 1 }} />
        {item("settings", "Settings")}
      </View>
    </View>
  );
}

/** The page fades softly under the dock. */
function EdgeFade() {
  const C = useC();
  const insets = useSafeAreaInsets();
  const h = 100 + insets.bottom;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: h, zIndex: 28 }}>
      <Svg width="100%" height={h}>
        <Defs><LinearGradient id="ef" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={C.ground} stopOpacity={0.7} /><Stop offset="0.45" stopColor={C.ground} stopOpacity={0.28} /><Stop offset="1" stopColor={C.ground} stopOpacity={0} />
        </LinearGradient></Defs>
        <Rect x="0" y="0" width="100%" height={h} fill="url(#ef)" />
      </Svg>
    </View>
  );
}

/** .fab: "Add" on Activity, springing up out of the dock. */
function Fab({ wide }) {
  const C = useC();
  const insets = useSafeAreaInsets();
  const v = useRef(new Animated.Value(motionOn() ? 0 : 1)).current, s = useRef(new Animated.Value(1)).current, glow = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (motionOn()) springTo(v, 1, S.icon).start(); }, []);
  return (
    <Animated.View style={{ position: "absolute", zIndex: 29, right: wide ? 28 : 16, bottom: wide ? 28 : 88 + insets.bottom, opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [46, 0] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Add a payment" onPress={() => { buzz("tick"); openSheet("add"); }}
        onPressIn={() => { springTo(s, 1.06, S.press).start(); timeTo(glow, 1, 60).start(); }} onPressOut={() => { springTo(s, 1, S.press).start(); timeTo(glow, 0, 420).start(); }}>
        <Animated.View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 54, paddingLeft: 18, paddingRight: 22, borderRadius: 22, overflow: "hidden", backgroundColor: rgba(C.accent, 0.93),
          borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", shadowColor: C.accent, shadowOpacity: 0.55, shadowRadius: 14, shadowOffset: { width: 0, height: 12 }, elevation: 10, transform: [{ scale: s }] }}>
          <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(255,255,255,0.3)", opacity: glow }} />
          <Turn><Icon name="plus" size={22} color={C.accentInk} sw={2.2} /></Turn>
          <T f={F.semi} s={15} lh={20} c={C.accentInk}>Add</T>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/** Before anything has loaded: the shapes of the screen, shimmering. */
function Skeleton() {
  const C = useC();
  const v = useRef(new Animated.Value(0.55)).current;
  useEffect(() => { const a = Animated.loop(Animated.sequence([timeTo(v, 1, 700), timeTo(v, 0.55, 700)])); a.start(); return () => a.stop(); }, []);
  const blk = (h, r, bg) => <Animated.View style={{ height: h, borderRadius: r, backgroundColor: bg, opacity: v, marginBottom: 10 }} />;
  return <View>{blk(300, 24, C.heroA)}{blk(84, 22, C.tray)}{blk(220, 22, C.tray)}{blk(160, 22, C.tray)}</View>;
}

/** Locked: the sign-in card's look, with the fingerprint (or the phone PIN) before anything shows. */
function LockScreen({ onOpen }) {
  if (Lock.kind === "pin") return <PinLock onOpen={onOpen} />;   // a browser: the 4-digit code
  return <BioLock onOpen={onOpen} />;
}
function BioLock({ onOpen }) {
  const C = useC();
  const [msg, setMsg] = useState("");
  const pulse = useRef(new Animated.Value(0)).current;
  const ask = async () => {
    springTo(pulse, 1, S.pop).start(() => springTo(pulse, 0, S.soft).start());
    const r = await Lock.authenticate("Unlock Money");
    if (r.ok) { buzz("confirm"); onOpen(); } else { setMsg(r.message || ""); buzz("error"); }
  };
  useEffect(() => { setTimeout(ask, 250); }, []);
  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 80 }}>
      <Card>
        <View style={{ alignItems: "center", marginTop: 4, marginBottom: 18 }}>
          <Pressable onPress={ask} accessibilityRole="button" accessibilityLabel="Unlock">
            <Animated.View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center", transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] }}>
              <Icon name="finger" size={42} color={C.accent} sw={1.6} />
            </Animated.View>
          </Pressable>
        </View>
        <T f={F.title} s={25} lh={31} style={{ marginBottom: 8, textAlign: "center" }} accessibilityRole="header">Money is locked</T>
        <T s={15} lh={21} c={C.ink2} style={{ textAlign: "center", marginBottom: 6 }}>Use your fingerprint or phone PIN to open it.</T>
        <Btn big full label="Unlock" onPress={ask} style={{ marginTop: 12 }} />
        <T s={14} lh={19} c={C.ink2} style={{ textAlign: "center", marginTop: 12, minHeight: 19 }}>{msg}</T>
      </Card>
    </View>
  );
}
