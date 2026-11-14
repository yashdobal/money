/* Rewards: which card to pay with. Top to bottom: the search ("What are you buying?") and its answer (the best of
   your cards and the way to pay, worth as cash and as miles; your other cards; the cards you could get that would do
   better) → this month's points on each card → the caps used → what you left on the table this month → your next
   card → milestones and fee waivers → your settings (Prime, what a mile is worth, the income used) and where the
   numbers come from. The maths and the card rules are app/rewards.js. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { E } from "../store";
import { nav, setParams, openSheet } from "../nav";
import { useC, F, darkCard } from "../theme";
import { T, M, Panel, Rows, Row, Ic, Note, Badge, Chip, Seg, Switch, Btn, Press, Tile, Bar, More, plural, buzz, hidden, nice, cap, Page } from "../kit";
import { SelectField } from "../form";
import { Icon } from "../icons";
import { Amount, Line } from "./Trips";
import { askAI } from "../ask";

/* ---------------- how things are written ---------------- */
/** A rupee value: one decimal under ₹10 ("₹2.5"), whole rupees above. */
export const rs = (v) => (hidden() ? "₹ ••••" : v > 0 && v < 10 ? "₹" + (Math.round(v * 10) / 10).toLocaleString("en-IN") : "₹" + Math.round(v || 0).toLocaleString("en-IN"));
const pct = (v, amt) => (amt > 0 ? (Math.round((v / amt) * 1000) / 10).toLocaleString("en-IN") + "%" : "");
const ptsOf = (n) => Math.round(n).toLocaleString("en-IN");
const shopName = (id) => (id ? (E.rewShop(id) || {}).name : "");
const unitOf = (card) => (card.unit === "points" ? "points" : card.unit === "cashback" ? "cashback" : card.unit);
/** How to pay, in words: "Pay at Amazon with this card", "Book on HDFC SmartBuy", "Buy a Swiggy gift voucher on …". */
export function wayText(w) {
  if (!w) return "";
  if (w.route === "card") {
    const where = w.at ? "Pay at " + shopName(w.at) + " with this card" : "Pay with this card";
    return w.label && w.label !== "On the card" ? where + " · " + w.label : where;
  }
  return w.how + (w.at && !/voucher/.test(w.route) && w.route !== "amazonpay" ? " (" + shopName(w.at) + ")" : "");
}
/** What it's worth, both ways: "₹600 as cash · ₹1,260 as Accor points". */
function worthLine(card, w) {
  if (card.unit !== "points") return rs(w.worth.cash) + " " + (card.cash ? card.cash.how : "");
  const parts = [rs(w.worth.cash) + " as cash"];
  if (w.worth.partner) parts.push(rs(w.worth.miles) + " as " + E.REW_PARTNER[w.worth.partner] + " points");
  return parts.join(" · ");
}

export default function Rewards({ first }) {
  const m = E.rewardsModel();
  return (
    <Page id="rewards">
      <Search m={m} first={first} />
      <ThisMonth m={m} first={first} />
      <Caps m={m} first={first} />
      <Missed m={m} first={first} />
      <Next m={m} first={first} />
      <Goals m={m} first={first} />
      <Prefs m={m} first={first} />
    </Page>
  );
}

