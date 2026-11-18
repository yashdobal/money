/* Every bottom sheet: edit a transaction, add one, how Safe to spend is worked out, where you stand, the bank balance,
   balances, card payments and statements, goals, salary settings, fixed payments, payee rules, an SMS payment, and the
   (i) notes. Laid out as the Money app's sheets (app.css .sheet-body). */
import React, { useContext, useState } from "react";
import { PinSheet } from "./pin";
import { View, Linking } from "react-native";
import { E, toast } from "./store";
import { openSheet } from "./nav";
import { useC, F } from "./theme";
import { T, M, amt, exact, money, rup, nice, plural, inDays, cap, buzz, hidden, Rows, Row, Tile, Note, Badge, SubHead, CatIc, Chips, Chip, Gap, Seg, Switch, Btn, AddRow, XBtn, Press,
  catHue, toneColor, Legend, Ic } from "./kit";
import { Field, Row2, Actions, DateField, SelectField } from "./form";
import { BankChart, bankAhead } from "./charts";
import { TxRow } from "./screens/Activity";
import { coinsNext } from "./fx";
import { burst } from "./gl";
import { guard } from "./native/lock";
import { pts, span, monthOf, lakh, tripWhere, tripRatio, tripRate } from "./screens/Trips";
import { RewCardSheet } from "./screens/Rewards";

const useClose = () => useContext(require("./sheet").SheetCtx).close;
const ex = (v) => (hidden() ? "₹ ••••" : exact(v));
const num = (s) => String(s || "").replace(/[^\d.]/g, "");
const fail = (msg) => { toast(msg, { tone: "alert" }); buzz("error"); };

/** .set-row inside a sheet: a title and a line of detail, a switch on the right. */
function SwRow({ title, detail, value, onChange, first }) {
  const C = useC();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 62, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderTopColor: C.line }}>
      <View style={{ flex: 1 }}><T f={F.medium} s={15} lh={19}>{title}</T>{detail ? <T s={13} lh={17} c={C.ink3}>{detail}</T> : null}</View>
      <Switch value={value} onChange={onChange} label={title} />
    </View>
  );
}
/** .ex-fig: the sheet's big figure. */
function Big({ v, tone, sub, text }) {
  const C = useC();
  return (
    <View style={{ marginTop: 6, marginBottom: 8 }}>
      <M v={v} text={text} f={F.fig} s={36} tone={tone} style={{ lineHeight: 42 }} />
      {sub ? <T s={14} lh={20} c={C.ink2} style={{ marginTop: 2 }}>{sub}</T> : null}
    </View>
  );
}
/** .out-line: a grey box of plain words. */
function OutLine({ children }) {
  const C = useC();
  return <View style={{ marginTop: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: C.inset }}><T s={14} lh={20} c={C.ink2}>{children}</T></View>;
}
const SPEND_CATS = () => E.CATS.filter((c) => !E.NOT_SPENDING.has(c));
const NOT_SPEND_PICK = ["Cash & transfers", "Investments", "Money in", "Refunds"];
const IN_CATS = ["Salary", "Money in", "Refunds", "Cash & transfers", "Investments", "Other income", "Other"];
const ICON_OF = { Salary: "salary", "Other income": "Money in" };
const catOpt = (c) => [c, c, ICON_OF[c] || c, catHue(c)];

/* ---------------- one transaction ---------------- */
function TxSheet({ id }) {
  const close = useClose();
  const C = useC();
  const x = E.allTx().find((t) => t.id === id);
  const t = E.TX.find((y) => y.id === id), n = E.noteOf(id) || {}, rule = t ? E.ruleFor(t.desc) : null;
  const isPay = x && x.cat === "Card payment";
  const ruleOn = !!(rule && x && rule.category === x.cat);
  const [cat, setCat] = useState(x ? x.cat : "");
  const [card, setCard] = useState(x ? x.payCard || "" : "");
  const [always, setAlways] = useState(ruleOn);
  const [other, setOther] = useState(!!n.for_someone_else);
  const [back, setBack] = useState(!!(x && x.paidBack));
  const [note, setNote] = useState(n.note || "");
  const [fold, setFold] = useState(x ? NOT_SPEND_PICK.includes(x.cat) : false);
  if (!x) return <Note>This transaction isn't here any more.</Note>;
  const [y, m] = x.ym.split("-").map(Number), when = E.fmtD(new Date(y, m - 1, x.day)) + " " + y + (E.clockOf(x) ? " · " + E.clockOf(x) : "");
  if (x.reversed || x.refundOf) return <RevSheet x={x} when={when} />;
  const rev = !x.man && x.kind === "card" && x.dir === "out" ? E.revInfo(id) : null;
  const cats = x.dir === "in" ? IN_CATS : SPEND_CATS().filter((c) => !/unknown/.test(c) || c === x.cat);
  const nm = nice(x.desc), payee = nm.title.length > 30 ? nm.title.slice(0, 28) + "…" : nm.title;
  const save = () => {
    if (isPay) { if (card && card !== x.payCard) E.act.assignPayment(id, card); close(); toast("Saved"); buzz("confirm"); return; }
    const msg = E.act.saveEdit(id, { category: cat, always: !!t && always, ruleWas: ruleOn, forOther: other, paidBack: back, note: E.NOTES_OK ? note : n.note || "" });
    if (msg) return fail(msg);
    buzz("confirm"); close(); toast("Saved");
  };
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 6 }}>
        <CatIc cat={x.cat} size={48} radius={15} iconSize={22} />
        <View style={{ flex: 1 }}>
          <M v={x.amt} o={{ exact: true, sign: x.dir === "in" ? "in" : "out" }} f={F.fig} s={27} tone={x.dir === "in" ? "pos" : ""} style={{ lineHeight: 32 }} />
          <T s={13} lh={17} c={C.ink3}>{when + " · " + x.account}</T>
        </View>
      </View>
      <T f={F.medium} s={15} lh={21} style={{ marginTop: 6 }}>{nm.title}</T>
      {nm.extra ? <T s={13} lh={17} c={C.ink3}>{nm.extra}</T> : null}
      {isPay ? (
        <View>
          <SubHead>Which card did this pay?</SubHead>
          <Chips value={card} onChange={setCard} options={Object.keys(E.GROUPS).filter((k) => E.isOpen(k, x.ts) || k === x.payCard).map((k) => [k, E.cardShort(k)]).concat([["none", "Not a card payment"]])} />
          {x.payConfirmed ? <Note style={{ marginTop: 8 }}>A confirmation email already says which card; pick only if it's wrong.</Note> : null}
        </View>
      ) : (
        <View>
          <SubHead>Category</SubHead>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {cats.map((c) => <Chip key={c} label={c} on={c === cat} icon={ICON_OF[c] || c} iconColor={catHue(c)} onPress={() => setCat(c)} />)}
            {x.dir === "in" ? null : <Chip label="Not spending" dashed icon="down" onPress={() => setFold(!fold)} />}
            {fold && x.dir !== "in" ? NOT_SPEND_PICK.map((c) => <Chip key={c} label={c} on={c === cat} icon={ICON_OF[c] || c} iconColor={catHue(c)} onPress={() => setCat(c)} />) : null}
          </View>
          <View style={{ marginTop: 12 }}>
            {t ? <SwRow first title={"Always use this for " + payee} detail="saves a payee rule, for past and future payments" value={always} onChange={setAlways} /> : null}
          </View>
        </View>
      )}
      {E.NOTES_OK && x.dir === "out" && !isPay ? <SwRow title="Spent for someone else" detail="not your spending, and on a card bill it's left out of what you have to pay" value={other} onChange={setOther} /> : null}
      {t && x.dir === "in" && x.kind === "bank" ? <SwRow title="A friend paying me back" detail="comes off your spending, like a refund" value={back} onChange={setBack} /> : null}
      {E.NOTES_OK ? <Field label="Note" value={note} onChange={setNote} multiline maxLength={500} placeholder="Anything to remember about it" /> : null}
      {!E.NOTES_OK && E.DATA_IN ? <Note style={{ marginTop: 8 }}>Notes and "spent for someone else" need one database update first (see Settings).</Note> : null}
      {rev ? <Reverse id={id} x={x} rev={rev} /> : null}
      <Actions>
        {x.man ? <Btn kind="ghost" big full danger label="Delete" onPress={() => { E.act.delManual(id); close(); toast("Deleted"); }} /> : null}
        <Btn big full label="Save" onPress={save} />
      </Actions>
    </View>
  );
}

