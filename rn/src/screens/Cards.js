/* Cards: all cards at a glance (what's to pay, which is next, how much of the limits you're using), the best card to
   use today, then each card: its face, the one line that matters ("Pay ₹X by 18 Nov · 11 days left"), the billing
   cycle as a timeline with today on it, the limit in use, and what's been spent since the statement by category.
   Payment history isn't on the page any more: it's behind "Payments" on each card. */
import React, { useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Line, G } from "react-native-svg";
import { E, toast } from "../store";
import { nav, openSheet, goTo } from "../nav";
import { useC, F } from "../theme";
import { T, M, amt, exact, money, plural, Panel, Rows, Row, CatIc, Ic, Note, Chip, Btn, Press, TrayCtx, hidden, buzz, toneColor, catHue, Page } from "../kit";
import { SheenFill, Glow } from "../alive";
import { S, springTo, enter, entrance, motionOn, NATIVE, rs } from "../motion";
import { useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { GL, CardLight } from "../gl";

/* card faces: graphite with a hint of colour (steel, teal, gold, rose), one per card account in turn, or the one its
   profile picks (face: 0–3); the network printed on it comes from the profile too (net: "VISA") */
const FACES = [
  { g: ["#43464C", "#27292D", "#151618"], ink: "#F5F5F3" },
  { g: ["#3E4442", "#242827", "#131515"], ink: "#F5F5F3" },
  { g: ["#47433B", "#272420", "#141311"], ink: "#EFE9DC" },
  { g: ["#494041", "#282223", "#151213"], ink: "#EFE6E4" },
];
const faceOf = (key) => {
  const p = (E.PROFILE.groups || {})[key] || {}, i = Object.keys(E.GROUPS).indexOf(key);
  return Object.assign({}, FACES[(p.face >= 0 && p.face < 4 ? p.face : Math.max(0, i)) % 4], { net: String(p.net || "").toUpperCase() });
};

export default function Cards({ first, scrollTo }) {
  const cards = E.allCards();
  const un = E.PAY_INFO.unresolved.filter((t) => t.ts > Date.now() - 60 * E.DAY);
  const pos = useRef({});
  const want = nav.params.card;
  useEffect(() => { if (want) setTimeout(() => { if (pos.current[want] !== undefined && scrollTo) scrollTo(pos.current[want]); }, 450); }, [want, nav.seq]);
  return (
    <Page id="cards">
      {un.length ? (
        <Panel title={un.length === 1 ? "A card payment needs its card" : un.length + " card payments need their card"} tone="warn" i={0} first={first}>
          <Note>These left your bank like a card bill, but no confirmation email said which card. Pick one.</Note>
          {un.slice(-5).map((t) => (
            <View key={t.id} style={{ marginTop: 8 }}>
              <Rows><Row icon={<CatIc cat="Card payment" />} title={t.desc} detail={E.fmt(new Date(t.ts)) + " " + new Date(t.ts).getFullYear()} value={amt(t.amt, { exact: true })} /></Rows>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {E.openGroups(t.ts).map((k) => <Chip key={k} small label={E.cardShort(k)} onPress={() => { E.act.assignPayment(t.id, k); toast("Matched to " + E.cardShort(k)); }} />)}
                <Chip small dashed label="Not a card payment" onPress={() => { E.act.assignPayment(t.id, "none"); toast("Marked as not a card payment"); }} />
              </View>
            </View>
          ))}
        </Panel>
      ) : null}
      {cards.length ? <Summary cards={cards} first={first} i={un.length ? 1 : 0} /> : null}
      {cards.length > 1 ? <BestToday cards={cards} first={first} i={un.length ? 2 : 1} /> : null}
      {cards.map((c, i) => <View key={c.key} onLayout={(e) => { pos.current[c.key] = e.nativeEvent.layout.y; }}><CardBlock c={c} i={i} first={first} /></View>)}
    </Page>
  );
}

/* ---------------- helpers ---------------- */
const limitOf = (g) => (typeof E.overrides["limit|" + g] === "number" ? E.overrides["limit|" + g] : null);
const today = () => E.sod(new Date());
const endOfDay = (d) => d.getTime() + 86400000 - 1;
/** Where a card stands, in words and a tone (shared by the face's badge and the line under it). */
function standing(c) {
  const owe = !c.preFirst && c.billedLeft >= 0.5, overdue = owe && c.dueIn < 0;
  const due = c.prevUnpaid >= 0.5 ? c.c.prevDue : c.c.due;
  const badge = c.preFirst ? ["No bill yet"] : c.billed < 0.5 && c.prevUnpaid < 0.5 ? ["Nothing billed", "pos"] : !owe ? ["Paid", "pos"]
    : overdue ? ["Overdue", "alert"] : [c.dueIn === 0 ? "Due today" : c.dueIn === 1 ? "Due tomorrow" : "Due in " + c.dueIn + " days", c.dueIn <= 3 ? "alert" : c.dueIn <= 5 ? "warn" : ""];
  return { owe, overdue, due, badge };
}
/** Spend today on this card and you pay it on the next statement's due date: the days in between, interest-free
    (only while every earlier bill is paid in full by its due date). */
const floatDays = (c) => E.days(today(), c.c.nextDue);
const carrying = (c) => c.prevUnpaid >= 0.5 || (!c.preFirst && c.billedLeft >= 0.5 && c.dueIn < 0);

/** All cards at a glance: what's to pay, which is next, and (with limits) how much of them you're using. */
function Summary({ cards, first, i }) {
  const C = useC();
  const owing = cards.filter((c) => !c.preFirst && c.billedLeft >= 0.5).sort((a, b) => a.dueIn - b.dueIn);
  const toPay = owing.reduce((a, c) => a + c.billedLeft, 0), since = cards.reduce((a, c) => a + c.unbilledLeft, 0);
  const lim = cards.filter((c) => limitOf(c.key));
  const used = lim.reduce((a, c) => a + c.owed, 0), cap_ = lim.reduce((a, c) => a + limitOf(c.key), 0), pct = cap_ ? Math.round((used / cap_) * 100) : null;
  const next = owing[0];
  const late = owing.filter((c) => c.dueIn < 0);
  return (
    <Panel kind="w" i={i} first={first}>
      <T s={13} lh={18} c={C.ink2}>{owing.length ? "To pay on " + plural(owing.length, "bill") : "Card bills"}</T>
      {owing.length ? <M v={toPay} f={F.fig} s={30} c={late.length ? C.alert : C.ink} style={{ lineHeight: 36 }} />
        : <T f={F.head} s={20} lh={28} c={C.pos}>All paid ✓</T>}
      <T s={14} lh={20} c={late.length ? C.alert : C.ink2} style={{ marginTop: 2 }}>
        {late.length ? E.cardShort(late[0].key) + " is overdue: pay it first."
          : next ? "Next: " + E.cardShort(next.key) + ", " + (next.dueIn === 0 ? "due today" : next.dueIn === 1 ? "due tomorrow" : "due in " + next.dueIn + " days") + " (" + E.fmt(next.c.due) + ")"
          : "Nothing due until the next statements close."}
      </T>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        <Mini label="Spent since statements" v={since} sub="on the next bills" />
        <Mini label="Limit used" text={pct === null ? "Add limits" : pct + "%"} tone={pct === null ? "" : pct <= 30 ? "pos" : pct <= 90 ? "warn" : "alert"}
          onPress={pct === null ? () => openSheet("limit:" + cards[0].key) : undefined}
          sub={pct === null ? "to see how much you use" : lim.length < cards.length ? "of the cards with a limit" : "under 30% is the usual advice"} />
      </View>
    </Panel>
  );
}
function Mini({ label, v, text, sub, tone, onPress }) {
  const C = useC();
  const box = (
    <View style={{ backgroundColor: C.inset, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 13, gap: 2, overflow: "hidden" }}>
      <T s={12} lh={16} c={C.ink2} lines={1} style={{ letterSpacing: 0 }}>{label}</T>
      {text !== undefined ? <T f={F.tile} s={18} lh={24} c={tone ? toneColor(C, tone) : onPress ? C.accent : C.ink}>{text}</T> : <M v={v} f={F.tile} s={18} />}
      <SheenFill tone={C.accent} strength={0.09} every={6400} id="m" />
      <T s={11.5} lh={15} c={C.ink3} lines={2}>{sub}</T>
    </View>
  );
  return <View style={{ flex: 1 }}>{onPress ? <Press onPress={onPress} accessibilityLabel={label}>{box}</Press> : box}</View>;
}

/** Which card to use today: the one whose bill you'd pay latest (the most interest-free days). */
function BestToday({ cards, first, i }) {
  const C = useC();
  const ok = cards.filter((c) => !carrying(c)).map((c) => ({ c, d: floatDays(c) })).sort((a, b) => b.d - a.d);
  if (!ok.length) return null;
  const best = ok[0], rest = ok.slice(1);
  return (
    <Panel title="Best card to use today" kind="w" i={i} first={first} info onInfo={() => openSheet("about-float")}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Ic name="card" tone="pos" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T f={F.semi} s={15} lh={21} lines={1}>{E.cardShort(best.c.key)}</T>
          <T s={13.5} lh={18} c={C.ink2}>{"Spend today, pay by " + E.fmt(best.c.c.nextDue) + ": " + best.d + " days interest-free"}</T>
        </View>
      </View>
      {rest.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {rest.map((x) => <Chip key={x.c.key} small label={E.cardShort(x.c.key).replace(/ ·\d+$/, "") + " · " + x.d + " days"} onPress={() => setParamsCard(x.c.key)} />)}
        </View>
      ) : null}
    </Panel>
  );
}
const setParamsCard = (k) => require("../nav").go("cards", { card: k });

