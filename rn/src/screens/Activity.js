/* Activity: search, filters, every transaction. */
import React, { useEffect, useRef, useState } from "react";
import { Animated, TextInput, View } from "react-native";
import { E } from "../store";
import { nav, setParams, openSheet } from "../nav";
import { useC, F } from "../theme";
import { T, amt, Rows, Row, CatIc, DayHead, Note, Chips, Chip, Btn, Rise, TrayCtx, nice, acctShort, dayName, hidden, Page } from "../kit";
import { Icon } from "../icons";
import { S, springTo } from "../motion";

const FILTERS = [["all", "All"], ["out", "Money out"], ["in", "Money in"], ["cards", "Cards"], ["bank", "Bank"], ["edited", "Edited by you"]];

export function txMatches(p) {
  const f = p.f || "all", q = (p.q || "").toLowerCase().trim();
  const { cat, card, acct, m, d } = p;
  const dd = d ? E.parseISO(d) : null;
  const num = q.replace(/[₹,\s]/g, "");
  return E.allTx().filter((x) => {
    if (f === "out" && x.dir !== "out") return false;
    if (f === "in" && x.dir !== "in") return false;
    if (f === "cards" && x.kind !== "card") return false;
    if (f === "bank" && (x.kind !== "bank" || x.man)) return false;
    if (f === "edited" && !(x.man || x.noted || x.ruled)) return false;
    if (cat && x.cat !== cat) return false;
    if (card && x.card !== card) return false;
    if (acct && x.account !== acct) return false;
    if (m && x.ym !== m) return false;
    if (dd && !(x.ym === E.ymOf(dd) && x.day === dd.getDate())) return false;
    if (q) {
      const hay = (x.desc + " " + x.cat + " " + (x.note || "") + " " + x.account).toLowerCase();
      const amtHit = /^\d+(\.\d+)?$/.test(num) && (String(Math.round(x.amt)).indexOf(num) >= 0 || x.amt.toFixed(2).indexOf(num) >= 0);
      if (hay.indexOf(q) < 0 && !amtHit) return false;
    }
    return true;
  });
}

export function TxRow({ x, first }) {
  const nm = nice(x.desc), bits = [acctShort(x)];
  if (x.cat === "Card payment") bits.push(x.payOther ? "card ·" + x.payOther + " (not tracked)" : x.payCard ? "paid " + E.cardShort(x.payCard) + (x.payConfirmed ? ", confirmed" : "") : "which card?");
  else bits.push(x.cat);
  if (x.sms) bits.push("from SMS");
  if (x.forOther) bits.push("for someone else");
  else if (x.paidBack) bits.push("comes off spending");
  else if (!x.counted && x.dir === "out") bits.push("not counted");
  if (nm.extra) bits.push(nm.extra);
  if (x.note) bits.push("“" + x.note + "”");
  return <Row first={first} icon={<CatIc cat={x.dir === "in" && x.cat === "Money in" ? "Money in" : x.cat} />} title={nm.title} detail={bits.join(" · ")}
    value={amt(x.amt, { sign: x.dir === "in" ? "in" : "out" })} tone={x.dir === "in" ? "pos" : ""} sub={E.clockOf(x)} uncounted={!(x.counted || x.dir === "in")}
    onPress={x.sms ? () => openSheet("sms:" + x.id) : () => openSheet("tx:" + x.id)} />;
}