/** A card payment that was reversed or refunded: mark it (or undo the mark). Before its bill closed it's dropped from
    everything; after, the money comes back to the card today, off the next bill. */
function Reverse({ id, x, rev }) {
  const C = useC();
  const close = useClose();
  if (rev.on) return (
    <View style={{ marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: C.inset }}>
      <T f={F.semi} s={15} lh={20}>{"Refunded · " + E.fmt(E.parseISO(rev.on))}</T>
      <T s={13.5} lh={19} c={C.ink2} style={{ marginTop: 2 }}>{"It stays on the bill it was on, and " + ex(x.amt) + " comes off your next " + x.account + " bill. It no longer counts as spending or earns points."}</T>
      <View style={{ flexDirection: "row", marginTop: 10 }}><Btn small kind="ghost" label="Undo: not refunded" onPress={() => { E.act.unreverse(id); buzz("tick"); toast("Back as a normal payment"); }} /></View>
    </View>
  );
  const mark = () => {
    const msg = E.act.reverse(id);
    if (msg) return fail(msg);
    buzz("confirm"); close();
    toast(rev.billed ? "Marked as refunded: it comes off your next " + x.account + " bill" : "Marked as reversed: off the bill, your spending and points", { action: { label: "Undo", fn: () => E.act.unreverse(id) } });
  };
  return (
    <View style={{ marginTop: 16 }}>
      <SubHead>Reversed or refunded?</SubHead>
      {rev.match ? <Note style={{ marginBottom: 8 }}>{"A " + ex(rev.match.amt) + " refund came back to this card on " + E.fmt(new Date(rev.match.ts)) + ". If that was for this payment, it's already taken off and there's nothing to do."}</Note> : null}
      <Press onPress={mark} scale={0.985} accessibilityLabel="This payment was reversed or refunded">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.line2 }}>
          <Ic name="undo" tone="alert" size={34} radius={10} iconSize={18} />
          <View style={{ flex: 1 }}>
            <T f={F.semi} s={15} lh={20} c={C.alert}>This payment was reversed or refunded</T>
            <T s={13} lh={18} c={C.ink3}>{rev.billed ? "Its bill has closed, so the money comes off your next bill instead" : "Takes it off the card bill, your spending and points"}</T>
          </View>
        </View>
      </Press>
    </View>
  );
}
/** A reversed payment, or the refund you marked for one: what it means, and the way back. */
function RevSheet({ x, when }) {
  const C = useC();
  const close = useClose();
  const orig = x.refundOf ? E.allTx().find((t) => t.id === x.refundOf) : null;
  const nm = nice(orig ? orig.desc : x.desc);
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 6 }}>
        <Ic name="undo" tone={x.reversed ? "alert" : "info"} size={48} radius={15} iconSize={22} />
        <View style={{ flex: 1 }}>
          <M v={x.amt} o={{ exact: true, sign: x.dir === "in" ? "in" : "out" }} f={F.fig} s={27} tone={x.dir === "in" ? "pos" : ""} c={x.reversed ? C.ink3 : undefined} style={{ lineHeight: 32, textDecorationLine: x.reversed ? "line-through" : "none" }} />
          <T s={13} lh={17} c={C.ink3}>{when + " · " + x.account}</T>
        </View>
      </View>
      <T f={F.medium} s={15} lh={21} style={{ marginTop: 6 }}>{nm.title}</T>
      <OutLine>{x.reversed
        ? "You marked this payment as reversed, so it's left out of the card bill, your spending, Safe to spend and points. It stays here so you can undo it."
        : "The refund you marked for this payment" + (orig ? " (" + E.fmt(new Date(orig.ts)) + ")" : "") + ". It comes off the " + x.account + " bill after it, as a refund email would."}</OutLine>
      <Actions>
        <Btn big full kind="ghost" label={x.reversed ? "It wasn't reversed" : "It wasn't refunded"} onPress={() => { E.act.unreverse(x.refundOf || x.id); close(); buzz("tick"); toast("Back as a normal payment"); }} />
      </Actions>
    </View>
  );
}

/* ---------------- add money the alerts missed ---------------- */
function AddSheet({ preset }) {
  const close = useClose();
  const C = useC();
  const today = E.iso(E.sod(new Date())), yest = E.iso(E.addDays(E.sod(new Date()), -1));
  const p = preset || {};
  const [dir, setDir] = useState(p.dir || "out");
  const [value, setValue] = useState(p.amt ? String(p.amt) : "");
  const [desc, setDesc] = useState(p.desc || "");
  const [cat, setCat] = useState("Food & dining");
  const banks = E.BANKS, firstBank = banks[0] ? banks[0].key : "cash";
  const [acct, setAcct] = useState(p.acct || firstBank);
  const [kind, setKind] = useState("Salary");
  const [into, setInto] = useState(p.acct && E.bankByKey(p.acct) ? p.acct : banks.length > 1 ? banks[1].key : firstBank);
  const [when, setWhen] = useState(p.date && p.date !== today ? (p.date === yest ? "yest" : "pick") : "today");
  const [date, setDate] = useState(p.date || yest);
  const [err, setErr] = useState({});
  const PH = { Salary: "Salary from work", "Money in": "Who sent it", "Paid back": "A friend, for dinner", Refunds: "A shop's refund", "Other income": "What it's for" };
  const accts = banks.map((b) => [b.key, b.name + " (UPI)"]).concat(E.openGroups().map((k) => [k, E.cardShort(k)])).concat([["cash", "Cash"]]);
  const save = () => {
    const v = parseFloat(value);
    if (!(v > 0)) { setErr({ amt: "Enter the amount" }); return; }
    const words = desc.trim() || (dir === "in" ? (E.IN_PICK.find((q) => q[0] === kind) || [0, "Money in"])[1] : "");
    if (!words) { setErr({ desc: "Say what it was for" }); return; }
    const d = when === "today" ? today : when === "yest" ? yest : date;
    const msg = E.act.addManual(dir === "in" ? { t: words, amt: v, c: kind, date: d, acct: into, dir: "in" } : { t: words, amt: v, c: cat, date: d, acct });
    if (msg) return fail(msg);
    if (p.sms) require("./native/sms").dismiss(p.sms);
    buzz("confirm"); close(); toast(dir === "in" ? "Added " + rup(v) + " in" : "Added " + rup(v));
    if (dir === "in") coinsNext();
  };
  return (
    <View>
      <Seg full value={dir} onChange={setDir} options={[["out", "Money out"], ["in", "Money in"]]} label="Money out or in" />
      <Field big prefix="₹" value={value} onChange={(t) => { setValue(t); setErr({}); }} numeric error={err.amt} autoFocus={!p.amt} placeholder="0" label="Amount (₹)" />
      <Field label={dir === "in" ? "From / what for" : "What for"} value={desc} onChange={(t) => { setDesc(t); setErr({}); }} placeholder={dir === "in" ? PH[kind] || "" : "Auto to office"} maxLength={80} error={err.desc} />
      {dir === "out" ? (
        <View>
          <SubHead>Category</SubHead>
          <Chips value={cat} onChange={setCat} options={SPEND_CATS().filter((c) => !/unknown/.test(c)).map(catOpt)} />
          <SubHead>Paid with</SubHead>
          <Chips value={acct} onChange={setAcct} options={accts} />
        </View>
      ) : (
        <View>
          <SubHead>What is it</SubHead>
          <Chips value={kind} onChange={setKind} options={E.IN_PICK.map(([v, l]) => [v, l, ICON_OF[v] || v, catHue(v)])} />
          <SubHead>Received in</SubHead>
          <Chips value={into} onChange={setInto} options={banks.map((b) => [b.key, b.full]).concat([["cash", "Cash"]])} />
          <Note style={{ marginTop: 10 }}>A salary added here counts as that month's salary, and money into a bank goes into its balance.</Note>
        </View>
      )}
      <SubHead>When</SubHead>
      <Chips value={when} onChange={setWhen} options={[["today", "Today"], ["yest", "Yesterday"], ["pick", "Pick a date"]]} />
      {when === "pick" ? <DateField label="Date" value={date} onChange={setDate} max={today} /> : null}
      <Actions><Btn big full icon="plus" label={dir === "in" ? "Add money in" : "Add payment"} onPress={save} /></Actions>
    </View>
  );
}