function CardBlock({ c, i, first }) {
  const C = useC();
  const deal = useRef(new Animated.Value(motionOn() && first ? 0 : 1)).current;
  const det = useRef(new Animated.Value(motionOn() ? 0 : 1)).current;
  useEffect(() => {
    if (!motionOn()) return;
    // entrance()/enter(): if the screen is frozen before these finish, they carry on when it's back, never left half-faded
    if (first) entrance(deal, (d) => Animated.timing(deal, { toValue: 1, duration: 760, easing: S.liquid.ease, delay: d, useNativeDriver: NATIVE }), 60 + i * 90);
    enter(det, S.block, { delay: (first ? 160 : 40) + i * 90 });
  }, []);
  const st = standing(c);
  const lim = limitOf(c.key);
  return (
    <View style={{ marginBottom: 18, gap: 10 }}>
      <Animated.View style={{ opacity: deal.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }), transform: [{ perspective: 900 },
        { translateY: deal.interpolate({ inputRange: [0, 1], outputRange: [-(i * 70) - 30, 0] }) }, { rotateX: deal.interpolate({ inputRange: [0, 1], outputRange: ["18deg", "0deg"] }) },
        { scale: deal.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }}>
        <Face c={c} status={st.badge} />
      </Animated.View>
      <Animated.View style={{ opacity: det, transform: [{ translateY: det.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
        <View style={{ backgroundColor: C.surface, boxShadow: C.card, borderRadius: 22, padding: 16 }}>
          <TrayCtx.Provider value="w">
          <Action c={c} st={st} />
          <Timeline c={c} st={st} delay={(first ? 260 : 120) + i * 90} />
          {lim ? <LimitBar c={c} lim={lim} delay={(first ? 320 : 160) + i * 90} /> : null}
          <ThisCycle c={c} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 6, marginTop: 16, alignItems: "center" }}>
            <Btn kind={st.owe ? "solid" : "ghost"} small label="Record payment" onPress={() => openSheet("pay:" + c.key)} />
            <Btn kind="link" small label="Payments" onPress={() => openSheet("payments:" + c.key)} />
            <Btn kind="link" small label={lim ? "Limit" : "Add limit"} onPress={() => openSheet("limit:" + c.key)} />
            {c.source === "alerts" || c.source === "you" ? <Btn kind="link" small label={c.hasOverride ? "Edit bill" : "Bill differs?"} onPress={() => openSheet("stmt:" + c.key)} /> : null}
          </View>
          {c.preFirst ? null : <T s={12} lh={16} c={C.ink3} style={{ marginTop: 10 }}>{"Bill " + E.sourceNote(c) + "."}</T>}
          </TrayCtx.Provider>
        </View>
      </Animated.View>
    </View>
  );
}

/** The one line that matters: what to pay, by when, how long is left (or that it's settled, and what's next). */
function Action({ c, st }) {
  const C = useC();
  const lateFrom = E.addDays(st.due, 3);
  if (st.overdue) {
    const past3 = E.days(lateFrom, today()) > 0;
    return (
      <View>
        <T f={F.head} s={18} lh={25} c={C.alert}>{"Pay "}<M v={c.billedLeft} f={F.head} s={18} c={C.alert} />{" now"}</T>
        <T s={14} lh={20} c={C.alert} style={{ marginTop: 2 }}>{"It was due " + E.fmt(st.due) + " (" + plural(-c.dueIn, "day") + " ago)."}</T>
        <T s={13.5} lh={19} c={C.ink2} style={{ marginTop: 6 }}>
          {past3 ? "It's more than 3 days late, so the bank can now charge a late fee and report it to the credit bureaus. Interest runs from each purchase date until it's paid."
            : "Banks can charge a late fee or report it only after 3 days past the due date: pay by " + E.fmt(lateFrom) + " to avoid both. Paid it from somewhere these emails don't cover? Record it."}
        </T>
      </View>
    );
  }
  if (st.owe) {
    const tone = c.dueIn <= 1 ? C.alert : c.dueIn <= 5 ? C.warn : C.ink2;
    return (
      <View>
        <T f={F.head} s={18} lh={25}>{"Pay "}<M v={c.billedLeft} f={F.head} s={18} />{" by " + E.fmt(st.due)}</T>
        <T f={F.medium} s={14} lh={20} c={tone} style={{ marginTop: 2 }}>{c.dueIn === 0 ? "Due today" : c.dueIn === 1 ? "1 day left" : c.dueIn + " days left"}{c.toBilled >= 0.5 ? (hidden() ? "" : " · " + exact(c.toBilled) + " of " + exact(c.billed) + " paid") : ""}</T>
        {c.prevUnpaid >= 0.5 ? <T s={13.5} lh={19} c={C.alert} style={{ marginTop: 6 }}>{"Includes " + (hidden() ? "an amount" : exact(c.prevUnpaid)) + " still unpaid from the " + E.fmt(c.c.prevStmt) + " bill."}</T> : null}
        {c.minDue ? <T s={13} lh={18} c={C.ink3} style={{ marginTop: 6 }}>{"Minimum " + (hidden() ? "₹ ••••" : money(c.minDue)) + ". Paying only the minimum keeps the card in good standing, but interest then runs on every purchase and new ones lose their interest-free days."}</T> : null}
      </View>
    );
  }
  const head = c.preFirst ? "First bill on " + E.fmt(c.c.nextStmt) : c.billed < 0.5 && c.prevUnpaid < 0.5 ? "Nothing billed on " + E.fmt(c.c.stmt) : "Bill paid in full ✓";
  return (
    <View>
      <T f={F.head} s={18} lh={25} c={c.preFirst ? C.ink : C.pos}>{head}</T>
      <T s={14} lh={20} c={C.ink2} style={{ marginTop: 2 }}>{c.preFirst ? "Due " + E.fmt(c.c.nextDue) : "Next bill " + E.fmt(c.c.nextStmt) + ", due " + E.fmt(c.c.nextDue)}</T>
      {c.credit > 0.5 ? <T s={13.5} lh={19} c={C.pos} style={{ marginTop: 6 }}>{(hidden() ? "Some" : exact(c.credit)) + " paid ahead sits as credit on the card."}</T> : null}
    </View>
  );
}

/** The billing cycle as a line: this statement → its due date → the next statement → its due date, with today on
    it, and what spending today means. */
function Timeline({ c, st, delay }) {
  const C = useC();
  const [w, setW] = useState(0);
  const a = Math.min(c.c.stmt.getTime(), st.due.getTime()), b = c.c.nextDue.getTime(), x = (d) => (w * (d.getTime() - a)) / (b - a);
  const t = today(), tx = Math.max(0, Math.min(w, x(t)));
  const grow = useRef(new Animated.Value(motionOn() ? 0 : 1)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!motionOn()) return;
    entrance(grow, (d) => Animated.timing(grow, { toValue: 1, duration: 900, delay: d, easing: S.soft.ease, useNativeDriver: false }), delay);
    const l = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: NATIVE }), Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: NATIVE })]));
    const tm = setTimeout(() => l.start(), delay + 900);
    return () => { clearTimeout(tm); l.stop(); };
  }, []);
  const billCol = c.preFirst ? C.line2 : st.overdue ? C.alert : st.owe ? (c.dueIn <= 5 ? C.warn : C.ink) : C.pos;
  const marks = [
    { d: c.c.stmt, top: false, l: c.preFirst ? "Cycle" : "Bill", s: E.fmt(c.c.stmt) },
    { d: st.due, top: true, l: st.owe ? "Due" : "Was due", s: E.fmt(st.due), col: billCol },
    { d: c.c.nextStmt, top: false, l: "Next bill", s: E.fmt(c.c.nextStmt) },
    { d: c.c.nextDue, top: true, l: "Due", s: E.fmt(c.c.nextDue) },
  ];
  const fd = floatDays(c);
  return (
    <View style={{ marginTop: 18 }}>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: 80, marginHorizontal: 6 }}>
        {w ? (
          <>
            <View style={{ position: "absolute", left: 0, right: 0, top: 38, height: 2, borderRadius: 1, backgroundColor: C.line2 }} />
            <Animated.View style={{ position: "absolute", left: Math.min(x(c.c.stmt), x(st.due)), top: 37, height: 4, borderRadius: 2, backgroundColor: billCol,
              width: grow.interpolate({ inputRange: [0, 1], outputRange: [0, Math.abs(x(st.due) - x(c.c.stmt))] }) }} />
            <Animated.View style={{ position: "absolute", left: x(c.c.nextStmt), top: 37, height: 4, borderRadius: 2, backgroundColor: C.info, opacity: 0.55,
              width: grow.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, x(c.c.nextDue) - x(c.c.nextStmt))] }) }} />
            {marks.map((m, k) => {
              const px = x(m.d), edge = px < 40 ? "start" : px > w - 40 ? "end" : "mid";
              return (
                <React.Fragment key={k}>
                  <View style={{ position: "absolute", left: px - 4, top: 35, width: 8, height: 8, borderRadius: 4, backgroundColor: m.col || C.ink3 }} />
                  <View style={{ position: "absolute", top: m.top ? 0 : 48, width: 84, left: edge === "start" ? Math.max(-6, px - 4) : edge === "end" ? Math.min(w + 6, px + 4) - 84 : px - 42,
                    alignItems: edge === "start" ? "flex-start" : edge === "end" ? "flex-end" : "center" }}>
                    <T f={F.medium} s={11.5} lh={14} c={m.col || C.ink2}>{m.l}</T>
                    <T s={11} lh={14} c={C.ink3}>{m.s}</T>
                  </View>
                </React.Fragment>
              );
            })}
            <View style={{ position: "absolute", left: tx - 8, top: 31, width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
              <Animated.View style={{ position: "absolute", width: 16, height: 16, borderRadius: 8, backgroundColor: C.accent, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }] }} />
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: C.accent, borderWidth: 2, borderColor: C.surface }} />
            </View>
          </>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, backgroundColor: C.inset, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent }} />
        <T s={13} lh={18} c={C.ink2} style={{ flex: 1 }}>
          {carrying(c) ? "Today: new spending on this card starts charging interest until the old bill is fully paid."
            : "Today: spend on this card and you pay it by " + E.fmt(c.c.nextDue) + ", " + fd + " days interest-free."}
        </T>
      </View>
    </View>
  );
}

