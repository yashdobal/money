/* Bottom sheets (app.css .sheet, motion.js): white, 28 px top corners, a grip, the title and a round close button.
   They rise on the sheet spring (560 / 0.86) while the screen behind recedes a little; the content follows the sheet in;
   drag down, tap outside or press Back to close (they leave quickly, accelerating away). */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, KeyboardAvoidingView, Modal, PanResponder, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { nav, closeSheet } from "./nav";
import { useTick } from "./store";
import { useC, F } from "./theme";
import { T, Press, TrayCtx, buzz, useWide } from "./kit";
import { Icon } from "./icons";
import { S, OUT, springTo, motionOn, NATIVE } from "./motion";
import SHEETS from "./sheets";
import ToastHost from "./toast";

export const SheetCtx = React.createContext({ close: () => {} });
/** 0 = no sheet, 1 = a sheet fully up: the screen behind follows it (scales to 0.965). */
export const sheetLevel = new Animated.Value(0);

const parse = (spec) => {
  if (!spec) return null;
  if (typeof spec === "object") return { kind: spec.kind, arg: spec.arg || "", spec };
  const [kind, ...rest] = String(spec).split(":");
  return { kind, arg: rest.join(":"), spec: null };
};

export default function SheetHost() {
  useTick();
  const want = nav.sheet;
  const [shown, setShown] = useState(null);
  const y = useRef(new Animated.Value(1)).current;          // 0 = open, 1 = off the screen
  const H = Dimensions.get("window").height;
  useEffect(() => {
    const open = () => {
      y.setValue(1);
      if (!motionOn()) { y.setValue(0); sheetLevel.setValue(1); return; }
      springTo(y, 0, S.sheet).start();
      springTo(sheetLevel, 1, S.sheet).start();
    };
    if (want && want !== shown) { const was = shown; setShown(want); if (!was) requestAnimationFrame(open); }
    else if (!want && shown) {
      if (!motionOn()) { setShown(null); sheetLevel.setValue(0); return; }
      Animated.parallel([
        Animated.timing(y, { toValue: 1, duration: 250, easing: OUT, useNativeDriver: NATIVE }),
        Animated.timing(sheetLevel, { toValue: 0, duration: 250, easing: OUT, useNativeDriver: NATIVE }),
      ]).start(() => setShown(null));
    }
  }, [want]);
  const close = () => { if (nav.sheet) closeSheet(); };
  if (!shown) return null;
  const p = parse(shown);
  const make = p && SHEETS[p.kind];
  const def = make ? make(p.arg, p.spec) : null;
  if (!def) { setTimeout(close, 0); return null; }
  return (
    <Modal transparent visible animationType="none" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <SheetFrame y={y} H={H} close={close} title={def.title} key={typeof shown === "string" ? shown : p.kind + JSON.stringify(p.spec.preset || {})}>
        <SheetCtx.Provider value={{ close }}>{def.body}</SheetCtx.Provider>
      </SheetFrame>
    </Modal>
  );
}

function SheetFrame({ y, H, close, title, children }) {
  const C = useC();
  const insets = useSafeAreaInsets();
  const wide = useWide();                              // a laptop: the sheet rises to the middle of the window, as a dialog
  const drag = useRef(new Animated.Value(0)).current;
  const kids = useRef(new Animated.Value(motionOn() ? 0 : 1)).current;
  useEffect(() => { if (motionOn()) springTo(kids, 1, S.soft, { delay: 110 }).start(); }, []);
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (e, g) => drag.setValue(g.dy > 0 ? g.dy : g.dy / 4),
    onPanResponderRelease: (e, g) => {
      if (g.dy > 110 || (g.dy > 30 && g.vy > 0.6)) { buzz("tick"); close(); setTimeout(() => drag.setValue(0), 300); }
      else springTo(drag, 0, S.sheet).start();
    },
  })).current;
  const ty = Animated.add(y.interpolate({ inputRange: [0, 1], outputRange: [0, H] }), drag);
  return (
    <View style={{ flex: 1, justifyContent: wide ? "center" : "flex-end" }}>
      <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.scrim, opacity: y.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Close" />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={{ maxHeight: wide ? "88%" : "92%" }}>
        <Animated.View accessibilityViewIsModal style={{ transform: [{ translateY: ty }], backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
          borderBottomLeftRadius: wide ? 28 : 0, borderBottomRightRadius: wide ? 28 : 0, paddingBottom: (wide ? 0 : insets.bottom) + 18, maxWidth: 560, width: "100%", alignSelf: "center", flexShrink: 1, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: -10 }, elevation: 24 }}>
          <View {...pan.panHandlers} style={{ paddingHorizontal: 20, paddingTop: 6 }}>
            <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: wide ? "transparent" : C.line2, marginTop: 4, marginBottom: 10 }} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
              <T f={F.head} s={18} lh={24} accessibilityRole="header" lines={2} style={{ flex: 1 }}>{title}</T>
              <Press onPress={close} scale={0.9} accessibilityLabel="Close" style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.inset, alignItems: "center", justifyContent: "center" }}>
                <Icon name="close" size={18} color={C.ink2} />
              </Press>
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4 }} style={{ flexGrow: 0, flexShrink: 1 }}>
            <Animated.View style={{ opacity: kids, transform: [{ translateY: kids.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
              <TrayCtx.Provider value="w">{children}</TrayCtx.Provider>
            </Animated.View>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
      <ToastHost inSheet />
    </View>
  );
}