/* ---------------- how the figure is worked out ---------------- */
function ExplainSheet() {
  const C = useC();
  const h = E.heroModel(E.allCards());
  const how = (
    <View>
      <T s={14.5} lh={21} c={C.ink2}>{"The app walks your bank balance (" + E.bankNames() + (E.BANKS.length > 1 ? " together" : "") + ") forward day by day until the day before the salary after next. It takes off every card bill on its due date (what's billed and what you've spent since), card EMIs, fixed payments, each salary and what it sends to " + (E.FAMILY ? E.FAMILY + ", " : "") + "SIP and emergency fund, and keeps your buffer aside."}</T>
      <T s={14.5} lh={21} c={C.ink2} style={{ marginTop: 10 }}>{"The figure is the most you can spend from now until payday without the balance dropping below " + (E.settings.buffer ? "your buffer" : "₹0") + " before the next money comes in; the \"a day\" figure spreads it evenly over the days left. Once this month's salary is in, it's also never more than your spending share left."}</T>
    </View>
  );
  if (h.state !== "ok") return how;
  const next = (p, label) => p ? <Row title={label + ": " + p.title} detail={p.overdue ? plural(p.overdue, "day") + " overdue" : E.fmtD(p.d) + " · " + inDays(E.days(E.sod(new Date()), p.d))} value={amt(p.amt)} tone={p.overdue ? "alert" : ""} /> : null;
  const sms = require("./native/sms").pendingTotal();
  return (
    <View>
      <Big v={h.tiles.rest.total} sub={"until payday, " + E.fmtD(h.f.P1) + " · about " + money(h.pace) + " a day"} />
      <T s={15} lh={22} style={{ marginTop: 4 }}>{h.explain}</T>
      {sms >= 1 ? <OutLine>{"Your SMS show " + money(sms) + " more spent that the bank's emails haven't brought in yet, so it isn't in this figure until they do."}</OutLine> : null}
      {h.fixes.length ? (
        <View>
          <SubHead>Ways to close the gap</SubHead>
          <Rows>{h.fixes.map((x, i) => <Row key={i} title={x.title} detail={x.detail} value={(x.upTo ? "up to " : "") + amt(x.amt, { sign: "in" })} tone="pos" />)}</Rows>
          {h.leftToFind >= 1 ? <Note>{"That still leaves " + money(h.leftToFind) + " to find: spend less until then, or move money in from savings."}</Note> : null}
        </View>
      ) : null}
      {h.nextPay ? <View><SubHead>Next payments</SubHead><Rows>{next(h.nextPay, "Next")}{next(h.nextBig, "Next big one")}</Rows></View> : null}
      <SubHead>How it's worked out</SubHead>
      <Rows ledger>{h.rows.map((x, i) => <Row key={i} total={!!x.total} title={x.title} detail={x.detail || ""}
        value={amt(x.amt, { sign: x.total || /^In your \w+ account$/.test(x.title) ? "" : "plus" })} tone={x.tone === "pos" ? "pos" : x.tone === "alert" ? "alert" : ""} />)}</Rows>
      <SubHead>In plain words</SubHead>
      {how}
    </View>
  );
}

/* ---------------- where you stand ---------------- */
function NetSheet() {
  const n = E.netModel(E.allCards());
  if (!n) return <BalanceSheet />;
  const r = (title, detail, v, o) => <Row key={title} title={title} detail={detail || ""} value={amt(v, o)} tone={o && o.tone} total={o && o.total} />;
  return (
    <View>
      <Big v={n.now} tone={n.now < 0 ? "alert" : ""} sub={n.now < 0 ? "Short right now, if every card were cleared today." : "Yours right now, after clearing every card."} />
      <Rows ledger>
        {n.b.parts.map((p) => r(p.full, p.set ? "tracked from alerts" : "not set yet", p.bal || 0))}
        {n.owe.length ? r("Still to set aside", E.andList(n.owe.map((x) => x.name)), -n.oweTotal, { sign: "out" }) : null}
        {n.oweNext.length ? r("Set aside from the " + E.fmt(n.nxtCredited) + " salary", E.andList(n.oweNext.map((x) => x.name)), -n.oweNextTotal, { sign: "out" }) : null}
        {r("Billed card dues", "", -n.billed, { sign: "out", tone: n.billed >= 0.5 ? "alert" : "" })}
        {r("Unbilled card spend", "", -n.unbilled, { sign: "out", tone: "info" })}
        {n.back >= 0.5 ? r("Back from others", "spent for someone else on your cards", n.back, { sign: "in", tone: "pos" }) : null}
        {r("Yours now", "", n.now, { total: true, tone: n.now < 0 ? "alert" : "" })}
      </Rows>
      {n.next ? (() => {
        const mp = n.next.mp;
        return (
          <View>
            <SubHead right={<Badge text={n.next.status} tone={n.next.status === "not confirmed" ? "warn" : n.next.status === "credited" ? "pos" : ""} />}>{"After your " + E.fmt(mp.cyc.p0) + " salary"}</SubHead>
            <Rows ledger>
              {r("Salary", n.next.basis, mp.amt, { sign: "in", tone: "pos" })}
              {mp.fixed.map((p) => r(p.name, E.fmt(E.parseISO(p.due)) + ", fixed", -p.amt, { sign: "out" }))}
              {mp.family >= 1 ? r(E.familyTitle(), "", -mp.family, { sign: "out" }) : null}
              {mp.sip >= 1 ? r("SIP", "", -mp.sip, { sign: "out" }) : null}
              {mp.ef >= 1 ? r("Emergency fund", "", -mp.ef, { sign: "out" }) : null}
              {r("Then you'd have", "", n.next.then, { total: true, tone: n.next.then < 0 ? "alert" : "" })}
            </Rows>
          </View>
        );
      })() : null}
      <SubHead>Bank balances</SubHead>
      {n.b.parts.map((p) => <Note key={p.key} style={{ marginBottom: 6 }}>{p.set ? p.full + ": set to " + ex(p.ob) + (p.since ? " on " + E.fmtY(new Date(p.since)) : "") + ". Since then " + money(p.inn) + " came in and " + money(p.out) + " went out, from alerts."
        : p.full + ": not set yet, so it counts as ₹0."}</Note>)}
      <Note>{"Money you move between them isn't counted as spending or income." + (n.age !== null && n.age >= 30 ? " It's been " + n.age + " days, so it's worth checking against your bank apps." : "")}</Note>
      <Actions><Btn kind="ghost" big full label="Balance looks off?" onPress={() => openSheet("balance")} /></Actions>
    </View>
  );
}

/* ---------------- the bank balance, over time ---------------- */
const RANGES = [["1m", "1M", 30], ["3m", "3M", 91], ["6m", "6M", 182], ["all", "All", 1e5]];
function BankSheet() {
  const C = useC();
  const [range, setRange] = useState("3m");
  const h = E.balanceHistory();
  if (!h) return <BalanceSheet />;
  const ahead = bankAhead(E.heroModel(E.allCards()));
  const n = (RANGES.find((x) => x[0] === range) || RANGES[1])[2];
  const pts = h.pts.slice(-Math.min(h.pts.length, n + 1));
  const lo = pts.reduce((a, p) => (p.bal < a.bal ? p : a), pts[0]), hi = pts.reduce((a, p) => (p.bal > a.bal ? p : a), pts[0]);
  const avg = pts.reduce((a, p) => a + p.bal, 0) / pts.length, chg = h.now - pts[0].bal;
  const marks = h.marks.filter((m) => +m.d >= +pts[0].d);
  const moves = E.bigMoves(pts[0].d, new Date(), 6);
  const nSal = marks.filter((m) => m.kind === "salary").length, nCard = marks.filter((m) => m.kind === "card").length;
  return (
    <View>
      <Seg full value={range} onChange={setRange} options={RANGES.map(([k, l]) => [k, l])} label="Range" />
      <View style={{ marginTop: 14 }}>
        <BankChart key={range} pts={pts} ahead={ahead} marks={h.marks} h={160} big head={{ now: h.now }} delay={0} />
      </View>
      <Legend small style={{ marginTop: 10 }} items={[["Salary" + (nSal ? " ×" + nSal : ""), C.pos], ["Card bill paid" + (nCard ? " ×" + nCard : ""), C.alert], ["Until payday", C.ink3, "", "dash"]]} />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
        <Tile inPanel label="Lowest" value={amt(lo.bal)} tone={lo.bal < 0 ? "alert" : ""} sub={E.fmtD(lo.d)} />
        <Tile inPanel label="Highest" value={amt(hi.bal)} sub={E.fmtD(hi.d)} />
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <Tile inPanel label="Average" value={amt(avg)} sub="a day, this range" />
        <Tile inPanel label="Change" value={amt(chg, { sign: "plus" })} tone={chg >= 0 ? "pos" : "alert"} sub={"since " + E.fmt(pts[0].d)} />
      </View>
      {moves.length ? <View><SubHead>Biggest moves · this range</SubHead><Rows>{moves.map((x) => <TxRow key={x.id} x={x} />)}</Rows></View> : null}
      <Note style={{ marginTop: 10 }}>{"Worked out from the balance you set" + (h.set ? " on " + E.fmt(h.set) : "") + " and every " + E.bankNames() + " alert before and since" + (E.BANKS.length > 1 ? " (money moved between them cancels out)" : "") + ". If an alert is missed it drifts, so check it against your bank apps now and then."}</Note>
      <Actions><Btn kind="ghost" big full label="Update balance" onPress={() => openSheet("balance")} /></Actions>
    </View>
  );
}

