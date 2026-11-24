/* Rewards: which card to pay with. Top to bottom: what each card earned this month (tap one for every spend, how it
   earned and its caps) → the search ("Which card for…?") and its answer (the best of your cards and the way to pay;
   your other cards; the cards you could get that would do better) → what you left on the table this month, as
   "next time, use …" → your next card → milestones and fee waivers → your settings (Prime, what a mile is worth, the
   income used) and where the numbers come from. Points are shown as points (₹ only to compare cards, and for a
   cashback card like Amazon Pay ICICI). The maths and the card rules are app/rewards.js. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { E } from "../store";
import { nav, setParams, openSheet } from "../nav";
import { useC, F, darkCard } from "../theme";
import { T, M, Panel, Rows, Row, Ic, Note, Badge, Chip, Seg, Switch, Btn, Press, Tile, Bar, SubHead, More, plural, buzz, hidden, nice, cap, Page } from "../kit";
import { SelectField } from "../form";
import { Icon } from "../icons";
import { Amount, Line } from "./Trips";
import { askAI, askWeb, notText } from "../ask";
import { openLink } from "../nav";

/* ---------------- how things are written ---------------- */
/** A rupee value: one decimal under ₹10 ("₹2.5"), whole rupees above. */
export const rs = (v) => (hidden() ? "₹ ••••" : v > 0 && v < 10 ? "₹" + (Math.round(v * 10) / 10).toLocaleString("en-IN") : "₹" + Math.round(v || 0).toLocaleString("en-IN"));
const pct = (v, amt) => (amt > 0 ? (Math.round((v / amt) * 1000) / 10).toLocaleString("en-IN") + "%" : "");
const ptsOf = (n) => (hidden() ? "••••" : Math.round(n).toLocaleString("en-IN"));
/** What a card earned, in its own terms: "1,234 pts" on a points card, "₹56" on a cashback card, "120 NeuCoins". */
export const earnText = (card, n) => (card.unit === "points" ? ptsOf(n) + " pts" : card.unit === "cashback" ? rs(n) : ptsOf(n) + " " + card.unit);
/** What points are worth, for the line under them: "≈ ₹617" or "≈ ₹1,260 as Air India points". Nothing for cashback. */
const worthSub = (card, worth) => (card.unit === "cashback" ? "" : "≈ " + rs(worth.best) + (worth.partner && worth.miles > worth.cash ? " as " + E.REW_PARTNER[worth.partner] + " points" : ""));
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
      <ThisMonth m={m} first={first} />
      <Search m={m} first={first} />
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
  // the AI's "not" adds to the app's own; a shop that's ruled out isn't where you pay
  if (sp) { sp.not = Array.from(new Set((parsed.not || []).concat(ai && ai.q === q && ai.sp.not ? ai.sp.not : []))); if (sp.shop && sp.not.includes(sp.shop)) sp.shop = null; }
  const res = sp ? E.rewSearch(sp) : null;
  return (
    <>
      <Panel title="Which card for…?" kind="w" i={1} first={first}>
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
      {res ? <WebCheck key={webKey(q, res.sp)} q={q} res={res} first={first} /> : null}
      {res ? <Yours res={res} first={first} /> : null}
      {res ? <Could res={res} first={first} /> : null}
    </>
  );
}
/** "Understood as": what the search took your words to mean, each part changeable. */
function Understood({ sp, typed, edit, setEdit, asking, ai }) {
  const C = useC();
  const set = (k, v) => setEdit(Object.assign({}, edit, { [k]: v }));
  const parts = understoodParts(sp);
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

const understoodParts = (sp) => [E.rewKind(sp.kind).name, sp.shop ? "at " + shopName(sp.shop) : null, sp.amt ? rs(sp.amt) : rs(1000) + " (no amount given)",
  sp.intl ? "in a foreign currency" : sp.online ? "online" : "in a shop", notText(sp.not)].filter(Boolean);
const webKey = (q, sp) => [String(q).trim().toLowerCase(), sp.kind, sp.shop, sp.amt, sp.online, sp.intl, (sp.not || []).join(",")].join("|");

/** "From the web": today's terms of your cards for this spend, read from the web by an AI, next to the app's own
    sum, with the pages it read. Only when you tap it (each check uses a little of the free allowance). */
function WebCheck({ q, res, first }) {
  const C = useC();
  const [st, setSt] = useState({ s: "idle" });
  const go = () => {
    buzz("tick"); setSt({ s: "busy" });
    const cards = res.yours.map((y) => ({ name: y.card.name, short: y.short, addOn: y.addOn })).concat(res.unknown.map((u) => ({ name: u.short, short: u.short, addOn: u.addOn })));
    const t = res.top && res.top.best;
    const app = t ? { card: res.top.card.name, how: t.how, earn: Math.round(t.pts) + " " + (res.top.card.unit || ""), value: Math.round(t.net), rate: t.rate, notes: t.notes } : null;
    askWeb(webKey(q, res.sp), { text: String(q).slice(0, 300), understood: understoodParts(res.sp).join(" · "), cards, app })
      .then((o) => { buzz(o.ok ? "confirm" : "error"); setSt(o.ok ? { s: "done", v: o } : { s: "err", why: o.why }); });
  };
  const v = st.v || {}, b = v.best || {};
  const host = (u) => String(u).replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  return (
    <Panel title="From the web" kind="w" i={3} first={first} right={st.s === "done" ? <Badge text={v.agree ? "Agrees with the app" : "Differs from the app"} tone={v.agree ? "pos" : "warn"} /> : null}>
      {st.s === "idle" ? <>
        <Note>Card terms change often. Check today's terms on the web: an AI reads the banks' pages and reviews for your cards and this spend, and says which card it would use.</Note>
        <View style={{ flexDirection: "row", marginTop: 10 }}><Btn small label="Check on the web" onPress={go} /></View>
      </> : null}
      {st.s === "busy" ? <T s={14} c={C.ink2} style={{ paddingVertical: 6 }}>Searching the web and reading your cards' terms… about 10 seconds</T> : null}
      {st.s === "err" ? <>
        <Note tone="warn">{st.why}</Note>
        <View style={{ flexDirection: "row", marginTop: 10 }}><Btn small kind="link" label="Try again" onPress={go} /></View>
      </> : null}
      {st.s === "done" ? <>
        <T f={F.title} s={20} lh={26}>{b.card}</T>
        {b.how ? <T s={14} c={C.ink2} style={{ marginTop: 2 }}>{b.how}</T> : null}
        <T s={15} style={{ marginTop: 6 }}><T f={F.semi} s={15}>{b.earn}</T>{b.value > 0 && !/₹/.test(b.earn || "") ? " ≈ " + rs(b.value) : ""}{b.rate > 0 ? " (" + Math.round(b.rate * 10) / 10 + "%)" : ""}</T>
        {v.why ? <T s={14.5} lh={21} style={{ marginTop: 10 }}>{v.why}</T> : null}
        {(v.others || []).length ? <Rows style={{ marginTop: 8 }}>{v.others.filter((o) => o.card).map((o, i) => <Row key={i} soft title={o.card} detail={o.note}
          value={(o.earn || "") + (o.value > 0 && !/₹/.test(o.earn || "") ? " · " + rs(o.value) : "")} />)}</Rows> : null}
        {(v.watch || []).filter(Boolean).map((w, i) => <Note key={"w" + i} tone="warn" style={{ marginTop: 8 }}>{w}</Note>)}
        {(v.sources || []).length ? (
          <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line, gap: 8 }}>
            <T s={13} c={C.ink3}>From these pages</T>
            {v.sources.filter((x) => /^https?:/.test(x.url)).map((x, i) => (
              <Press key={i} haptic={false} onPress={() => openLink(x.url)} accessibilityRole="link" accessibilityLabel={x.title}>
                <T s={14} lh={19} c={C.accent}>{x.title}</T>
                <T s={12} c={C.ink3}>{host(x.url) + (x.date ? " · " + String(x.date).slice(0, 10) : "")}</T>
              </Press>
            ))}
          </View>
        ) : null}
        <T s={12.5} c={C.ink3} style={{ marginTop: 12 }}>Read from the web by an AI just now. It can be wrong: check the bank's own page before a big spend.</T>
      </> : null}
    </Panel>
  );
}