/** How much of the limit is in use: billed and unpaid, spent since the statement, and what's left; a mark at 30%. */
function LimitBar({ c, lim, delay }) {
  const C = useC();
  const billed = Math.max(0, c.billedLeft), since = Math.max(0, c.unbilledLeft), used = billed + since;
  const pct = Math.round((used / lim) * 100), tone = pct <= 30 ? "pos" : pct <= 90 ? "warn" : "alert";
  const w = (v) => Math.min(100, (v / lim) * 100);
  const grow = useRef(new Animated.Value(motionOn() ? 0 : 1)).current;
  useEffect(() => { if (motionOn()) entrance(grow, (d) => Animated.timing(grow, { toValue: 1, duration: 800, delay: d, easing: S.soft.ease, useNativeDriver: false }), delay); }, []);
  const seg = (v, col, k) => <Animated.View key={k} style={{ height: 10, backgroundColor: col, width: grow.interpolate({ inputRange: [0, 1], outputRange: ["0%", w(v) + "%"] }) }} />;
  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <T f={F.medium} s={14.5} lh={19}>{"Using " + pct + "% of the limit"}</T>
        <T s={13} lh={17} c={toneColor(C, tone)}>{pct <= 30 ? "healthy" : pct <= 90 ? "above 30%" : "near the limit"}</T>
      </View>
      <View>
        <View style={{ height: 10, borderRadius: 5, backgroundColor: C.inset, overflow: "hidden", flexDirection: "row" }}>
          {seg(billed, st_ink(C), "b")}{seg(since, C.info, "u")}
        </View>
        <View style={{ position: "absolute", left: "30%", top: -3, height: 16, width: 2, marginLeft: -1, borderRadius: 1, backgroundColor: C.ink2 }} />
        <T s={10.5} lh={13} c={C.ink3} style={{ position: "absolute", left: "30%", top: 14, marginLeft: -8 }}>30%</T>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 2, marginTop: 18 }}>
        <Leg col={st_ink(C)} label="billed, unpaid" v={billed} /><Leg col={C.info} label="since the bill" v={since} /><Leg col={C.inset} label="available" v={Math.max(0, lim - used)} />
      </View>
    </View>
  );
}
const st_ink = (C) => C.ink;
function Leg({ col, label, v }) {
  const C = useC();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: col, borderWidth: col === C.inset ? 1 : 0, borderColor: C.line2 }} />
      <T s={12.5} lh={17} c={C.ink2}>{label + " "}</T><M v={v} s={12.5} lh={17} c={C.ink2} />
    </View>
  );
}