/* ---------------- 1 · the search ---------------- */
const EXAMPLES = ["Flight to Tokyo 40k", "Swiggy order 600", "New iPhone 80,000", "Myntra 4,000", "Electricity bill 2,500", "Dinner in Dubai 5,000"];
function Search({ m, first }) {
  const C = useC();
  const q = nav.params.q || "";
  const [text, setText] = useState(q);
  const [edit, setEdit] = useState({});          // what you changed in "Understood as"
  const [ai, setAi] = useState(null);            // {q, sp} from the AI, when it answers
  const [asking, setAsking] = useState(false);
  const seq = useRef(0);
  useEffect(() => { setText(q); setEdit({}); }, [q]);
  useEffect(() => {
    if (!q) { setAi(null); return; }
    const my = ++seq.current;
    setAsking(true);
    askAI(q).then((sp) => { if (my === seq.current) { setAi(sp ? { q, sp } : null); setAsking(false); } }, () => { if (my === seq.current) setAsking(false); });
  }, [q]);
  const go = (t) => { const v = String(t || "").trim(); buzz("tick"); setParams((p) => { p.q = v || undefined; }); };
  const parsed = useMemo(() => (q ? E.rewParse(q) : null), [q]);
  const sp = parsed ? Object.assign({}, parsed, ai && ai.q === q ? ai.sp : {}, edit) : null;
  const res = sp ? E.rewSearch(sp) : null;
  return (
    <>
      <Panel title="What are you buying?" kind="w" i={0} first={first}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingHorizontal: 14, borderRadius: 16, backgroundColor: C.inset }}>
          <View style={{ flexShrink: 0 }}><Icon name="search" size={19} color={C.ink3} /></View>
          <TextInput value={text} onChangeText={setText} onSubmitEditing={() => go(text)} returnKeyType="search" placeholder="A flight, a phone, a Swiggy order…" placeholderTextColor={C.ink3}
            accessibilityLabel="What are you buying?" autoCorrect={false}
            style={{ flex: 1, fontFamily: F.body, fontSize: 16, color: C.ink, paddingVertical: 12, includeFontPadding: false }} />
          {text ? <Press onPress={() => { setText(""); go(""); }} scale={0.9} accessibilityLabel="Clear"><Icon name="close" size={17} color={C.ink3} /></Press> : null}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 10 }}><Btn small label="Find the best card" onPress={() => go(text)} disabled={!text.trim()} /></View>
        {!q ? (
          <View style={{ marginTop: 6 }}>
            <Note style={{ marginBottom: 8 }}>Say what it is, and the amount if you know it. Try:</Note>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{EXAMPLES.map((x) => <Chip key={x} small label={x} onPress={() => { setText(x); go(x); }} />)}</View>
          </View>
        ) : null}
        {sp ? <Understood sp={sp} typed={parsed} edit={edit} setEdit={setEdit} asking={asking} ai={!!(ai && ai.q === q)} /> : null}
      </Panel>
      {res ? <Answer res={res} first={first} /> : null}
      {res ? <Yours res={res} first={first} /> : null}
      {res ? <Could res={res} first={first} /> : null}
    </>
  );
}
/** "Understood as": what the search took your words to mean, each part changeable. */
function Understood({ sp, typed, edit, setEdit, asking, ai }) {
  const C = useC();
  const set = (k, v) => setEdit(Object.assign({}, edit, { [k]: v }));
  const parts = [E.rewKind(sp.kind).name, sp.shop ? "at " + shopName(sp.shop) : null, sp.amt ? rs(sp.amt) : rs(1000) + " (no amount given)", sp.intl ? "in a foreign currency" : sp.online ? "online" : "in a shop"].filter(Boolean);
  return (
    <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line }}>
      <T s={13} lh={18} c={C.ink3}>{(ai ? "Understood as" : asking ? "Understood as (checking…)" : "Understood as") + ":"}</T>
      <T f={F.medium} s={14.5} lh={20} style={{ marginTop: 2 }}>{parts.join(" · ")}</T>
      <More label="Not what you meant?">
        <SelectField label="Kind of spending" value={sp.kind} options={E.REW_KINDS.map((k) => [k.id, k.name])} onChange={(v) => set("kind", v)} style={{ marginTop: 4 }} />
        <SelectField label="Shop" value={sp.shop || ""} options={[["", "No particular shop"]].concat(E.REW_SHOPS.filter((x) => x.id !== "smartbuy").map((x) => [x.id, x.name]))} onChange={(v) => set("shop", v || null)} style={{ marginTop: 10 }} />
        <Line label="Amount"><Amount plain value={sp.amt} placeholder="₹1,000" label="Amount in rupees" onDone={(v) => set("amt", v)} /></Line>
        <Line label="Where you pay"><Seg label="Where you pay" value={sp.online ? "on" : "off"} onChange={(v) => set("online", v === "on")} options={[["on", "Online"], ["off", "In a shop"]]} /></Line>
        <Line label="In a foreign currency"><Switch value={!!sp.intl} onChange={(v) => set("intl", v)} label="In a foreign currency" /></Line>
      </More>
    </View>
  );
}