/* ---------------- set the bank balances ---------------- */
function BalanceSheet() {
  const close = useClose();
  const b = E.bankBalance(), parts = b ? b.parts : E.BANKS.map((x) => E.accountBalance(x.key));
  const [vals, setVals] = useState({});
  const hint = (p) => (p.set ? "Now " + ex(p.bal) + " from alerts · set " + (p.since ? E.fmt(new Date(p.since)) : "") : "Not set yet");
  const save = async () => {
    const filled = parts.filter((p) => (vals[p.key] || "").trim() !== "");
    if (!filled.length) return fail("Enter at least one balance.");
    if (!(await guard("Change your bank balance"))) return;
    for (const p of filled) { const msg = E.act.setBalance(num(vals[p.key]), p.key); if (msg) return fail(msg); }
    buzz("confirm"); close(); toast(filled.length > 1 ? "Balances set" : filled[0].name + " balance set");
  };
  return (
    <View>
      <Note>Enter what each bank app shows right now. Leave one empty to keep it as it is. After that, alerts keep them up to date.</Note>
      {parts.map((p, i) => <Field key={p.key} label={"Balance in the " + p.name + " app (₹)"} value={vals[p.key] || ""} numeric placeholder={hint(p)} autoFocus={i === 0 && !p.set}
        onChange={(t) => setVals({ ...vals, [p.key]: t })} />)}
      <Actions><Btn big full label="Set balance" onPress={save} /></Actions>
    </View>
  );
}

/* ---------------- cards ---------------- */
function PaySheet({ g }) {
  const close = useClose();
  const c = E.allCards().find((x) => x.key === g);
  const [v, setV] = useState(c && c.billedLeft >= 0.5 ? String(Math.round(c.billedLeft * 100) / 100) : ""), [d, setD] = useState(E.iso(E.sod(new Date())));
  return (
    <View>
      <Note>{"For " + E.GROUPS[g].short + ", if you paid from somewhere these emails don't cover."}</Note>
      <Field label="Amount (₹)" value={v} onChange={setV} numeric autoFocus />
      <DateField label="Paid on" value={d} onChange={setD} max={E.iso(E.sod(new Date()))} />
      <Actions><Btn big full label="Save" onPress={() => {
        const was = c && c.billedLeft >= 0.5;
        const msg = E.act.addPayment(g, d, num(v)); if (msg) return fail(msg);
        const now = E.allCards().find((x) => x.key === g), cleared = was && now && now.billedLeft < 0.5;
        buzz("confirm"); close();
        if (cleared) { toast(E.GROUPS[g].short + " bill paid in full"); setTimeout(() => burst("paid"), 320); } else toast("Payment recorded");
      }} /></Actions>
    </View>
  );
}
/** A card's payment history: what's been paid to it and how each was found. Kept off the Cards page (one tap away
    from "Payments"); here you can drop a bank debit that wasn't really a card payment, or a payment you added. */
function PaymentsSheet({ g }) {
  const c = E.allCards().find((x) => x.key === g);
  if (!c) return null;
  const pays = E.cardPayments(c);
  if (!pays.length) return <Note>No payments to this card found yet. Record one if you paid from somewhere these emails don't cover.</Note>;
  return (
    <View>
      <Note>{c.billed >= 0.5 ? (hidden() ? "Paid towards the " : ex(c.toBilled) + " paid towards the ") + E.fmt(c.c.stmt) + " bill." : "Every payment found for this card."}</Note>
      <Rows ledger>{pays.map((p, k) => (
        <Row key={k} soft={p.before} title={E.fmt(new Date(p.ts)) + " " + new Date(p.ts).getFullYear()} detail={[p.how, p.off, p.beforeText].filter(Boolean).join(" · ")}
          value={amt(p.amt, { exact: true })} tone="pos"
          after={p.kind === "inferred" || (p.kind === "confirmed" && p.txId) ? (
            <XBtn label="That bank debit was something else" onPress={() => {
              E.act.notCardPayment(p.txId);
              toast("That debit no longer counts as a card payment", { action: { label: "Undo", fn: () => { delete E.payAssign[p.txId]; E.render(); E.queueSave(); } } });
            }} />
          ) : p.kind === "manual" ? <XBtn label="Remove payment" onPress={() => { E.act.delPayment(p.id); toast("Payment removed"); }} /> : null} />
      ))}</Rows>
    </View>
  );
}

/** The card's credit limit (saved with your settings, so the website and every phone see it). */
function LimitSheet({ g }) {
  const close = useClose();
  const k = "limit|" + g, have = typeof E.overrides[k] === "number" ? E.overrides[k] : null;
  const [v, setV] = useState(have ? String(have) : "");
  const addOn = /add-on/i.test(E.GROUPS[g].short);
  return (
    <View>
      <Note>{"The credit limit on " + E.GROUPS[g].short + ", from the bank's app or statement. It shows how much of it you're using; banks and credit bureaus look at that, and under 30% is the usual advice." + (addOn ? " On an add-on card the limit is shared with the main card, so enter the limit you see on yours." : "")}</Note>
      <Field label="Credit limit (₹)" value={v} onChange={setV} numeric autoFocus />
      <Actions>
        {have ? <Btn kind="ghost" big full label="Remove" onPress={() => { delete E.overrides[k]; E.render(); E.queueSave(); close(); toast("Limit removed"); }} /> : null}
        <Btn big full label="Save" onPress={() => {
          const n = Number(num(v));
          if (!(n >= 1000) || n > 1e8) return fail("Enter the limit in rupees, like 200000.");
          E.overrides[k] = Math.round(n); E.render(); E.queueSave(); buzz("confirm"); close(); toast("Limit saved");
        }} />
      </Actions>
    </View>
  );
}

function StmtSheet({ g }) {
  const close = useClose();
  const c = E.allCards().find((x) => x.key === g);
  const [v, setV] = useState(c && c.hasOverride ? String(c.billed) : "");
  if (!c) return null;
  return (
    <View>
      <Note>{"Alerts added up to " + ex(c.billedAlerts) + " for the " + E.fmt(c.c.stmt) + " statement. If the bank's statement says otherwise, enter its total due."}</Note>
      <Field label="Statement total (₹)" value={v} onChange={setV} numeric autoFocus />
      <Actions>
        {c.hasOverride ? <Btn kind="ghost" big full label="Use alerts instead" onPress={() => { E.act.clearStatement(c.okey); close(); }} /> : null}
        <Btn big full label="Save" onPress={() => { const msg = E.act.setStatement(c.okey, num(v)); if (msg) return fail(msg); close(); toast("Saved"); }} />
      </Actions>
    </View>
  );
}