/** What's on the card since the statement, by category (top four); tap for the transactions. */
function ThisCycle({ c }) {
  const C = useC();
  const from = c.preFirst ? -Infinity : endOfDay(c.c.stmt);
  const by = {};
  E.allTx().forEach((x) => { if (x.card === c.key && x.dir === "out" && x.ts > from) by[x.cat] = (by[x.cat] || 0) + x.amt; });
  const list = Object.entries(by).sort((a, b) => b[1] - a[1]);
  if (!list.length) return null;
  const top = list.slice(0, 4), rest = list.slice(4).reduce((a, x) => a + x[1], 0), tot = list.reduce((a, x) => a + x[1], 0);
  if (rest > 0) top.push(["Everything else", rest]);
  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <T f={F.medium} s={14.5} lh={19}>{c.preFirst ? "Spent so far" : "Spent since " + E.fmt(c.c.stmt)}</T>
        <M v={tot} f={F.semi} s={14.5} lh={19} />
      </View>
      <View style={{ flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", gap: 2, marginBottom: 8 }}>
        {top.map(([k, v]) => <View key={k} style={{ flex: v, backgroundColor: k === "Everything else" ? C.line2 : catHue(k) }} />)}
      </View>
      {top.map(([k, v]) => (
        <Press key={k} scale={0.99} onPress={() => goTo({ view: "activity", card: c.key, cat: k === "Everything else" ? "" : k })} accessibilityLabel={k + " on " + E.cardShort(c.key)}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 }}>
            <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: k === "Everything else" ? C.line2 : catHue(k) }} />
            <T s={13.5} lh={18} c={C.ink2} style={{ flex: 1 }} lines={1}>{k}</T>
            <T s={12.5} lh={17} c={C.ink3}>{Math.round((v / tot) * 100) + "%"}</T>
            <M v={v} s={13.5} lh={18} c={C.ink} />
          </View>
        </Press>
      ))}
    </View>
  );
}

