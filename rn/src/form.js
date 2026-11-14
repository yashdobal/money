/* Form pieces for the sheets (app.css .field): a label above a soft grey box that turns white with an accent ring when
   you type in it; a date picker; a list picker; a small dialog. */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { E } from "./store";
import { useC, F, rgba } from "./theme";
import { T, Press, buzz, Btn, useShake } from "./kit";
import { Icon } from "./icons";
import { S, springTo, timeTo, motionOn } from "./motion";

/** .field: label, then the box. err: shakes and shows the message under it. */
export function Field({ label, value, onChange, numeric, placeholder, multiline, error, autoFocus, maxLength, style, big, prefix }) {
  const C = useC();
  const [focus, setFocus] = useState(false);
  const [shake, go] = useShake();
  useEffect(() => { if (error) go(); }, [error]);
  return (
    <View style={[{ marginTop: 14 }, style]}>
      {label ? <T f={F.medium} s={13.5} lh={18} c={C.ink2} style={{ marginBottom: 6 }}>{label}</T> : null}
      <Animated.View style={[shake, { flexDirection: "row", alignItems: "center", minHeight: big ? 76 : 48, paddingHorizontal: 14, borderRadius: big ? 18 : 12,
        backgroundColor: focus ? C.surface : C.inset, borderWidth: 1.5, borderColor: error ? C.alert : focus ? C.accent : "transparent", justifyContent: big ? "center" : "flex-start" }]}>
        {prefix ? <T f={big ? F.fig : F.body} s={big ? 40 : 15} lh={big ? 46 : 20} c={C.ink3} style={{ marginRight: 4 }}>{prefix}</T> : null}
        <TextInput value={value} accessibilityLabel={label || placeholder} placeholder={placeholder} placeholderTextColor={C.ink3} autoFocus={autoFocus} maxLength={maxLength}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} multiline={multiline} textAlignVertical={multiline ? "top" : "center"}
          onChangeText={(t) => onChange(numeric ? t.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1") : t)} keyboardType={numeric ? "decimal-pad" : "default"}
          style={{ flex: big ? 0 : 1, minWidth: big ? 60 : undefined, fontFamily: big ? F.fig : F.body, fontSize: big ? 40 : 15, color: C.ink, paddingVertical: multiline ? 12 : 10,
            minHeight: multiline ? 88 : undefined, includeFontPadding: false, letterSpacing: big ? -1.8 : -0.18, textAlign: big ? "center" : "left" }} />
      </Animated.View>
      {error ? <T s={13} lh={17} c={C.alert} style={{ marginTop: 6 }}>{error}</T> : null}
    </View>
  );
}
export const Row2 = ({ children }) => <View style={{ flexDirection: "row", gap: 12 }}>{React.Children.map(children, (c) => <View style={{ flex: 1, minWidth: 0 }}>{c}</View>)}</View>;
/** .sheet-actions: buttons side by side, 52 px. */
export function Actions({ children }) {
  return <View style={{ flexDirection: "row", gap: 10, marginTop: 22 }}>{React.Children.map(children, (c) => c ? <View style={{ flex: 1 }}>{c}</View> : null)}</View>;
}
/** A field you tap to choose (a date, a payday): looks like .field. */
function Picker({ label, text, onPress, icon, style }) {
  const C = useC();
  return (
    <View style={[{ marginTop: 14 }, style]}>
      <T f={F.medium} s={13.5} lh={18} c={C.ink2} style={{ marginBottom: 6 }}>{label}</T>
      <Press onPress={onPress} scale={0.98} accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", minHeight: 48, paddingHorizontal: 14, borderRadius: 12, backgroundColor: C.inset }}>
        <T s={16} lh={20} c={text ? C.ink : C.ink3} style={{ flex: 1 }} lines={1}>{text || "Pick a date"}</T>
        <Icon name={icon} size={18} color={C.ink3} />
      </Press>
    </View>
  );
}

/** A small dialog over everything (a scrim, a white card that springs in). */
export function Dialog({ visible, onClose, title, children, actions }) {
  const C = useC();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (visible) { v.setValue(0); springTo(v, 1, S.sheet).start(); } }, [visible]);
  return (
    <Modal transparent visible={!!visible} animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.scrim, opacity: v }}><Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" /></Animated.View>
        <Animated.View style={{ width: "100%", maxWidth: 400, backgroundColor: C.surface, borderRadius: 28, padding: 22, opacity: v,
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }} accessibilityViewIsModal>
          {title ? <T f={F.head} s={18} lh={24} style={{ marginBottom: 8 }}>{title}</T> : null}
          {children}
          {actions ? <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>{actions}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** A date: "5 Mar 2026"; tap for a month calendar. value/onChange in "YYYY-MM-DD"; max: the latest date allowed. */
export function DateField({ label, value, onChange, max, style }) {
  const C = useC();
  const [open, setOpen] = useState(false);
  const d = value ? E.parseISO(value) : null;
  const [month, setMonth] = useState(() => { const x = d || new Date(); return new Date(x.getFullYear(), x.getMonth(), 1); });
  const first = new Date(month.getFullYear(), month.getMonth(), 1), lead = (first.getDay() + 6) % 7;
  const dim = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = E.iso(E.sod(new Date()));
  const cells = [];
  // weeks are rows of seven equal cells (not one wrapping row: rounded to whole pixels, seven cells can overflow a line)
  for (let i = 0; i < lead; i++) cells.push(<View key={"e" + i} style={{ flex: 1, height: 42 }} />);
  for (let n = 1; n <= dim; n++) {
    const k = E.iso(new Date(month.getFullYear(), month.getMonth(), n)), on = k === value, off = max && k > max;
    cells.push(
      <Press key={k} disabled={off} scale={0.9} onPress={() => { onChange(k); setOpen(false); }} accessibilityLabel={String(n)} style={{ flex: 1, minWidth: 0, height: 42, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: on ? C.accent : "transparent" }}>
          <T f={k === today || on ? F.bold : F.medium} s={15} lh={18} c={on ? C.accentInk : off ? C.ink3 : k === today ? C.accent : C.ink}>{n}</T>
        </View>
      </Press>
    );
  }
  while (cells.length % 7) cells.push(<View key={"t" + cells.length} style={{ flex: 1, height: 42 }} />);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(<View key={i} style={{ flexDirection: "row" }}>{cells.slice(i, i + 7)}</View>);
  return (
    <View style={style}>
      <Picker label={label} text={d ? E.fmt(d) + " " + d.getFullYear() : ""} icon="calendar" onPress={() => { if (d) setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setOpen(true); }} />
      <Dialog visible={open} onClose={() => setOpen(false)} title={label}
        actions={[value ? <View key="c" style={{ flex: 1 }}><Btn kind="ghost" full label="Clear" onPress={() => { onChange(""); setOpen(false); }} /></View> : null,
          <View key="x" style={{ flex: 1 }}><Btn kind="ghost" full label="Close" onPress={() => setOpen(false)} /></View>]}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
          <Press onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} accessibilityLabel="Previous month" style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}><Icon name="back" size={20} color={C.ink2} /></Press>
          <T f={F.semi} s={16} style={{ flex: 1, textAlign: "center" }}>{E.MONFULL[month.getMonth()] + " " + month.getFullYear()}</T>
          <Press onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} accessibilityLabel="Next month" style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}><Icon name="chev" size={20} color={C.ink2} /></Press>
        </View>
        <View style={{ flexDirection: "row" }}>{["M", "T", "W", "T", "F", "S", "S"].map((x, i) => <T key={i} s={12} c={C.ink3} style={{ flex: 1, textAlign: "center" }}>{x}</T>)}</View>
        {weeks}
      </Dialog>
    </View>
  );
}

/** A choice from a list, shown like a field. options: [[value, label]]. */
export function SelectField({ label, value, options, onChange, style }) {
  const C = useC();
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o[0] === value) || options[0];
  return (
    <View style={style}>
      <Picker label={label} text={cur ? cur[1] : ""} icon="down" onPress={() => setOpen(true)} />
      <Dialog visible={open} onClose={() => setOpen(false)} title={label}>
        <ScrollView style={{ maxHeight: 380 }}>
          {options.map(([v, l]) => (
            <Press key={v} scale={0.98} onPress={() => { setOpen(false); onChange(v); }} style={{ minHeight: 46, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, borderRadius: 12, backgroundColor: v === value ? C.accentSoft : "transparent" }}>
              <T f={v === value ? F.semi : F.body} s={15} style={{ flex: 1 }}>{l}</T>
              {v === value ? <Icon name="tick" size={18} color={C.accent} /> : null}
            </Press>
          ))}
        </ScrollView>
      </Dialog>
    </View>
  );
}