/* ---------------- goals ---------------- */
function GoalSheet() {
  const close = useClose();
  const [f, setF] = useState({ name: "", target: "", start: "", date: "", prio: "2" });
  const set = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <View>
      <Field label="What for" value={f.name} onChange={set("name")} placeholder="Laptop" maxLength={40} autoFocus />
      <Row2><Field label="Target (₹)" value={f.target} onChange={set("target")} numeric /><Field label="Already saved (₹)" value={f.start} onChange={set("start")} numeric placeholder="0" /></Row2>
      <DateField label="By" value={f.date} onChange={set("date")} />
      <SubHead>Priority</SubHead>
      <Seg value={f.prio} onChange={set("prio")} options={[["1", "High"], ["2", "Medium"], ["3", "Low"]]} label="Priority" />
      <Actions><Btn big full label="Add goal" onPress={() => { const msg = E.act.addGoal({ ...f, target: num(f.target), start: num(f.start) }); if (msg) return fail(msg); buzz("confirm"); close(); toast("Goal added"); }} /></Actions>
    </View>
  );
}
function MoveSheet({ gid }) {
  const close = useClose();
  const p = E.goalPlan(E.payCycle()).find((x) => x.g.id === gid);
  const [v, setV] = useState(p ? String(Math.max(0, Math.round(p.funded - p.movedNow))) : ""), [d, setD] = useState(E.iso(E.sod(new Date())));
  if (!p) return null;
  return (
    <View>
      <Field label="Amount (₹)" value={v} onChange={setV} numeric autoFocus />
      <DateField label="Moved on" value={d} onChange={setD} />
      <Actions><Btn big full label="Save" onPress={() => {
        const was = !p.done;
        const msg = E.act.addContrib(gid, num(v), d); if (msg) return fail(msg);
        const q = E.goalPlan(E.payCycle()).find((x) => x.g.id === gid), reached = was && q && q.done;
        buzz("confirm"); close();
        if (reached) { toast(q.g.name + ": goal reached"); setTimeout(() => burst("goal"), 320); } else toast("Moved");
      }} /></Actions>
    </View>
  );
}

/* ---------------- salary settings and fixed payments ---------------- */
const savedToast = () => toast("Saved", { ms: 1400 });
/** A number field in the salary settings that saves when you leave it. */
function NumF({ label, path, pct, setting }) {
  const c = E.cfgNow();
  const cur = setting ? E.settings[setting] : (() => { const [a, b] = path.split("."); return c[a][b]; })();
  const [v, setV] = useState(cur === null || cur === undefined ? "" : String(pct ? Math.round(cur * 1000) / 10 : cur));
  const commit = () => {
    if (setting) { E.act.setSetting(setting, v); return savedToast(); }
    const n = parseFloat(v); if (!isFinite(n) || n < 0) return;
    E.act.setCfgField(path, pct ? n / 100 : n); savedToast();
  };
  return <FieldSave label={label} value={v} onChange={setV} onDone={commit} />;
}
function FieldSave({ label, value, onChange, onDone }) {
  const C = useC();
  const { TextInput } = require("react-native");
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginTop: 14 }}>
      <T f={F.medium} s={13.5} lh={18} c={C.ink2} style={{ marginBottom: 6 }} lines={1}>{label}</T>
      <TextInput accessibilityLabel={label} value={value} keyboardType="decimal-pad" onChangeText={(t) => onChange(t.replace(/[^\d.]/g, ""))} onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); onDone(); }} onSubmitEditing={onDone}
        style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 12, backgroundColor: focus ? C.surface : C.inset, borderWidth: 1.5, borderColor: focus ? C.accent : "transparent",
          fontFamily: F.body, fontSize: 15, letterSpacing: -0.18, color: C.ink, includeFontPadding: false }} />
    </View>
  );
}
function DateF({ label, path, setting }) {
  const c = E.cfgNow();
  const cur = setting ? E.settings[setting] || "" : (() => { const [a, b] = path.split("."); return c[a][b]; })();
  return <DateField label={label} value={cur} onChange={(v) => { if (setting) E.act.setSetting(setting, v); else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) E.act.setCfgField(path, v); savedToast(); }} />;
}
function SalarySheet() {
  const close = useClose();
  const C = useC();
  const take = E.regularTakeHome(), R = E.SALARY_RULE, O = E.OFFER;
  const spendPct = 1 - R.savings - R.ef - R.family;
  const payDays = [[0, "Last working day"], [31, "Last day of the month"]].concat(Array.from({ length: 30 }, (_, i) => [i + 1, E.ordinal(i + 1)]));
  const pfLine = O.pfCap < O.pf * O.basic ? (O.pfCap <= 0 ? " (no PF from " + E.fmt(E.parseISO(O.pfCapFrom)) : " (PF " + money(O.pfCap) + " from " + E.fmt(E.parseISO(O.pfCapFrom))) + "; " + money(O.pf * O.basic) + " before)" : "";
  return (
    <View>
      <SubHead style={{ marginTop: 6 }}>Your pay</SubHead>
      <Row2><NumF label="Take-home a month (₹)" setting="inc" /><SelectField label="Payday" value={E.settings.payDay || 0} options={payDays} onChange={(v) => { E.act.setSetting("payDay", v); savedToast(); }} /></Row2>
      <Row2><DateF label="Joined on" setting="joined" /><NumF label="Buffer to keep (₹)" setting="buffer" /></Row2>
      <SubHead small="per month">Payslip</SubHead>
      <Row2><NumF label="Gross (₹)" path="offer.gross" /><NumF label="Basic (₹)" path="offer.basic" /></Row2>
      <Row2><NumF label="PF (% of basic)" path="offer.pf" pct /><NumF label="Professional tax (₹)" path="offer.pt" /></Row2>
      <Row2><NumF label="Professional tax in Feb (₹)" path="offer.ptFeb" /><View /></Row2>
      <Row2><NumF label="PF later (₹; 0 = opted out)" path="offer.pfCap" /><DateF label="From the salary on" path="offer.pfCapFrom" /></Row2>
      <Row2><NumF label="Allowance (₹)" path="offer.allow" /><DateF label="First salary" path="offer.firstPayday" /></Row2>
      <Row2><NumF label="Stipend before (₹)" path="offer.stipend" /><View /></Row2>
      <OutLine>{"Take-home: "}<T f={F.semi} s={14} c={C.ink}>{money(take)}</T>{" a month before income tax" + pfLine}</OutLine>
      {Math.abs(take - (E.settings.inc || 0)) >= 1 ? <Btn kind="link" small label="Use it as your take-home" onPress={() => { E.act.useTakeHome(); toast("Take-home updated"); }} style={{ marginTop: 8 }} /> : null}
      <SubHead small="of each salary">Your split</SubHead>
      <DateF label="Starts with the salary on" path="rule.from" />
      <Row2><NumF label="SIP (%)" path="rule.savings" pct /><NumF label="Emergency (%)" path="rule.ef" pct /></Row2>
      <Row2><NumF label={E.familyTitle() + " (%)"} path="rule.family" pct /><NumF label="Emergency stops at (× pay)" path="rule.efCapX" /></Row2>
      <DateF label="Card bills come out of the salary from" path="rule.billsFrom" />
      <OutLine>{"Yours to spend: "}<T f={F.semi} s={14} c={C.ink}>{Math.round(spendPct * 1000) / 10 + "%"}</T>{spendPct < 0 ? " · the shares add up to more than 100%" : ""}</OutLine>
      <SubHead small="set aside from the salary of their month">Fixed payments</SubHead>
      {E.PLANNED.length ? <Rows>{E.PLANNED.map((p, i) => <Row key={i} title={p.name} detail={E.fmt(E.parseISO(p.due)) + " · " + (p.from === "savings" ? "savings share first" : "off the top")} value={amt(p.amt, { sign: "out" })}
        after={<XBtn label={"Remove " + p.name} onPress={() => { E.act.delPlanned(i); toast("Removed"); }} />} />)}</Rows> : <Note>None.</Note>}
      <AddRow label="Add a fixed payment" onPress={() => openSheet("fixed")} />
      <Actions><Btn kind="ghost" big full label="Clear all of these" onPress={() => { E.act.resetCfg(); close(); toast("Cleared"); }} /></Actions>
    </View>
  );
}
function FixedSheet() {
  const close = useClose();
  const [f, setF] = useState({ name: "", amt: "", n: "1", due: "", from: "pay" });
  const set = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <View>
      <Field label="What for" value={f.name} onChange={set("name")} placeholder="Phone EMI" maxLength={40} autoFocus />
      <Row2><Field label="Amount (₹)" value={f.amt} onChange={set("amt")} numeric /><Field label="For how many months" value={f.n} onChange={set("n")} numeric /></Row2>
      <DateField label="First date" value={f.due} onChange={set("due")} />
      <SubHead>Paid from</SubHead>
      <Seg full value={f.from} onChange={set("from")} options={[["pay", "Salary, off the top"], ["savings", "Savings share first"]]} label="Paid from" />
      <Actions><Btn big full label="Add" onPress={() => { const msg = E.act.addPlanned({ ...f, amt: num(f.amt) }); if (msg) return fail(msg); buzz("confirm"); close(); toast("Added"); }} /></Actions>
    </View>
  );
}