export default function Activity({ first }) {
  const C = useC();
  const p = nav.params;
  const [q, setQ] = useState(p.q || "");
  const [shown, setShown] = useState(60);
  const [focus, setFocus] = useState(false);
  const fv = useRef(new Animated.Value(0)).current;
  const t = useRef(null);
  useEffect(() => { setQ(p.q || ""); setShown(60); }, [nav.seq]);
  useEffect(() => { springTo(fv, focus ? 1 : 0, S.icon).start(); }, [focus]);
  const onQ = (v) => { setQ(v); clearTimeout(t.current); t.current = setTimeout(() => { setShown(60); setParams((x) => { x.q = v.trim(); }); }, 150); };
  const list = txMatches(p), slice = list.slice(0, shown);
  const S_ = require("../native/sms");
  const sms = !S_.counting() && (!p.f || p.f === "all" || p.f === "out") ? S_.pending() : [];   // when SMS counts first they're in the list itself
  const active = [];
  if (p.cat) active.push(["cat", p.cat]);
  if (p.card) active.push(["card", E.cardShort(p.card)]);
  if (p.acct) active.push(["acct", p.acct]);
  if (p.m) active.push(["m", E.ymName(p.m)]);
  if (p.d) active.push(["d", dayName(E.parseISO(p.d))]);
  const out = [];
  let last = null;
  slice.forEach((x) => {
    const key = x.ym + "-" + x.day;
    if (key !== last) {
      const [y, mo] = x.ym.split("-").map(Number), d = new Date(y, mo - 1, x.day);
      const dayTotal = E.spendOf(list.filter((tx) => tx.ym === x.ym && tx.day === x.day)).spend;
      out.push(<DayHead key={"h" + key} left={dayName(d) + (Math.abs(E.days(d, E.sod(new Date()))) > 1 ? "" : " · " + E.fmt(d))} right={dayTotal >= 0.5 ? (hidden() ? "••••" : amt(dayTotal)) + " spent" : ""} />);
      last = key;
    }
    out.push(<TxRow key={x.id} x={x} />);
  });
  return (
    <Page id="activity" one>
      <Rise i={0} first={first}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: C.surface, boxShadow: C.card, borderWidth: 1, borderColor: focus ? C.accent : "transparent", marginBottom: 12 }}>
          <Animated.View style={{ transform: [{ rotate: fv.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-12deg"] }) }, { scale: fv.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] }}>
            <Icon name="search" size={19} color={focus ? C.accent : C.ink3} />
          </Animated.View>
          <TextInput placeholder="Search payee, category, amount or note" placeholderTextColor={C.ink3} value={q} onChangeText={onQ} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
            accessibilityLabel="Search transactions" style={{ flex: 1, fontFamily: F.body, fontSize: 15, letterSpacing: -0.18, color: C.ink, paddingVertical: 0, includeFontPadding: false }} />
          {q ? <Icon name="close" size={16} color={C.ink3} /> : null}
        </View>
      </Rise>
      <Rise i={1} first={first} style={{ marginBottom: 6 }}>
        <Chips scroll small value={p.f || "all"} onChange={(v) => { setShown(60); setParams((x) => { x.f = v === "all" ? "" : v; }); }} options={FILTERS} />
      </Rise>
      {active.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {active.map(([k, v]) => <Chip key={k} small on removable label={v} accessibilityLabel={"Remove filter " + v} onPress={() => { setShown(60); setParams((x) => { x[k] = ""; }); }} />)}
        </View>
      ) : null}
      {sms.length && !p.q && !active.length ? (
        <Rise i={2} first={first}>
          <View style={{ backgroundColor: C.tray, borderRadius: 22, padding: 12, marginBottom: 10 }}>
            <TrayCtx.Provider value="tray">
              <DayHead first left="From your SMS · waiting for the bank's email" />
              <Rows>{sms.map((x) => <TxRow key={x.id} x={x} />)}</Rows>
            </TrayCtx.Provider>
          </View>
        </Rise>
      ) : null}
      <Rise i={3} first={first}>
        <View style={{ backgroundColor: C.tray, borderRadius: 22, padding: 12 }}>
          <TrayCtx.Provider value="tray">
          {list.length ? <Rows>{out}</Rows> : <Note style={{ paddingVertical: 24, textAlign: "center" }}>{E.DATA_IN ? "Nothing matches." : "Loading…"}</Note>}
          {list.length > slice.length ? <Btn kind="ghost" full label={"Show " + Math.min(120, list.length - slice.length) + " more of " + list.length} onPress={() => setShown(shown + 120)} style={{ marginTop: 10 }} /> : null}
          </TrayCtx.Provider>
        </View>
      </Rise>
    </Page>
  );
}