/* ---------------- 2 · the answer ---------------- */
function Answer({ res, first }) {
  const C = darkCard(useC());
  const top = res.top, sp = res.sp, kind = E.rewKind(sp.kind).name;
  if (top && top.best && !(top.best.net > 0.004) && top.best.fee && top.best.worth.best > 0) {
    return (
      <Panel title="Best card" kind="d" i={1} first={first}>
        <T f={F.head} s={20} lh={26}>{"Every card of yours costs more than it earns here"}</T>
        <T s={14.5} lh={21} c={C.ink2} style={{ marginTop: 6 }}>{top.short + " earns " + rs(top.best.worth.best) + " but its " + top.card.fx + "% foreign-currency markup is " + rs(top.best.fee) + "."}</T>
        {res.better ? <T s={14.5} lh={21} c={C.ink2} style={{ marginTop: 6 }}>{res.better.card.name + " would come out " + rs(res.better.best.net) + " ahead."}</T> : null}
      </Panel>
    );
  }
  if (!top || !(top.best.net > 0.004)) {
    return (
      <Panel title="Best card" kind="d" i={1} first={first}>
        <T f={F.head} s={20} lh={26}>None of your cards earns on this</T>
        <T s={14.5} lh={21} c={C.ink2} style={{ marginTop: 6 }}>{top && top.best && top.best.notes[0] ? top.best.notes[0] : kind + " earns nothing on the cards you hold."}</T>
        {res.better ? <T s={14.5} lh={21} c={C.ink2} style={{ marginTop: 6 }}>{res.better.card.name + " would earn " + rs(res.better.best.worth.best) + " on it."}</T> : null}
      </Panel>
    );
  }
  const w = top.best, card = top.card, both = card.unit === "points";
  const notes = [];
  if (w.capped) notes.push("Part of this is over a monthly cap, so it earns less than the full rate (what you've already used this month is counted).");
  w.notes.forEach((n) => notes.push(n));
  if (w.fee) notes.push("The bank's " + card.fx + "% foreign-currency markup (" + rs(w.fee) + ") is taken off.");
  if (top.addOn) notes.push("Yours is an add-on card: the points land with the main cardholder.");
  if (card.note) notes.push(card.note);
  if (!res.typedAmt) notes.push("No amount given, so this is for ₹1,000.");
  return (
    <Panel title={"Best card · " + kind.toLowerCase()} kind="d" i={1} first={first}>
      <T f={F.head} s={22} lh={28}>{top.short}</T>
      <T s={14.5} lh={21} c={C.ink2} style={{ marginTop: 2 }}>{wayText(w)}</T>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 10 }}>
        <M text={rs(w.net)} f={F.hero} s={40} />
        <T f={F.medium} s={15} c={C.ink2}>{pct(w.net, sp.amt) + " back on " + rs(sp.amt)}</T>
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        {both ? (
          <>
            <Tile label="As cash" value={rs(w.worth.cash)} sub={card.cash ? card.cash.how : ""} />
            <Tile label="As miles" value={w.worth.partner ? rs(w.worth.miles) : "—"} sub={w.worth.partner ? ptsOf(w.pts) + " pts → " + E.REW_PARTNER[w.worth.partner] : "no airline partner"} />
          </>
        ) : <Tile label={cap(unitOf(card))} value={rs(w.worth.cash)} sub={card.cash ? card.cash.how : ""} />}
      </View>
      {both ? <T s={13} lh={18} c={C.ink3} style={{ marginTop: 8 }}>{ptsOf(w.pts) + " points at " + (Math.round(w.rate * 100) / 100) + " per ₹100"}</T> : null}
      {res.runner ? <T s={13.5} lh={19} c={C.ink2} style={{ marginTop: 10 }}>{"Next best: " + res.runner.short + ", " + rs(res.runner.best.net) + (wayText(res.runner.best) === "Pay with this card" ? "" : " (" + wayText(res.runner.best).replace(/^Pay with this card · /, "") + ")")}</T> : null}
      {notes.map((t, i) => <Note key={i} style={{ marginTop: i ? 0 : 10, marginBottom: i === notes.length - 1 ? 0 : 6 }}>{t}</Note>)}
    </Panel>
  );
}
function Yours({ res, first }) {
  if (res.yours.length < 2 && !res.unknown.length) return null;
  return (
    <Panel title="Your cards for this" i={2} first={first}>
      <Rows>
        {res.yours.map((y, i) => (
          <Row key={y.g} first={i === 0} icon={<Ic name="cards" />} title={y.short} detail={y.best ? wayText(y.best) : ""}
            value={y.best ? rs(y.best.net) : "—"} sub={y.best && y.best.net > 0 ? pct(y.best.net, res.sp.amt) : "earns nothing"} soft={!(y.best && y.best.net > 0)} />
        ))}
      </Rows>
      {res.unknown.length ? <Note style={{ marginTop: 10, marginBottom: 0 }}>{"Not counted (their rules aren't in the app yet): " + res.unknown.map((h) => h.short).join(", ") + "."}</Note> : null}
    </Panel>
  );
}
function Could({ res, first }) {
  const C = useC();
  const mine = res.top && res.top.best ? res.top.best.net : 0;
  const rows = res.could.filter((x) => x.best && x.best.net > mine + 0.5).slice(0, 3);
  const inc = res.income;
  return (
    <Panel title="If you had…" i={3} first={first}>
      {rows.length ? (
        <Rows>
          {rows.map((x, i) => (
            <Row key={x.card.id} first={i === 0} icon={<Ic name="cards" />} title={<>{x.card.name + "  "}<Badge text={"+" + rs(x.best.net - mine)} tone="pos" /></>}
              detail={wayText(x.best)} value={rs(x.best.net)} sub={pct(x.best.net, res.sp.amt)} />
          ))}
        </Rows>
      ) : <Note>None of the cards open to you would do better than yours on this.</Note>}
      <Note style={{ marginTop: 10, marginBottom: 4 }}>{(inc.amt ? "Cards whose published income bar is within " + (inc.from === "you" ? "the income you set" : "your salary (gross, for a year)") : "Your income isn't set, so every open card is counted") + ". Cards that don't publish one are counted too. The bank still decides each application."}</Note>
      <View style={{ alignItems: "flex-start", paddingHorizontal: 6 }}><Btn kind="link" small label={inc.from ? "Change the income used" : "Set your income"} onPress={() => openSheet("trip-income")} /></View>
    </Panel>
  );
}