/* ---------------- payee rules ---------------- */
function RulesSheet() {
  const keys = Object.keys(E.catRules).sort();
  if (!keys.length) return <Note>No rules yet. Open a transaction and turn on "Always use this for …" to add one.</Note>;
  return (
    <View>
      <Note>Each rule gives every payment to that payee its category, past and future. Remove one to go back to the category the alert came with.</Note>
      <Rows>{keys.map((k) => <Row key={k} icon={<CatIc cat={E.catRules[k]} />} title={k} detail={E.catRules[k]}
        after={<XBtn label={"Remove rule for " + k} onPress={() => { E.act.delRule(k); toast("Rule removed"); }} />} />)}</Rows>
    </View>
  );
}

/* ---------------- your banks and cards ----------------
   Kept with your saved settings, never in the app's code (see applyProfile in app/engine.js). A setup arrives as text
   (pasted here) or in a link that opens this sheet (#/settings?sheet=setup:<the setup, base64url>): either way you see
   what it holds before anything is saved. */
export function decodeSetup(t) {
  t = String(t || "").trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch (e) {}
  try {
    const b = t.replace(/-/g, "+").replace(/_/g, "/"), bin = atob(b + "===".slice((b.length + 3) % 4));
    return JSON.parse(decodeURIComponent(Array.from(bin, (ch) => "%" + ch.charCodeAt(0).toString(16).padStart(2, "0")).join("")));
  } catch (e) { return null; }
}
function SetupSheet({ arg }) {
  const close = useClose();
  const C = useC();
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const incoming = arg ? decodeSetup(arg) : decodeSetup(text);
  const P = E.PROFILE || {};
  const cardsOf = (p) => Object.keys((p && p.groups) || {});
  const listOf = (p) => (
    <Rows>
      {((p && p.banks) || []).map((b) => <Row key={"b" + b.key} icon={<Ic name="bank" />} title={b.full || b.name} detail="bank account" />)}
      {cardsOf(p).map((k) => { const g = p.groups[k] || {}; return <Row key={"g" + k} icon={<Ic name="card" />} title={String(g.short || k).replace(/\s*·\d{4}/g, "")}
        detail={(g.closed ? "closed " + g.closed + " · " : "") + "bill on the " + E.ordinal(+g.stmtDay || 1) + ", due " + (+g.dueAfter || 20) + " days later"} />; })}
    </Rows>
  );
  if (arg || (text && incoming)) {
    if (!incoming || !incoming.profile) return <Note>{"This link doesn't hold a Money setup. Ask for a new one."}</Note>;
    const x = incoming, plan = x.cfg && (x.cfg.offer || x.cfg.rule || x.cfg.planned);
    return (
      <View>
        <Note>{"This sets your banks and cards" + (plan ? ", and fills in the salary figures you haven't set yet" : "") + ". It's saved to your account, so your other devices get it too."}</Note>
        {listOf(x.profile)}
        {x.profile.family ? <Row title="Family share" detail={"goes to " + x.profile.family} /> : null}
        {x.profile.salaryText ? <Row title="Salary credits" detail="recognised by your employer's name" /> : null}
        <Actions>
          <Btn big full label="Save to my account" onPress={() => { const m = E.act.importSetup(x); if (m) { setErr(m); return; } buzz("confirm"); close(); toast("Your banks and cards are saved"); }} />
        </Actions>
        {err ? <Note tone="alert">{err}</Note> : null}
      </View>
    );
  }
  return (
    <View>
      {cardsOf(P).length || (P.banks || []).length ? listOf(P) : <Note>None yet. They come in with a setup: paste one below, or open the setup link you were sent.</Note>}
      <SubHead>Bring in a setup</SubHead>
      <Field label="Paste the setup text" value={text} onChange={(t) => { setText(t); setErr(""); }} multiline placeholder={'{"profile": …}'} />
      {text && !incoming ? <Note>{"That isn't a Money setup."}</Note> : null}
    </View>
  );
}

/* ---------------- a payment from an SMS, before the bank's email ---------------- */
function SmsSheet({ id }) {
  const close = useClose();
  const C = useC();
  const S_ = require("./native/sms");
  const x = S_.pending().find((t) => t.id === id);
  if (!x) return <Note>The bank's email has come in for this one, so it's in Activity now.</Note>;
  return (
    <View>
      <Big v={x.amt} text={amt(x.amt, { exact: true, sign: x.dir === "in" ? "in" : "out" })} tone={x.dir === "in" ? "pos" : ""} sub={x.desc + " · " + x.account} />
      <OutLine>{S_.counting() ? "From an SMS at " + E.clockOf(x) + ". It already counts in your figures (SMS first is on). When the bank's email for it comes in, the email takes its place, so it never counts twice."
        : "From an SMS at " + E.clockOf(x) + ". It shows here straight away; the bank's email usually follows within the hour, and then it counts in your figures. If no email ever comes for it (some banks don't send one), add it yourself."}</OutLine>
      <T s={13} lh={18} c={C.ink3} style={{ marginTop: 12 }}>{x.body}</T>
      <Actions>
        <Btn kind="ghost" big full label="Not mine" onPress={() => { S_.dismiss(id); close(); toast("Hidden"); }} />
        {S_.counting() ? null : <Btn big full label="Add it now" onPress={() => openSheet({ kind: "add", preset: { dir: x.dir, amt: x.amt, desc: x.desc, acct: x.acctKey, date: E.iso(new Date(x.ts)), sms: id } })} />}
      </Actions>
    </View>
  );
}

/** The SMS-first week: which was faster, by how much, and what each one missed. */
function SmsTrialSheet() {
  const close = useClose();
  const C = useC();
  const S_ = require("./native/sms");
  const [r, setR] = useState(S_.stats());
  React.useEffect(() => { S_.fetchArrivals().then(() => setR(S_.stats())); }, []);
  if (!r) return <Note>The SMS week hasn't started yet.</Note>;
  const on = !!S_.trialStart(), done = !on || S_.trialDone();
  const dur = (ms) => { const m = Math.round(Math.abs(ms) / 60000); return m < 1 ? "under a minute" : m < 90 ? m + " min" : (Math.round(m / 6) / 10) + " hours"; };
  const head = !r.timed ? "Nothing to compare yet" : r.median > 60000 ? "SMS was faster by " + dur(r.median) : r.median < -60000 ? "Email was faster by " + dur(-r.median) : "About the same speed";
  const list = (xs) => xs.slice(-5).reverse().map((x, k) => <Row key={k} title={x.desc || "Payment"} detail={x.ts ? E.fmt(new Date(x.ts)) : ""} value={amt(x.amt, { exact: true })} />);
  const Stat = ({ label, v, sub }) => (
    <View style={{ flex: 1, backgroundColor: C.inset, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 13 }}>
      <T s={12.5} lh={16} c={C.ink2}>{label}</T>
      <T f={F.semi} s={19} lh={24}>{v}</T>
      {sub ? <T s={11.5} lh={15} c={C.ink3}>{sub}</T> : null}
    </View>
  );
  return (
    <View>
      <T s={13.5} lh={18} c={C.ink3}>{on ? (done ? "The week is done (" + E.fmt(new Date(r.start)) + " to today)" : "Day " + r.day + " of 7 · since " + E.fmt(new Date(r.start))) : "Your SMS week, as it ended"}</T>
      <T f={F.head} s={19} lh={26} style={{ marginTop: 4 }}>{head}</T>
      <T s={14} lh={20} c={C.ink2} style={{ marginTop: 2 }}>{r.timed ? "the typical gap over " + plural(r.timed, "payment") + " seen both ways (SMS arriving vs its email reaching your data)" : "Once a few payments have come in both ways, this fills in."}</T>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        <Stat label="SMS first" v={r.smsFirst + " of " + r.timed} />
        <Stat label="Email first" v={r.emailFirst + " of " + r.timed} />
        <Stat label="Longest wait" v={r.max ? dur(r.max) : "—"} sub="for an email" />
      </View>
      <SubHead>What each one caught</SubHead>
      <Rows>
        <Row title="Both" detail="the same payment by SMS and by email" value={String(r.both)} />
        <Row title="Only by SMS" detail="no email came for these" value={String(r.smsOnly.length)} tone={r.smsOnly.length ? "pos" : ""} />
        <Row title="Only by email" detail="no SMS was read for these" value={String(r.emailOnly.length)} tone={r.emailOnly.length ? "warn" : ""} />
        <Row title="Bank SMS it couldn't read" detail="had an amount, but not in a form the app knows yet" value={String(r.unread)} />
      </Rows>
      {r.smsOnly.length ? (<View><SubHead small>Only by SMS</SubHead><Rows>{list(r.smsOnly)}</Rows></View>) : null}
      {r.emailOnly.length ? (<View><SubHead small>Only by email</SubHead><Rows>{list(r.emailOnly)}</Rows></View>) : null}
      {done && on ? (
        <Actions>
          <Btn kind="ghost" big full label="Back to email" onPress={() => { S_.endTrial(false); close(); toast("Back to email: SMS shows, but waits for the email to count"); }} />
          <Btn big full label="Keep SMS first" onPress={() => { S_.endTrial(true); close(); toast("SMS first stays on"); }} />
        </Actions>
      ) : on ? (
        <View style={{ marginTop: 14 }}><Btn kind="link" small label="Stop the trial now" onPress={() => { S_.endTrial(false); close(); toast("Trial stopped: back to email"); }} /></View>
      ) : S_.counting() ? (
        <View style={{ marginTop: 14 }}><Btn kind="link" small label="Go back to email" onPress={() => { require("./store").pref.set("smsFirst", null); S_.inject(); close(); toast("Back to email"); }} /></View>
      ) : null}
    </View>
  );
}