/** .face: the card itself, 1.586:1, with a highlight, faint stripes and a chip; tilts under your finger (the sheen follows). */
function Face({ c, status }) {
  const F_ = faceOf(c.key), ink = F_.ink;
  const [box, setBox] = useState({ width: 340, height: 214 });
  const rx = useRef(new Animated.Value(0)).current, ry = useRef(new Animated.Value(0)).current, sh = useRef(new Animated.Value(0)).current;
  const lx = useSharedValue(box.width * 0.22), ly = useSharedValue(box.height * 0.18), lon = useSharedValue(0);
  const tilt = (e) => {
    if (!motionOn()) return;
    const { locationX: x, locationY: y } = e.nativeEvent;
    rx.setValue(((y / box.height) - 0.5) * -10); ry.setValue(((x / box.width) - 0.5) * 12); sh.setValue(x / box.width);
    lx.value = withSpring(x, rs(S.small)); ly.value = withSpring(y, rs(S.small)); lon.value = withTiming(1, { duration: 140 });
  };
  const settle = () => {
    Animated.parallel([springTo(rx, 0, S.small), springTo(ry, 0, S.small)]).start();
    lon.value = withTiming(0, { duration: 700 }); lx.value = withSpring(box.width * 0.22, rs(S.soft)); ly.value = withSpring(box.height * 0.18, rs(S.soft));
  };
  const paidPct = c.billed > 0 ? Math.min(100, (c.toBilled / c.billed) * 100) : 0;
  const nums = c.members.map((m) => E.CARD_CFG[m].last4).join(" · ");
  const bg = status[1] === "pos" ? ["#E9F2EC", "#173A29"] : status[1] === "alert" ? ["#F7E1DC", "#7A2416"] : status[1] === "warn" ? ["#F6EFDF", "#5E4510"] : ["rgba(255,255,255,0.16)", ink];
  const stripes = [];
  for (let k = -20; k < 30; k++) stripes.push(<Line key={k} x1={k * 9} y1={0} x2={k * 9 + 60} y2={100} stroke="#FFFFFF" strokeOpacity={0.035} strokeWidth={2} />);
  return (
    <Press scale={0.985} haptic onPress={() => goTo({ view: "activity", card: c.key })} accessibilityLabel={c.cfg.short + ": see its transactions"}
      onPressIn={(e) => tilt(e)} onPressOut={settle} style={{ alignSelf: "center", width: "100%", maxWidth: 440 }}>
      <Animated.View onLayout={(e) => setBox(e.nativeEvent.layout)} onTouchMove={tilt}
        style={{ aspectRatio: 1.586, borderRadius: 20, overflow: "hidden", paddingTop: 18, paddingHorizontal: 20, paddingBottom: 16, justifyContent: "space-between",
          shadowColor: "#000", shadowOpacity: 0.32, shadowRadius: 14, shadowOffset: { width: 0, height: 10 }, elevation: 7,
          transform: [{ perspective: 800 }, { rotateX: rx.interpolate({ inputRange: [-10, 10], outputRange: ["-10deg", "10deg"] }) }, { rotateY: ry.interpolate({ inputRange: [-10, 10], outputRange: ["-10deg", "10deg"] }) }] }}>
        <Svg style={{ position: "absolute", left: 0, top: 0 }} width={box.width} height={box.height} viewBox="0 0 159 100" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id={"fg" + c.key} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={F_.g[0]} /><Stop offset="0.55" stopColor={F_.g[1]} /><Stop offset="1" stopColor={F_.g[2]} /></LinearGradient>
            <RadialGradient id={"fh" + c.key} cx="88%" cy="-15%" r="75%"><Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.2} /><Stop offset="0.6" stopColor="#FFFFFF" stopOpacity={0} /></RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="159" height="100" fill={"url(#fg" + c.key + ")"} />
          <G>{stripes}</G>
          <Rect x="0" y="0" width="159" height="100" fill={"url(#fh" + c.key + ")"} />
        </Svg>
        <SheenFill strength={0.13} every={7200} id={"f" + c.key} />
        {GL ? <CardLight w={box.width} h={box.height} lx={lx} ly={ly} on={lon} /> : (
        <Animated.View pointerEvents="none" style={{ position: "absolute", top: -40, bottom: -40, width: 90, backgroundColor: "rgba(255,255,255,0.07)", transform: [{ rotate: "18deg" },
          { translateX: sh.interpolate({ inputRange: [0, 1], outputRange: [-60, box.width] }) }] }} />)}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <T f={F.title} s={16} lh={21} c={ink} lines={1} style={{ flexShrink: 1 }}>{E.cardShort(c.key)}</T>
          <View style={{ height: 22, paddingHorizontal: 9, borderRadius: 11, backgroundColor: bg[0], justifyContent: "center" }}><T f={F.semi} s={11.5} lh={14} c={bg[1]} style={{ letterSpacing: 0 }}>{status[0]}</T></View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ width: 40, height: 30, borderRadius: 7, overflow: "hidden", backgroundColor: "#B9B9B4" }}>
            <Svg width={40} height={30}>
              <Defs><LinearGradient id="chip" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#E4E4E0" /><Stop offset="0.5" stopColor="#A9A9A4" /><Stop offset="1" stopColor="#D2D2CD" /></LinearGradient></Defs>
              <Rect x={0} y={0} width={40} height={30} fill="url(#chip)" />
              <Line x1={0} y1={10} x2={40} y2={10} stroke="rgba(0,0,0,0.25)" strokeWidth={1} /><Line x1={0} y1={20} x2={40} y2={20} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
              <Line x1={14} y1={0} x2={14} y2={30} stroke="rgba(0,0,0,0.25)" strokeWidth={1} /><Line x1={26} y1={0} x2={26} y2={30} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
            </Svg>
          </View>
          <T s={13} lh={18} c={ink} style={{ letterSpacing: 1.6, opacity: 0.8 }} lines={1}>{"•••• " + nums}</T>
        </View>
        <View>
          <T s={12} lh={15} c={ink} style={{ opacity: 0.72 }}>On the card</T>
          <M v={c.owed} f={F.fig} s={27} c={ink} style={{ lineHeight: 32 }} />
          <View style={{ height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", marginTop: 8, marginRight: 86, overflow: "hidden" }}>
            <View style={{ width: paidPct + "%", height: 4, backgroundColor: "#EDEDEB" }} />
          </View>
          <T s={11.5} lh={14} c={ink} style={{ opacity: 0.8, marginTop: 5 }}>{c.billed > 0 ? (hidden() ? "••••" : amt(c.toBilled) + " of " + amt(c.billed) + " paid") : "nothing billed yet"}</T>
        </View>
        <T f={F.bold} s={11.5} lh={15} c={ink} style={{ position: "absolute", right: 18, bottom: 14, letterSpacing: 0.6, opacity: 0.85, fontStyle: "italic" }}>{F_.net}</T>
      </Animated.View>
    </Press>
  );
}
