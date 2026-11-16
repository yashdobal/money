/* Plan: the salary planner (split each salary with sliders), the calendar, goals and EMIs. */
import Flow from "../flow";
import React, { useEffect, useRef, useState } from "react";
import { Animated, View, TextInput } from "react-native";
import { E, toast } from "../store";
import { openSheet } from "../nav";
import { useC, F } from "../theme";
import { T, M, amt, money, Panel, Rows, Row, Ic, DotIc, Sw, DayHead, Note, Badge, SplitBar, Legend, Bar, SubHead, Seg, Btn, AddRow, XBtn, Press, Card, plural, dayName, cap, buzz, settleAt, hidden, Page } from "../kit";
import { Ring } from "../charts";
import { S, springTo, motionOn } from "../motion";
import Slider from "../slider";
import { SheenFill, Ping } from "../alive";

export default function Plan({ first }) {
  return (
    <Page id="plan">
      <Planner first={first} />
      <Flow first={first} />
      <Calendar first={first} />
      <Goals first={first} />
      <Emis first={first} />
    </Page>
  );
}

const lastLight = { t: 0 };   // while dragging, the figures follow at most ~14 times a second (the knob follows every move)
function Planner({ first }) {
  const C = useC();
  const [drag, setDrag] = useState(null);
  if (!E.settings.inc) return (
    <Panel title="Your salary" kind="w" i={0} first={first}>
      <Note>Set your monthly take-home pay and the planner splits each salary for you.</Note>
      <Btn label="Set take-home pay" onPress={() => openSheet("salary")} />
    </Panel>
  );
  const base = E.planCycle(), view = E.planCycleView(), mp = E.monthPlan(view), sal = mp.sal, e = sal.exp || {}, A = mp.amt;
  const pct = (v) => (A > 0 ? Math.round((v / A) * 100) + "%" : "");
  const fmt = E.fmt;
  const title = "Your " + fmt(sal.inBalance ? mp.cyc.p0 : sal.credited || mp.cyc.p0) + " salary";
  const chip = sal.credited ? <Badge text="Credited" tone="pos" /> : e.partial && e.assumed ? <Badge text="Not confirmed" tone="warn" /> : <Badge text="Estimate" />;
  const note = sal.inBalance ? "No alert for it, but it's in the balance you set on " + fmt(sal.credited) + ". Split it below; Safe to spend follows."
    : sal.credited ? "Came in on " + fmt(sal.credited) + ". Split it below; Safe to spend follows."
    : e.partial ? (e.assumed ? "Depends on your joining date: " + e.worked + " of " + e.dim + " days, as if you join " + fmt(e.join) + "." : "You joined on " + fmt(e.join) + ", so it covers " + e.worked + " of " + e.dim + " days.")
    : "Expected on " + fmt(mp.cyc.p0) + (view.ahead ? ". Plan it now; it takes over on payday." : ". Drag it if your payslip says otherwise.");
  const salMax = Math.ceil((Math.max(E.settings.inc || 0, mp.def.sal, A, 10000) * 1.5) / 5000) * 5000;
  const SL = [
    { k: "sal", label: "Salary", c: C.ink },
    { k: "family", label: E.familyTitle(), c: C.nFamily },
    { k: "sip", label: "SIP", c: C.nSip },
    { k: "ef", label: "Emergency fund", c: C.nEf }];
  const one = (x) => {
    const v0 = x.k === "sal" ? A : mp[x.k], v = drag && drag.k === x.k ? drag.v : v0, def = mp.def[x.k], big = x.k === "sal";
    const max = big ? salMax : Math.max(1000, Math.ceil(Math.max(A, v) / 1000) * 1000);
    const moved = Math.abs(v0 - def) >= 1, sp = mp.split;
    const why = !moved && sp ? (x.k === "ef" && sp.efTake >= 0.5 ? (v0 < 0.5 ? "paused for the EMI" : "less the EMI") : x.k === "ef" && sp.efFull ? "fund is full" : x.k === "sip" && sp.savTake >= 0.5 ? "after the EMI" : "") : "";
    const sub = big ? (moved ? (sal.credited ? "credited " : "estimate ") + money(def) : "") : moved ? (mp.rule ? "rule " : "plan ") + money(def) : why;
    return (
      <View key={x.k} style={{ marginTop: big ? 16 : 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {big ? null : <Sw c={x.c} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <T f={big ? F.semi : F.medium} s={big ? 15.5 : 14.5} lh={20} lines={1}>{x.label}</T>
            {sub ? <T s={12.5} lh={16} c={C.ink3} lines={1}>{sub}</T> : null}
          </View>
          <AmountField value={v} label={x.label} big={big} onDone={(n) => E.act.setPlan(x.k, n, false)} />
          {big ? null : <T s={12.5} c={C.ink3} style={{ width: 36, textAlign: "right" }}>{pct(v)}</T>}
        </View>
        <Slider value={v} max={max} color={x.c} label={x.label}
          onChange={(n) => { setDrag({ k: x.k, v: n }); const t = Date.now(); if (t - lastLight.t > 70) { lastLight.t = t; E.act.setPlan(x.k, n, true); } }}
          onDone={(n) => { setDrag(null); E.act.setPlan(x.k, n, false); }} />
      </View>
    );
  };
  const parts = [["EMI", mp.fixedTotal, C.nEmi], [E.familyTitle(), mp.family, C.nFamily], ["SIP", mp.sip, C.nSip], ["Emergency", mp.ef, C.nEf],
    ["Cards", mp.cardsTotal, C.nCard], ["Yours", Math.max(0, mp.spend), C.nYours]].filter((x) => x[1] >= 1);
  const swBox = (c) => <View style={{ width: 40, alignItems: "center" }}><Sw c={c} /></View>;
  return (
    <Panel kind="w" i={0} first={first}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <T f={F.medium} s={13} lh={18} c={C.ink2}>Salary planner</T>
          <T f={F.head} s={18} lh={24} style={{ marginTop: 2 }}>{title}</T>
        </View>
        {chip}
      </View>
      {!base.upcoming ? <Seg full style={{ marginTop: 12 }} value={view.ahead ? "next" : "cur"} onChange={(v) => E.act.planView(v)}
        options={[["cur", "This month · " + fmt(base.p0)], ["next", "Next · " + fmt(E.nextCycle(base).p0)]]} label="Which salary" /> : null}
      <T s={14} lh={20} c={C.ink2} style={{ marginTop: 10 }}>{note}</T>
      {one(SL[0])}
      {mp.fixed.map((p, k) => (
        <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 14, backgroundColor: C.inset, minHeight: 54 }}>
          <Sw c={C.nEmi} />
          <View style={{ flex: 1 }}><T f={F.medium} s={14.5} lh={19}>{p.name}</T><T s={12.5} lh={16} c={C.ink3}>{fmt(E.parseISO(p.due)) + " · comes off first"}</T></View>
          <M v={p.amt} o={{ sign: "out" }} />
        </View>
      ))}
      {mp.fixed.length ? <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10 }}><T s={14} c={C.ink2}>Left to split</T><M v={A - mp.fixedTotal} f={F.semi} s={14} c={C.ink2} /></View> : null}
      <SubHead>Split it</SubHead>
      {SL.slice(1).map(one)}
      {mp.cards.length ? (
        <View>
          <SubHead right={<M v={-mp.cardsTotal} s={15} />}>Card bills · paid from this salary</SubHead>
          <Rows>{mp.cards.map((c, k) => <Row key={k} icon={swBox(C.nCard)} title={c.name}
            detail={(c.billed ? "bill of " + fmt(c.stmt) : "so far · bills " + fmt(c.stmt)) + " · due " + fmt(c.due) + (c.paid ? " · paid" : "") + (c.back >= 0.5 ? " · " + (hidden() ? "••••" : money(c.back)) + " back from others" : "")} value={amt(c.amt, { sign: "out" })} />)}</Rows>
        </View>
      ) : null}
      <View style={{ marginTop: 20, padding: 16, borderRadius: 14, backgroundColor: C.accentSoft, overflow: "hidden" }}>
        <SheenFill strength={0.5} every={7600} id="pr" />
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <T f={F.semi} s={15} lh={19}>Yours to spend</T>
            <T s={12.5} lh={16} c={C.ink2}>{mp.spend < 0 ? (mp.cardsTotal >= 1 ? "card bills and the split are more than the salary" : "the split is more than the salary")
              : A > 0 ? pct(mp.spend) + " of the salary" + (mp.cardsTotal >= 1 ? ", after card bills" : "") : ""}</T>
          </View>
          <M v={mp.spend} f={F.fig} s={27} tone={mp.spend < 0 ? "alert" : ""} style={{ lineHeight: 32 }} />
        </View>
        <SplitBar parts={parts} style={{ marginTop: 12 }} delay={settleAt(0, first)} />
        <Legend small items={parts.map((x) => [x[0] + " " + pct(x[1]), x[2]])} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
        {mp.edited ? <Btn kind="link" small label={mp.rule ? "Back to your rule" : "Back to the plan"} onPress={() => E.act.resetPlan()} /> : <View />}
        <Btn kind="link" small label="Salary settings" onPress={() => openSheet("salary")} />
      </View>
    </Panel>
  );
}