/* ---------------- trips ---------------- */
/** .kv: a name on the left, its figure on the right, an optional line under it. */
function KV({ k, v, d, first }) {
  const C = useC();
  return (
    <View style={{ paddingVertical: 9, borderTopWidth: first ? 0 : 1, borderTopColor: C.line }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 14 }}>
        <T s={14.5} lh={20} c={C.ink2}>{k}</T>
        <T f={F.semi} s={14.5} lh={20} style={{ flex: 1, textAlign: "right" }}>{v}</T>
      </View>
      {d ? <T s={13} lh={17} c={C.ink3} style={{ textAlign: "right", marginTop: 2 }}>{d}</T> : null}
    </View>
  );
}
function Sources({ keys }) {
  const C = useC();
  const S0 = E.TRIP_DATA.sources;
  return (
    <View style={{ gap: 10 }}>
      {[...new Set(keys)].map((k) => S0[k] && (
        <Press key={k} disabled={!S0[k].url} scale={0.98} onPress={() => Linking.openURL(S0[k].url).catch(() => {})} accessibilityRole={S0[k].url ? "link" : "text"}>
          <T f={F.medium} s={14} lh={19} c={S0[k].url ? C.accent : C.ink2}>{S0[k].name}</T>
          <T s={12.5} lh={16} c={C.ink3}>{S0[k].at}</T>
        </Press>
      ))}
    </View>
  );
}
const TRIP_KIND = { fuel: "fuel", utilities: "bills", rent: "rent", insurance: "insurance", education: "school fees", govt: "taxes", wallets: "wallet loads", jewellery: "jewellery" };
function TripCardSheet({ id }) {
  const C = useC();
  const close = useClose();
  const m = E.tripModel(), D = E.TRIP_DATA, x = m.all.find((r) => r.card.id === id);
  const [mine, setMine] = useState(!!(x && x.owned));
  const [have, setHave] = useState(x && x.have ? String(x.have) : "");
  if (!x) return null;
  const c = x.card, n = m.need, air = D.air[n.airline], r2 = (v) => Math.round(v * 100) / 100;
  const earn = c.earn.air === c.earn.base && c.earn.ota === c.earn.base ? r2(c.earn.base) + " per ₹100 on everything that counts"
    : r2(c.earn.base) + " per ₹100, " + c.earn.air + " on flights booked with the airline" + (c.earn.ota === c.earn.air ? " and on travel sites" : ", " + c.earn.ota + " on travel sites");
  const moves = [c.to.ai ? "Air India " + tripRatio(c.to.ai) : "", c.to.kf ? "KrisFlyer " + tripRatio(c.to.kf) : "", c.to.accor ? "Accor " + tripRatio(c.to.accor) : ""].filter(Boolean).join(" · ");
  const done = x.run && x.run.months !== null;
  return (
    <View>
      <OutLine>
        {x.owned ? "One of your cards."
          : c.status !== "open" ? c.why
          : !x.canGet ? "Asks for an income of " + money(c.income) + " a year, more than the income this goes by."
          : (c.income ? "Asks for an income of " + money(c.income) + " a year." : "The bank doesn't publish an income bar for this card.") + " The bank still decides each application."}
      </OutLine>
      <SubHead>{"For " + tripWhere(n)}</SubHead>
      {x.fl ? <KV first k="Conversion" v={tripRate(x.rate) + " " + air.short + " " + air.unit + " per ₹100"} d={"earns " + r2(c.earn.base) + " per ₹100, " + tripRatio(x.fl.ratio)} /> : null}
      {x.fl ? <KV k={"Flights · " + air.short} v={pts(x.fl.pts) + " " + c.pts} d={pts(x.fl.miles) + " " + air.unit + ", " + tripRatio(x.fl.ratio)} /> : null}
      {x.ht ? <KV first={!x.fl} k="Hotel · Accor" v={pts(x.ht.pts) + " " + c.pts} d={pts(x.ht.points) + " Accor points, " + tripRatio(x.ht.ratio)} /> : null}
      {x.fl && x.ht ? <KV k="Together" v={pts(x.total) + " " + c.pts} /> : null}
      {x.owned && x.fl ? <KV k="You have" v={pts(x.have) + " · " + pts(x.left) + " to go"} /> : null}
      {x.warn.map((w, i) => <View key={i} style={{ marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: C.warnSoft }}><T s={14} lh={20} c={C.ink2}>{w}</T></View>)}
      {done ? (
        <View>
          <SubHead>{m.known ? "At your spending" : "At " + money(50000) + " a month"}</SubHead>
          <KV first k="Points a month" v={pts(x.run.perMonth)} />
          <KV k="Spending it takes" v={ex(x.run.spend)} />
          <KV k="Time" v={x.run.months === 0 ? "you have the points" : x.far ? "more than 20 years" : span(x.run.months) + (x.ready ? " · by " + monthOf(x.ready) : "")} />
          <KV k="Fees on the way" v={ex(x.run.fees)} />
          {x.run.bonus ? <KV k="Bonus points counted" v={pts(x.run.bonus)} /> : null}
          {m.whenDate && x.pace !== null && m.avail >= 1 && x.run.months !== 0 ? <KV k={"To fly in " + monthOf(m.whenDate)} v={ex(x.pace) + " a month"} /> : null}
        </View>
      ) : null}
      <SubHead>The card</SubHead>
      <KV first k="Yearly fee" v={money(c.fee) + " + GST"} d={c.waive ? "waived at " + lakh(c.waive) + " a year" : null} />
      <KV k="Earns" v={earn} />
      <KV k="Nothing on" v={c.no.map((k) => TRIP_KIND[k] || k).join(", ")} />
      {c.welcome ? <KV k="Welcome" v={pts(c.welcome.pts) + " " + c.pts} d={c.welcome.spend ? "after " + money(c.welcome.spend) + " in " + c.welcome.days + " days" : null} /> : c.welcomeNote ? <KV k="Welcome" v={c.welcomeNote} /> : null}
      {(c.milestones || []).map((ms, i) => <KV key={i} k="Bonus" v={pts(ms.pts) + " at " + lakh(ms.at) + (ms.per === "quarter" ? " in a quarter" : " in a year")} />)}
      {c.renewal ? <KV k="Each renewal" v={pts(c.renewal) + " " + c.pts} /> : null}
      <KV k="Moves to" v={moves} />
      {c.note ? <Note style={{ marginTop: 8 }}>{c.note}</Note> : null}
      <SubHead>Checked against</SubHead>
      <Sources keys={c.src} />
      <SubHead>{x.auto ? "Your points" : "Got this card?"}</SubHead>
      {x.auto ? null : <SwRow first title="I have this card" detail="counts the points you already hold" value={mine} onChange={setMine} />}
      {mine ? <Field label="Points on it now" value={have} onChange={setHave} numeric placeholder="0" /> : null}
      <Actions>
        <Btn big full label="Save" onPress={() => {
          const on = x.auto ? false : mine;
          E.act.setTripCard(id, on, on || x.auto ? Math.max(0, Math.round(Number(num(have)) || 0)) : 0);
          buzz("confirm"); close();
        }} />
      </Actions>
    </View>
  );
}
/** The income the "cards you can get" list goes by: kept off the screen, changed here. */
function TripIncomeSheet() {
  const close = useClose();
  const inc = E.tripIncome(E.tripPlan());
  const [v, setV] = useState(inc.amt !== null ? String(inc.amt) : "");
  return (
    <View>
      <Note s={15}>Only used to pick the cards you can apply for. It starts as your take-home pay × 12; banks usually look at pay before tax, so type that if you prefer.</Note>
      <Field label="Income a year (₹)" value={v} onChange={setV} numeric />
      <Actions>
        {inc.from === "you" ? <Btn kind="ghost" big label="Use my salary" onPress={() => { E.act.setTrip("income", null); buzz("tick"); close(); }} /> : null}
        <Btn big full={inc.from !== "you"} label="Save" onPress={() => { const n = Number(num(v)); E.act.setTrip("income", n > 0 ? Math.round(n) : null); buzz("confirm"); close(); }} />
      </Actions>
    </View>
  );
}
/** The month of card spending the time and spending figures are worked out on. */
function TripSpendSheet() {
  const close = useClose();
  const m = E.tripModel(), p = m.plan, typed = p.spend !== null || p.travel !== null;
  const [a, setA] = useState(String(m.mix.everyday));
  const [b, setB] = useState(String(m.mix.travel));
  return (
    <View>
      <Note s={15}>{(typed ? "With your own figures. " : m.prof.basis === "months" ? "The average of your last " + plural(m.prof.n, "full month") + ". " : m.prof.basis === "month" ? "This month so far, scaled to a full month. " : "Nothing to go on yet: type what you spend. ") +
        "Money you send to people isn't counted, because a card can't pay it." + (m.mix.noearn >= 1 ? " " + ex(m.mix.noearn) + " a month on fuel, bills, rent, insurance, fees and taxes is left out: most cards pay no points on those." : "")}</Note>
      <Field label="Everyday spending a month (₹)" value={a} onChange={setA} numeric />
      <Field label="Flights and hotels a month (₹)" value={b} onChange={setB} numeric />
      <Actions>
        {typed ? <Btn kind="ghost" big label="My real spending" onPress={() => { E.act.setTrip("spend", null, true); E.act.setTrip("travel", null); buzz("tick"); close(); }} /> : null}
        <Btn big full={!typed} label="Save" onPress={() => {
          const x = num(a) === "" ? null : Math.round(Number(num(a))), y = num(b) === "" ? null : Math.round(Number(num(b)));
          if (x !== null && x !== m.mix.everyday) E.act.setTrip("spend", x, true);
          if (y !== null && y !== m.mix.travel) E.act.setTrip("travel", y, true);
          E.render(); buzz("confirm"); close();
        }} />
      </Actions>
    </View>
  );
}
function TripSourcesSheet() {
  const D = E.TRIP_DATA;
  return (
    <View>
      <Note s={15}>Read from the pages below; each shows the day it was checked. Where two pages disagreed, the bank's or airline's own page was used.</Note>
      <SubHead>Flight prices in points</SubHead><Sources keys={D.air.ai.src.concat(D.air.kf.src)} />
      <SubHead>Hotel points</SubHead><Sources keys={D.accor.src} />
      <SubHead>Room prices</SubHead><Sources keys={D.countries.map((c) => c.hsrc)} />
      <SubHead>Cards</SubHead><Sources keys={D.cards.reduce((a, c) => a.concat(c.src), [])} />
      <SubHead>Rupee rates</SubHead><Sources keys={D.fx.src} />
      <SubHead>Not confirmed</SubHead>
      <Note>Business-class prices on Air India to Japan, South Korea, Thailand, Vietnam, Bali, the Maldives, Sri Lanka and France (KrisFlyer is used where it flies). Taxes and fees on award tickets. Room prices for Singapore, Bali, Sri Lanka and France come from travel guides rather than one booking average.</Note>
      <SubHead>Left out</SubHead>
      <Note>{D.out.map((o) => o.name + ": " + o.why.charAt(0).toLowerCase() + o.why.slice(1)).join(" ")}</Note>
    </View>
  );
}