/* ---------------- 2 · the answer ---------------- */
function Answer({ res, first }) {
  const C = darkCard(useC());
  const top = res.top, sp = res.sp, kind = E.rewKind(sp.kind).name;
  if (top && top.best && !(top.best.net > 0.004) && top.best.fee && top.best.worth.best > 0) {
    return (
      <Panel title="Best card" kind="d" i={2} first={first}>
        <T f={F.head} s={20} lh={26}>{"Every card of yours costs more than it earns here"}</T>
        <T s={14.5} lh={21} c={C.ink2} style={{ marginTop: 6 }}>{top.short + " earns " + rs(top.best.worth.best) + " but its " + top.card.fx + "% foreign-currency markup is " + rs(top.best.fee) + "."}</T>
        {res.better ? <T s={14.5} lh={21} c={C.ink2} style={{ marginTop: 6 }}>{res.better.card.name + " would come out " + rs(res.better.best.net) + " ahead."}</T> : null}
      </Panel>
    );
  }
  if (!top || !(top.best.net > 0.004)) {
    return (
      <Panel title="Best card" kind="d" i={2} first={first}>
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
    <Panel title={"Best card · " + kind.toLowerCase()} kind="d" i={2} first={first}>
      <T f={F.head} s={22} lh={28}>{top.short}</T>
      <T s={14.5} lh={21} c={C.ink2} style={{ marginTop: 2 }}>{wayText(w)}</T>
      <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: 10, marginTop: 10 }}>
        <M text={both ? ptsOf(w.pts) : rs(w.net)} f={F.hero} s={40} />
        <T f={F.medium} s={15} c={C.ink2}>{both ? "points · ≈ " + rs(w.net) + " (" + pct(w.net, sp.amt) + ") on " + rs(sp.amt) : pct(w.net, sp.amt) + " back on " + rs(sp.amt)}</T>
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        {both ? (
          <>
            <Tile label="As cash" value={rs(w.worth.cash)} sub={card.cash ? card.cash.how : ""} />
            <Tile label="As miles" value={w.worth.partner ? rs(w.worth.miles) : "—"} sub={w.worth.partner ? ptsOf(w.pts) + " pts → " + E.REW_PARTNER[w.worth.partner] : "no airline partner"} />
          </>
        ) : <Tile label={cap(unitOf(card))} value={rs(w.worth.cash)} sub={card.cash ? card.cash.how : ""} />}
      </View>
      {both ? <T s={13} lh={18} c={C.ink3} style={{ marginTop: 8 }}>{"At " + (Math.round(w.rate * 100) / 100) + " points per ₹100"}</T> : null}
      {res.runner ? <T s={13.5} lh={19} c={C.ink2} style={{ marginTop: 10 }}>{"Next best: " + res.runner.short + ", " + earnText(res.runner.card, res.runner.best.pts) + (res.runner.card.unit === "cashback" ? "" : " (≈ " + rs(res.runner.best.net) + ")") + (wayText(res.runner.best) === "Pay with this card" ? "" : " · " + wayText(res.runner.best).replace(/^Pay with this card · /, ""))}</T> : null}
      {notes.map((t, i) => <Note key={i} style={{ marginTop: i ? 0 : 10, marginBottom: i === notes.length - 1 ? 0 : 6 }}>{t}</Note>)}
    </Panel>
  );
}
function Yours({ res, first }) {
  if (res.yours.length < 2 && !res.unknown.length) return null;
  return (
    <Panel title="Your cards for this" i={3} first={first}>
      <Rows>
        {res.yours.map((y, i) => (
          <Row key={y.g} first={i === 0} icon={<Ic name="cards" />} title={y.short} detail={y.best ? wayText(y.best) : ""}
            value={y.best && y.best.net > 0 ? earnText(y.card, y.best.pts) : "—"} sub={y.best && y.best.net > 0 ? (y.card.unit === "cashback" ? pct(y.best.net, res.sp.amt) : "≈ " + rs(y.best.net)) : "earns nothing"} soft={!(y.best && y.best.net > 0)} />
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
    <Panel title="If you had…" i={4} first={first}>
      {rows.length ? (
        <Rows>
          {rows.map((x, i) => (
            <Row key={x.card.id} first={i === 0} icon={<Ic name="cards" />} title={<>{x.card.name + "  "}<Badge text={"+" + rs(x.best.net - mine)} tone="pos" /></>}
              detail={wayText(x.best)} value={earnText(x.card, x.best.pts)} sub={x.card.unit === "cashback" ? pct(x.best.net, res.sp.amt) : "≈ " + rs(x.best.net)} />
          ))}
        </Rows>
      ) : <Note>None of the cards open to you would do better than yours on this.</Note>}
      <Note style={{ marginTop: 10, marginBottom: 4 }}>{(inc.amt ? "Cards whose published income bar is within " + (inc.from === "you" ? "the income you set" : "your salary (gross, for a year)") : "Your income isn't set, so every open card is counted") + ". Cards that don't publish one are counted too. The bank still decides each application."}</Note>
      <View style={{ alignItems: "flex-start", paddingHorizontal: 6 }}><Btn kind="link" small label={inc.from ? "Change the income used" : "Set your income"} onPress={() => openSheet("trip-income")} /></View>
    </Panel>
  );
}

/* ---------------- 1 · this month ---------------- */
function ThisMonth({ m, first }) {
  const C = useC();
  const rows = m.month.filter((h) => h.card), unknown = m.month.filter((h) => !h.card);
  if (!rows.length) return null;
  const total = rows.reduce((s, h) => s + h.worth.best, 0), spends = rows.reduce((s, h) => s + h.n, 0);
  return (
    <Panel title={"Earned this month · " + E.MONFULL[new Date().getMonth()]} i={0} first={first}>
      <Note>{spends ? "From " + plural(spends, "card spend") + " the app has seen, worth about " + rs(total) + " in all. Tap a card to see every spend and how it earned." : "No card spending yet this month."}</Note>
      <Rows>
        {rows.map((h, i) => {
          const capLine = h.full ? " · " + capShort(h.full) + " cap " + Math.round((h.full.used / h.full.max) * 100) + "% used" : "";
          return (
            <Row key={h.g} first={i === 0} icon={<Ic name="cards" />} title={h.short} chevron onPress={() => openSheet("rewcard:" + h.g)}
              detail={(h.n ? plural(h.n, "spend") + " · " + rs(h.spent) : "nothing yet") + capLine}
              value={earnText(h.card, h.pts)} sub={h.card.unit === "cashback" ? "cashback" : worthSub(h.card, h.worth)} soft={!h.n} />
          );
        })}
      </Rows>
      {unknown.length ? <Note style={{ marginTop: 10, marginBottom: 0 }}>{"Not worked out (their rules aren't in the app yet): " + unknown.map((h) => h.short).join(", ") + "."}</Note> : null}
    </Panel>
  );
}
const capShort = (c) => (c.name.length > 26 ? c.name.slice(0, 24).trim() + "…" : c.name);

/** One card this month: every spend, how it earned (the everyday rate, a bonus, or why it earned nothing) and its caps. */
export function RewCardSheet({ g }) {
  const C = useC();
  const h = E.rewMonth().find((x) => x.g === g);
  if (!h || !h.card) return <Note>The app doesn't have this card's rules yet.</Note>;
  const card = h.card, eff = h.spent > 0 ? (h.pts / h.spent) * 100 : 0;
  const caps = h.caps.filter((c) => c.per !== "quarter" && (c.used > 0 || /bonus/.test(c.name)));
  const notes = [];
  if (h.addOn) notes.push("Yours is an add-on card: the points land with the main cardholder.");
  if (card.note) notes.push(card.note);
  notes.push("Worked out from the card's published rules and the spends the app has seen. Your statement has the final number.");
  return (
    <View>
      <T s={13.5} lh={18} c={C.ink3}>{E.MONFULL[new Date().getMonth()] + " so far"}</T>
      <M text={earnText(card, h.pts)} f={F.fig} s={36} style={{ lineHeight: 42 }} />
      <T s={14} lh={20} c={C.ink2}>{card.unit === "cashback" ? (card.cash ? cap(card.cash.how) : "") : worthSub(card, h.worth) + (card.cash ? " · cash value " + rs(h.worth.cash) + " " + card.cash.how : "")}</T>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
        <Tile label="Spent on it" value={rs(h.spent)} sub={plural(h.n, "spend")} />
        <Tile label="Earned on average" value={h.n ? rewRate(card, eff) : "—"} sub="across every spend" />
      </View>
      {h.ways.length ? (
        <>
          <SubHead>How you earned them</SubHead>
          <Rows>
            {h.ways.map((w, i) => (
              <Row key={w.text + w.why} first={i === 0} icon={<Ic name={w.none ? "close" : "spark"} tone={w.none ? undefined : "info"} />} title={w.none ? (w.why || "Earns nothing") : w.text}
                detail={plural(w.n, "spend") + " · " + rs(w.amt)} value={w.none ? "0" : earnText(card, w.pts)} soft={w.none} />
            ))}
          </Rows>
        </>
      ) : null}
      {caps.length ? (
        <>
          <SubHead>Caps this month</SubHead>
          <CapBars list={caps} />
        </>
      ) : null}
      {h.items.length ? (
        <>
          <SubHead>Every spend</SubHead>
          <Rows>
            {h.items.map((x, i) => (
              <Row key={x.id} first={i === 0} icon={<Ic name={x.pts > 0 ? "spark" : "close"} tone={x.pts > 0 ? "info" : undefined} />} title={nice(x.desc).title}
                detail={E.fmt(new Date(x.ts)) + " · " + (x.pts > 0 ? x.how : x.why || "earns nothing") + (x.capped ? " · over a cap" : "") + (x.forOther ? " · for someone else" : "")}
                value={x.pts > 0 ? "+" + earnText(card, x.pts) : "0"} sub={rs(x.amt)} soft={!(x.pts > 0)} onPress={() => openSheet("tx:" + x.id)} />
            ))}
          </Rows>
        </>
      ) : <Note style={{ marginTop: 12 }}>No spending on this card yet this month.</Note>}
      {notes.map((t, i) => <Note key={i} style={{ marginTop: i ? 0 : 14, marginBottom: 6 }}>{t}</Note>)}
    </View>
  );
}
const rewRate = (card, rate) => E.rewRateText(card, rate);

/** Caps as bars: how much of each is used this month. */
function CapBars({ list }) {
  const C = useC();
  return list.map((c, i) => {
    const p = Math.min(100, (c.used / c.max) * 100), unit = c.on === "extra" ? "bonus points" : "points";
    return (
      <View key={c.id} style={{ marginTop: i ? 14 : 2 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <T f={F.medium} s={14} lh={19} style={{ flex: 1 }} lines={2}>{c.name}</T>
          <T f={F.semi} s={13.5} lh={19} c={p >= 90 ? C.alert : C.ink2}>{ptsOf(c.used) + " of " + ptsOf(c.max)}</T>
        </View>
        <T s={12.5} lh={16} c={C.ink3} style={{ marginBottom: 6 }}>{unit + " a " + (c.per === "cycle" ? "statement" : "month") + (p >= 100 ? " · full: more spending here earns less" : "")}</T>
        <Bar pct={p} color={p >= 90 ? C.alert : undefined} delay={i * 60} />
      </View>
    );
  });
}

/* ---------------- 3 · left on the table ---------------- */
function Missed({ m, first }) {
  const C = useC();
  const x = m.missed;
  if (!x.n || !x.cards) return null;
  const share = x.could > 0 ? Math.min(100, (x.got / x.could) * 100) : 100;
  return (
    <Panel title="Left on the table this month" i={5} first={first}>
      <T f={F.head} s={21} lh={27}>{x.gap >= 1 ? rs(x.gap) + " more was possible" : "You used your best card every time"}</T>
      <T s={14} lh={20} c={C.ink2} style={{ marginTop: 2 }}>{x.gap >= 1 ? "with the cards you already have, paying the way shown below." : "on all " + plural(x.n, "spend") + " this month."}</T>
      <View style={{ marginTop: 12 }}>
        <Bar pct={share} height={8} color={x.gap >= 1 ? C.warn : C.pos} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
          <T s={12.5} c={C.ink3}>{"You earned " + rs(x.got)}</T>
          <T s={12.5} c={C.ink3}>{"Best possible " + rs(x.could)}</T>
        </View>
      </View>
      {x.tips.length ? (
        <>
          <SubHead>Next time</SubHead>
          {x.tips.map((t, i) => <Tip key={t.card.id + t.kind} t={t} first={i === 0} />)}
        </>
      ) : null}
      <Note style={{ marginTop: 12, marginBottom: 0 }}>Every spend this month against the best of your cards for it, paid straight on the card, with the caps counted. ₹ is used here only to compare cards whose points are worth different amounts. Money sent to people isn't counted.</Note>
    </Panel>
  );
}
/** "For food delivery, use Amazon Pay ICICI": the spends, what it would have earned, what you got. */
function Tip({ t, first }) {
  const C = useC();
  const got = t.from.map((f) => (f.card ? earnText(f.card, f.pts) + " on " + f.short : "nothing (paid by bank or UPI)")).join(", ");
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderTopColor: C.line }}>
      <Ic name="spark" tone="warn" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T f={F.semi} s={15} lh={20}>{(t.kind === "other" ? "For other spends" : "For " + t.kindName.toLowerCase()) + ", use " + t.short}</T>
        <T s={13} lh={18} c={C.ink2} style={{ marginTop: 2 }}>{"It would have earned " + earnText(t.card, t.bestPts) + " on " + plural(t.n, "spend") + " (" + rs(t.amt) + "). You got " + got + "."}</T>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <T f={F.semi} s={15} lh={20} c={C.warn}>{"+" + rs(t.gap)}</T>
        <T s={12} lh={16} c={C.ink3}>more</T>
      </View>
    </View>
  );
}

/* ---------------- 4 · your next card ---------------- */
function Next({ m, first }) {
  const x = m.next, rows = x.rows.filter((r) => r.net > 0).slice(0, 4);
  const basis = x.basis === "months" ? "your last " + plural(x.n, "full month") : "this month so far";
  return (
    <Panel title="Your next card" i={6} first={first}>
      <Note>{"What each card open to you would earn in a year on " + basis + " of spending, counting only the spends where it beats your cards. The ₹ under it is that extra, after the card's yearly fee."}</Note>
      {rows.length ? (
        <Rows>
          {rows.map((r, i) => (
            <Row key={r.card.id} first={i === 0} icon={<Ic name="cards" />} title={r.card.name}
              detail={(r.top.length ? "Wins on " + r.top.join(" and ") + " · " : "") + (r.waived ? "fee waived by the spending" : r.fee ? "fee " + rs(r.fee) : "no fee")}
              value={"+" + earnText(r.card, r.card.unit === "cashback" ? r.year : r.ptsYear)} sub={"a year · " + (r.card.unit === "cashback" && !r.fee ? "" : "≈ ") + rs(r.net) + (r.fee && !r.waived ? " after fee" : "")} tone="pos" />
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