/** .sl .num: the amount, which you can also type (an underline; the salary's is big). */
function AmountField({ value, onDone, big, label }) {
  const C = useC();
  const [text, setText] = useState(null);
  const shown = text !== null ? text : hidden() ? "••••" : money(value);
  return (
    <TextInput value={shown} onFocus={() => setText(String(Math.round(value)))} onChangeText={(t) => setText(t.replace(/[^\d.]/g, ""))}
      onBlur={() => { const v = parseFloat(text); setText(null); if (isFinite(v)) onDone(v); }} keyboardType="numeric" selectTextOnFocus accessibilityLabel={label + " amount in rupees"}
      style={{ width: big ? 160 : 104, textAlign: "right", color: C.ink, fontFamily: big ? F.fig : F.semi, fontSize: big ? 25 : 15, paddingVertical: 2, paddingHorizontal: 0,
        borderBottomWidth: 1.5, borderBottomColor: text !== null ? C.accent : C.line2, letterSpacing: big ? -0.9 : -0.3, includeFontPadding: false }} />
  );
}

/** The next five weeks, Monday first; the chosen day's circle glides to where you tap. */
function Calendar({ first }) {
  const C = useC();
  const today = E.sod(new Date()), start = E.addDays(today, -((today.getDay() + 6) % 7));
  const [sel, setSel] = useState(E.iso(today));
  const [cw, setCw] = useState(0);
  const gx = useRef(new Animated.Value(0)).current, gy = useRef(new Animated.Value(0)).current;
  const cards = E.allCards(), hero = E.heroModel(cards), ev = E.calendarEvents(cards, hero.f || null);
  const by = {};
  ev.forEach((e) => { const k = E.iso(e.d); (by[k] = by[k] || []).push(e); });
  const dotC = { in: C.pos, bill: C.alert, out: C.ink2 };
  const idx = (k) => E.days(start, E.parseISO(k));
  const cellW = cw / 7, cellH = 48, gap = 4;
  const glide = (k, animate) => {
    const i = idx(k), x = (i % 7) * cellW, y = Math.floor(i / 7) * (cellH + gap);
    if (animate && motionOn()) Animated.parallel([springTo(gx, x, S.small), springTo(gy, y, S.small)]).start(); else { gx.setValue(x); gy.setValue(y); }
  };
  useEffect(() => { if (cw) glide(sel, false); }, [cw]);
  // five weeks, each its own row of seven equal cells: a wrapping row of cw/7-wide cells can add up to a hair more
  // than cw once the phone rounds to whole pixels, and then the seventh day drops to the next line
  const cells = [];
  for (let i = 0; i < 35; i++) {
    const d = E.addDays(start, i), k = E.iso(d), list = by[k] || [], kinds = [...new Set(list.filter((e) => e.dot !== "stmt").map((e) => e.dot))];
    const isT = k === E.iso(today), past = d < today, d1 = d.getDate() === 1;
    cells.push(
      <Press key={k} scale={0.92} onPress={() => { setSel(k); glide(k, true); }} accessibilityLabel={E.fmtD(d) + (list.length ? ", " + plural(list.length, "item") : "")}
        style={{ flex: 1, minWidth: 0, height: cellH, alignItems: "center", justifyContent: "center", gap: 3 }}>
        {d1 ? <T f={F.semi} s={9.5} lh={11} c={C.accent} style={{ textTransform: "uppercase", letterSpacing: 0.5, marginTop: -6 }}>{E.MON[d.getMonth()].slice(0, 3)}</T> : null}
        {isT ? <View pointerEvents="none" style={{ position: "absolute", top: 4, width: 30, height: 30, borderRadius: 15, backgroundColor: C.accentSoft }} /> : null}
        {isT ? <Ping size={30} color={C.accent} grow={1.45} style={{ top: 4 }} /> : null}
        <T f={isT ? F.bold : F.medium} s={15} lh={18} c={isT ? C.accent : past ? C.ink3 : C.ink}>{d.getDate()}</T>
        <View style={{ flexDirection: "row", gap: 3, height: 6 }}>{kinds.map((x) => <View key={x} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotC[x] }} />)}</View>
      </Press>
    );
  }
  const items = by[sel] || [], sd = E.parseISO(sel);
  return (
    <Panel title="Calendar" kind="w" i={1} first={first}>
      <Legend small items={[["Money in", C.pos], ["Card bill", C.alert], ["Transfers", C.ink2]]} style={{ marginBottom: 10 }} />
      <View style={{ flexDirection: "row", marginBottom: 6 }}>{["M", "T", "W", "T", "F", "S", "S"].map((x, i) => <T key={i} s={12} lh={15} c={C.ink3} style={{ flex: 1, textAlign: "center" }}>{x}</T>)}</View>
      <View onLayout={(e) => setCw(e.nativeEvent.layout.width)}>
        {cw ? <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: cellW, height: cellH, borderRadius: 12, backgroundColor: C.accentSoft, transform: [{ translateX: gx }, { translateY: gy }] }} /> : null}
        {[0, 1, 2, 3, 4].map((w) => <View key={w} style={{ flexDirection: "row", marginBottom: gap }}>{cells.slice(w * 7, w * 7 + 7)}</View>)}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: C.line, marginTop: 12, paddingTop: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}><T f={F.semi} s={14}>{dayName(sd)}</T><T s={13} c={C.ink3}>{E.fmt(sd)}</T></View>
        {items.length ? <Rows>{items.map((e, i) => <Row key={i} icon={<DotIc kind={e.dot} />} soft={e.soft} title={e.title} detail={e.detail}
          value={e.amt === null ? null : e.soft ? amt(Math.abs(e.amt)) : amt(e.amt, { sign: "plus" })} tone={e.soft ? "soft" : e.dot === "in" ? "pos" : ""} />)}</Rows>
          : <T s={14} c={C.ink3} style={{ paddingVertical: 10 }}>Nothing on this day.</T>}
      </View>
    </Panel>
  );
}