const about = (title, text) => () => ({ title, body: <Note s={15}>{text}</Note> });

export default {
  tx: (id) => ({ title: (() => { const x = E.allTx().find((t) => t.id === id); return x && x.dir === "in" ? "Money in" : "Payment"; })(), body: <TxSheet id={id} /> }),
  add: (arg, spec) => ({ title: "Add a transaction", body: <AddSheet preset={spec && spec.preset} /> }),
  explain: () => ({ title: "Safe to spend until payday", body: <ExplainSheet /> }),
  net: () => (E.netModel(E.allCards()) ? { title: "Where you stand", body: <NetSheet /> } : { title: "Your bank balances", body: <BalanceSheet /> }),
  bank: () => (E.balanceHistory() ? { title: "Bank balance", body: <BankSheet /> } : null),
  balance: () => ({ title: "Your bank balances", body: <BalanceSheet /> }),
  pay: (g) => (E.GROUPS[g] ? { title: "Record a payment", body: <PaySheet g={g} /> } : null),
  stmt: (g) => (E.allCards().some((x) => x.key === g) ? { title: "Statement total", body: <StmtSheet g={g} /> } : null),
  payments: (g) => (E.GROUPS[g] ? { title: "Payments to " + E.cardShort(g), body: <PaymentsSheet g={g} /> } : null),
  limit: (g) => (E.GROUPS[g] ? { title: "Credit limit", body: <LimitSheet g={g} /> } : null),
  goal: () => ({ title: "Add a goal", body: <GoalSheet /> }),
  move: (gid) => { const p = E.goalPlan(E.payCycle()).find((x) => x.g.id === gid); return p ? { title: "Move money to " + p.g.name, body: <MoveSheet gid={gid} /> } : null; },
  salary: () => ({ title: "Salary & fixed payments", body: <SalarySheet /> }),
  fixed: () => ({ title: "Add a fixed payment", body: <FixedSheet /> }),
  rules: () => ({ title: "Saved payee rules", body: <RulesSheet /> }),
  setup: (arg) => ({ title: "Your banks and cards", body: <SetupSheet arg={arg} /> }),
  sms: (id) => ({ title: "From your SMS", body: <SmsSheet id={id} /> }),
  "sms-trial": () => ({ title: "SMS vs email", body: <SmsTrialSheet /> }),
  rewcard: (g) => { const h = E.rewMonth().find((x) => x.g === g); return h ? { title: h.short + " this month", body: <RewCardSheet g={g} /> } : null; },
  tripcard: (id) => (E.tripCardById(id) ? { title: E.tripCardById(id).name, body: <TripCardSheet id={id} /> } : null),
  "trip-sources": () => ({ title: "Where the numbers come from", body: <TripSourcesSheet /> }),
  "trip-income": () => ({ title: "Your income a year", body: <TripIncomeSheet /> }),
  pin: () => ({ title: "App lock code", body: <PinSheet /> }),
  "trip-spend": () => ({ title: "Your month on a card", body: <TripSpendSheet /> }),
  "about-trips": about("Points for this trip", "Flights are the airline's own award price from Delhi, one way for one person, times two, times the travellers, in the class you picked. The hotel is priced through Accor (ibis, Novotel, Mercure, Pullman, Sofitel, Fairmont): 2,000 points take €40 off any stay, so the points follow the room price. One room for every two travellers. The usual valuations make Marriott and IHG cost more card points for the same room on every card here, so they are left out. Award seats are limited: having the points doesn't promise a seat on your dates, so aim to have them about two months early."),
  "about-coming": about("Coming up", "Card bills on their due dates, statements closing, card EMIs, your salary and the transfers it sends, and fixed payments. Outlined items are statements closing and EMIs being charged to a card: they aren't money leaving your bank that day."),
  "about-float": about("Best card to use today", "Spend on a card today and it lands on that card's next statement, so you pay it on that statement's due date. The card whose statement closed most recently gives the longest wait, all of it interest-free as long as every bill is paid in full by its due date. Cards with an unpaid bill past its due date are left out: new spending on them is charged interest until that bill is cleared. Under RBI rules you can ask your bank to move a card's billing cycle (at least once), for example so every bill falls due just after payday."),
  "about-usual": about("A usual month", "Your take-home pay split by your rule, with no one-off payments like EMIs. Change the split under Settings → Salary & fixed payments."),
  "about-goals": about("Goals", "Goal money comes out of your SIP share under your salary rule (before the rule, out of your pay). The emergency fund gets the rule's share until it reaches its limit. Two or three goals work better than many."),
};