/* ---------------- 3 · this month ---------------- */
function ThisMonth({ m, first }) {
  const rows = m.month.filter((h) => h.card);
  if (!rows.length) return null;
  const total = rows.reduce((s, h) => s + h.worth.best, 0);
  return (
    <Panel title={"Points this month · " + E.MONFULL[new Date().getMonth()]} i={4} first={first}>
      <Note>{"Worth about " + rs(total) + " (the better of cash or miles on each card), from the spending the app has seen on each card."}</Note>
      <Rows>
        {rows.map((h, i) => (
          <Row key={h.g} first={i === 0} icon={<Ic name="cards" />} title={h.short} detail={plural(h.n, "spend") + " · " + rs(h.spent)}
            value={rs(h.worth.best)} sub={h.card.unit === "points" ? ptsOf(h.pts) + " points" : "cashback"} />
        ))}
      </Rows>
    </Panel>
  );
}
function Caps({ m, first }) {
  const C = useC();
  const list = [];
  m.month.filter((h) => h.card).forEach((h) => h.caps.forEach((c) => { if (c.per !== "quarter") list.push(Object.assign({ short: h.short }, c)); }));
  const shown = list.filter((c) => c.used > 0).concat(list.filter((c) => !(c.used > 0) && /bonus/.test(c.name))).slice(0, 6);
  if (!shown.length) return null;
  return (
    <Panel title="Caps this month" kind="w" i={5} first={first}>
      {shown.map((c, i) => {
        const p = (c.used / c.max) * 100, unit = c.on === "extra" ? "bonus points" : "points";
        return (
          <View key={c.short + c.id} style={{ marginTop: i ? 14 : 2 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <T f={F.medium} s={14} lh={19} style={{ flex: 1 }} lines={2}>{c.name}</T>
              <T f={F.semi} s={13.5} lh={19} c={p >= 90 ? C.alert : C.ink2}>{ptsOf(c.used) + " of " + ptsOf(c.max)}</T>
            </View>
            <T s={12.5} lh={16} c={C.ink3} style={{ marginBottom: 6 }}>{c.short + " · " + unit + " a " + (c.per === "cycle" ? "statement" : "month")}</T>
            <Bar pct={p} color={p >= 90 ? C.alert : undefined} delay={i * 60} />
          </View>
        );
      })}
    </Panel>
  );
}

/* ---------------- 4 · left on the table ---------------- */
function Missed({ m, first }) {
  const x = m.missed;
  if (!x.n || !x.cards) return null;
  return (
    <Panel title="Left on the table this month" i={6} first={first}>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
        <Tile label="You earned" value={rs(x.got)} />
        <Tile label="Could have" value={rs(x.could)} sub={x.gap >= 1 ? "+" + rs(x.gap) + " more" : "you got it all"} tone={x.gap >= 1 ? "warn" : "pos"} />
      </View>
      {x.misses.length ? (
        <Rows>
          {x.misses.map((y, i) => (
            <Row key={y.x.id || i} first={i === 0} icon={<Ic name="spark" />} title={nice(y.x.desc).title}
              detail={rs(y.x.amt) + " · " + (y.x.card ? "on " + E.cardShort(y.x.card) : "paid by bank or UPI") + " · best: " + (y.card ? y.card.name : "")} value={"+" + rs(y.gap)} tone="warn" />
          ))}
        </Rows>
      ) : null}
      <Note style={{ marginTop: 10, marginBottom: 0 }}>Each spend against the best of your cards paid straight on the card, with the caps counted. Money sent to people isn't counted.</Note>
    </Panel>
  );
}

/* ---------------- 5 · your next card ---------------- */
function Next({ m, first }) {
  const x = m.next, rows = x.rows.filter((r) => r.net > 0).slice(0, 4);
  const basis = x.basis === "months" ? "your last " + plural(x.n, "full month") : "this month so far";
  return (
    <Panel title="Your next card" i={7} first={first}>
      <Note>{"What each card open to you would add in a year on " + basis + " of spending, on the spends where it beats your cards, after its yearly fee."}</Note>
      {rows.length ? (
        <Rows>
          {rows.map((r, i) => (
            <Row key={r.card.id} first={i === 0} icon={<Ic name="cards" />} title={r.card.name}
              detail={(r.top.length ? "Wins on " + r.top.join(" and ") + " · " : "") + (r.waived ? "fee waived by the spending" : r.fee ? "fee " + rs(r.fee) : "no fee")}
              value={"+" + rs(r.net)} sub="a year" tone="pos" />
          ))}
        </Rows>
      ) : <Note>None of the cards open to you would beat yours after the fee.</Note>}
    </Panel>
  );
}

/* ---------------- 6 · milestones ---------------- */
function Goals({ m, first }) {
  const C = useC();
  if (!m.goals.length) return null;
  return (
    <Panel title="Milestones and fee waivers" kind="w" i={8} first={first}>
      {m.goals.map((g, i) => {
        const p = Math.min(100, (g.done / g.target) * 100), left = Math.max(0, g.target - g.done);
        return (
          <View key={g.g + g.what} style={{ marginTop: i ? 14 : 2 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <T f={F.medium} s={14} lh={19} style={{ flex: 1 }} lines={2}>{cap(g.what)}</T>
              <T f={F.semi} s={13.5} lh={19} c={left ? C.ink2 : C.pos}>{left ? rs(left) + " to go" : "Reached"}</T>
            </View>
            <T s={12.5} lh={16} c={C.ink3} style={{ marginBottom: 6 }}>{g.short + " · " + rs(g.done) + " of " + rs(g.target) + (g.per === "quarter" ? " this quarter" : " in the last 12 months") + (g.addOn ? " (the main card's spending counts too)" : "")}</T>
            <Bar pct={p} color={left ? undefined : C.pos} delay={i * 60} />
          </View>
        );
      })}
    </Panel>
  );
}

/* ---------------- 7 · settings and sources ---------------- */
/** A small rupee value with paise (what a point is worth): "1", "1.25". Empty puts the usual value back. */
function Rupees({ value, onDone, label }) {
  const C = useC();
  const [text, setText] = useState(null);
  const shown = text !== null ? text : String(Math.round(value * 100) / 100);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <T f={F.semi} s={15} c={C.ink3}>₹</T>
      <TextInput value={shown} onFocus={() => setText(shown)} onChangeText={(t) => setText(t.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))} keyboardType="decimal-pad" selectTextOnFocus accessibilityLabel={label}
        onBlur={() => { const v = parseFloat(text); const was = text; setText(null); if (isFinite(v) && v >= 0 && v <= 10) onDone(Math.round(v * 100) / 100); else if (was === "") onDone(null); }}
        style={{ width: 52, textAlign: "right", color: C.ink, fontFamily: F.semi, fontSize: 15, paddingVertical: 2, paddingHorizontal: 0, borderBottomWidth: 1.5, borderBottomColor: text !== null ? C.accent : C.line2, includeFontPadding: false }} />
    </View>
  );
}
function Prefs({ m, first }) {
  const C = useC();
  const p = m.prefs, D = m.data;
  const srcs = Object.keys(D.sources).map((k) => D.sources[k]);
  return (
    <Panel title="How it counts" kind="w" i={9} first={first}>
      <Line label="I have Amazon Prime" sub="Amazon Pay ICICI pays 5% on Amazon with Prime, 3% without">
        <Switch value={p.prime} onChange={(v) => E.act.setRew("prime", v ? null : false)} label="I have Amazon Prime" />
      </Line>
      <Line label="An Air India point is worth" sub="in rupees, for one Maharaja Club point">
        <Rupees value={p.ai} label="An Air India point in rupees" onDone={(v) => E.act.setRew("ai", v)} />
      </Line>
      <Line label="A KrisFlyer mile is worth" sub="in rupees, for one Singapore Airlines mile">
        <Rupees value={p.kf} label="A KrisFlyer mile in rupees" onDone={(v) => E.act.setRew("kf", v)} />
      </Line>
      <Note style={{ marginTop: 10 }}>{"An Accor point is worth " + rs(E.rewPartnerValue("accor")) + " (2,000 take €40 off a stay). Cards are ranked by the better of cash and miles."}</Note>
      <Note style={{ marginTop: 0 }}>{"Card rules were checked on " + E.fmt(E.parseISO(D.checked)) + " " + D.checked.slice(0, 4) + ". Banks change them often, a shop can be filed under a different kind of spending than you'd expect, and SmartBuy's daily brand deals aren't included. This is arithmetic to plan with, not financial advice."}</Note>
      <More label="Where the numbers come from">
        {srcs.map((s, i) => <T key={i} s={13} lh={18} c={C.ink2} style={{ marginTop: 8 }}>{s.name + " (" + s.at + ")"}</T>)}
      </More>
    </Panel>
  );
}