function Goals({ first }) {
  const C = useC();
  const [del, setDel] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const list = E.goalPlan(E.payCycle());
  const PRIO = ["", "high", "medium", "low"];
  return (
    <Panel title="Goals" info onInfo={() => openSheet("about-goals")} i={2} first={first}>
      {list.length ? list.map((p, gi) => {
        const g = p.g, color = p.done ? C.pos : p.short >= 1 ? C.warn : C.accent;
        const detail = p.byEmi ? (p.done ? "all instalments due by now" : "next " + money(p.byEmi.next.amt) + " on " + E.fmt(E.parseISO(p.byEmi.next.due)))
          : p.byRule ? Math.round(E.SALARY_RULE.ef * 100) + "% of each salary, until full"
          : "by " + E.fmt(p.due) + " " + p.due.getFullYear() + (p.done ? "" : " · " + plural(p.monthsLeft, "month") + " left");
        const line = p.byEmi ? "" : p.done ? "Reached." : "This month " + money(p.funded) + " planned, " + money(p.movedNow) + " moved" + (p.short >= 1 ? " · " + money(p.short) + " short" : "");
        const recent = E.contribs.filter((c) => c.goal === g.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
        return (
          <Card key={g.id} first={gi === 0}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <Ring pct={p.pct} color={color} delay={settleAt(2, first)} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <T f={F.medium} s={14.5} lh={19} lines={1} style={{ flexShrink: 1 }}>{cap(g.name)}</T>
                  {p.byEmi ? <Badge text="EMI" /> : g.prio && !p.byRule ? <Badge text={PRIO[g.prio || 2]} /> : null}
                </View>
                <T s={13} lh={17} c={C.ink3} lines={1}>{detail}</T>
              </View>
              <View style={{ alignItems: "flex-end" }}><M v={p.saved} /><T s={12.5} lh={16} c={C.ink3}>{"of " + (hidden() ? "••••" : amt(g.target))}</T></View>
            </View>
            {line ? <T s={13.5} lh={19} c={p.short >= 1 ? C.warn : C.ink2} style={{ marginLeft: 66, marginTop: 6 }}>{line}</T> : null}
            <View style={{ flexDirection: "row", gap: 8, marginLeft: 66, marginTop: 10 }}>
              {p.done || p.byEmi ? null : <Btn kind="ghost" small label="Move money" onPress={() => openSheet("move:" + g.id)} />}
              <Btn kind="ghost" small danger={del === g.id} label={del === g.id ? "Tap again to remove" : "Remove"} onPress={() => {
                if (del !== g.id) { setDel(g.id); clearTimeout(timer.current); timer.current = setTimeout(() => setDel(null), 4000); return; }
                setDel(null); E.act.delGoal(g.id); toast("Goal removed");
              }} />
            </View>
            {recent.length ? <View style={{ marginLeft: 66, marginTop: 6 }}><Rows ledger>{recent.map((c) => (
              <Row key={c.id} title={E.fmt(new Date(c.date + "T12:00:00")) + " " + c.date.slice(0, 4)} detail={"moved to " + g.name} value={amt(c.amt)} tone="pos"
                after={<XBtn label="Remove this move" onPress={() => { E.act.delContrib(c.id); toast("Move removed"); }} />} />
            ))}</Rows></View> : null}
          </Card>
        );
      }) : <Note style={{ paddingHorizontal: 6 }}>No goals yet. Add one and Safe to spend makes room for it.</Note>}
      <AddRow label="Add a goal" onPress={() => openSheet("goal")} />
    </Panel>
  );
}

function Emis({ first }) {
  const C = useC();
  const list = E.emiModel();
  return (
    <Panel title="EMIs" i={3} first={first}>
      {list.length ? <View>{list.map((x, i) => {
        const done = x.done >= x.tenure;
        return (
          <Card key={i} first={i === 0} style={{ paddingVertical: 2 }}>
            <Row first icon={<Ic name={x.on === "card" ? "card" : "bank"} />} title={x.name}
              detail={(x.on === "card" ? "on " + x.where : "from " + x.where) + (done ? " · all paid" : x.next ? " · next " + E.fmt(x.next.d) : "")} value={amt(x.per)} sub="a month" />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 50, paddingBottom: 12, marginTop: -4 }}>
              <Bar pct={(x.done / x.tenure) * 100} color={done ? C.pos : C.accent} style={{ flex: 1, marginTop: 0 }} delay={settleAt(3, first) + i * 36} />
              <T s={12} lh={16} c={C.ink3}>{x.done + " of " + x.tenure + " paid" + (done ? "" : " · " + money(x.left) + " left")}</T>
            </View>
          </Card>
        );
      })}</View> : <Note style={{ paddingHorizontal: 6 }}>No EMIs. Card EMIs show up here from the bank's "EMI 1 of 3" alerts, and fixed payments named "… 1 of 3" from Salary settings.</Note>}
    </Panel>
  );
}
