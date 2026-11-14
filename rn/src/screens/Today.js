/* Today: Safe to spend until payday, what needs attention, where you stand, coming up, the bank balance, a usual month. */
import React, { useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { E } from "../store";
import { openSheet, goTo } from "../nav";
import { useC, F, rgba } from "../theme";
import { T, M, amt, money, Panel, Rows, Row, Tile, Ic, DotIc, Sw, DayHead, Note, Rise, Odo, CountUp, SplitBar, More, Btn, IB, plural, dayName, inDays, settleAt, Page } from "../kit";
import { HeroChart, BankChart, bankAhead } from "../charts";
import { HeroLight, Coins, heroTouch } from "../fx";
import { GL, HeroField } from "../gl";
import { motionOn } from "../motion";
import { SheenFill } from "../alive";

export default function Today({ first }) {
  const C = useC();
  const cards = E.allCards(), hero = E.heroModel(cards), net = E.netModel(cards), att = E.attention(cards, hero, net), f = hero.f || null;
  const td = E.sod(new Date()), todayTx = E.txFor(E.ymOf(td)).filter((x) => x.day === td.getDate());
  const spentToday = E.spendOf(todayTx).spend, nToday = todayTx.filter((x) => x.dir === "out" && x.counted).length;
  const ICONS = { goal: "goal", plan: "plan", bank: "bank", mail: "mail", db: "db", gap: "gap" };
  let i = 1;
  return (
    <Page id="today">
      <Hero hero={hero} first={first} />
      {att.length ? (
        <Panel title="Needs attention" i={i++} first={first}>
          <Rows>
            {att.map((x, k) => (
              <Row key={k} icon={<Ic name={ICONS[x.icon] || "card"} tone={x.tone || "ink"} />} title={x.title} detail={x.detail} titleSize={14.5}
                value={x.amt !== null ? amt(x.amt) : null} tone={x.tone === "alert" ? "alert" : ""} chevron={x.amt === null} onPress={() => goTo(x.go)} />
            ))}
          </Rows>
        </Panel>
      ) : null}
      <Rise i={i++} first={first} style={{ flexDirection: "row", gap: 10, marginBottom: 10, padding: 10, borderRadius: 22, backgroundColor: C.tray }}>
        <Tile label="Where you stand" countV={net ? net.now : undefined} value={net ? undefined : "—"} countRun={first} delay={settleAt(2, first)} tone={net && net.now < 0 ? "alert" : ""}
          sub={net ? "after every card" : "set your bank balance"} onPress={() => openSheet("net")} />
        <Tile label="Spent today" countV={spentToday} countRun={first} delay={settleAt(2, first)} sub={nToday ? plural(nToday, "payment") : "nothing yet"} onPress={() => goTo({ view: "activity", d: E.iso(td) })} />
      </Rise>
      <ComingUp cards={cards} f={f} i={i++} first={first} />
      <BankPanel hero={hero} i={i++} first={first} />
      <Usual i={i++} first={first} />
    </Page>
  );
}

/** The Safe to spend card: graphite (or the theme's colour), the living light, the rolling figure, the forecast. */
function Hero({ hero, first }) {
  const C = useC();
  const [box, setBox] = useState(null);
  const ref = useRef(null), org = useRef({ x: 0, y: 0 });
  const touch = (e) => { const { pageX, pageY } = e.nativeEvent; heroTouch.on({ x: pageX - org.current.x, y: pageY - org.current.y }); };
  const start = (e) => { const ev = { nativeEvent: { pageX: e.nativeEvent.pageX, pageY: e.nativeEvent.pageY } };
    if (ref.current && ref.current.measureInWindow) ref.current.measureInWindow((x, y) => { org.current = { x, y }; touch(ev); }); };
  const ink = C.heroInk, ink2 = C.heroInk2;
  const top = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <T f={F.medium} s={14} lh={20} c={ink2}>Safe to spend until payday</T>
      <IB name="info" color={ink2} onPress={() => openSheet("explain")} label="How this is worked out" />
    </View>
  );
  let body;
  if (hero.state !== "ok") {
    const msg = hero.state === "noinc" ? ["Set your monthly take-home pay to see what's safe to spend.", "Set take-home pay", "salary"]
      : ["Enter what your " + E.bankNames() + " app" + (E.BANKS.length > 1 ? "s show" : " shows") + " once. After that, alerts keep " + (E.BANKS.length > 1 ? "them" : "it") + " up to date.", "Set balances", "balance"];
    body = (
      <View>
        <T f={F.hero} s={56} lh={62} c={ink} style={{ marginTop: 8 }}>{E.DATA_IN ? "—" : " "}</T>
        <T s={14} lh={20} c={ink2} style={{ marginTop: 10 }}>{E.DATA_IN ? msg[0] : "Loading your figures…"}</T>
        {E.DATA_IN ? <View style={{ marginTop: 16 }}><HeroBtn label={msg[1]} onPress={() => openSheet(msg[2])} /></View> : null}
      </View>
    );
  } else {
    const t = hero.tiles, d0 = settleAt(0, first);
    const tl = (label, v, sub, k) => (
      <View key={k} style={{ flex: 1, minWidth: 0, gap: 2, paddingVertical: 10, paddingHorizontal: 9, borderRadius: 14, backgroundColor: C.heroTile, overflow: "hidden" }}>
        <T s={12} lh={15} c={ink2} lines={1} style={{ letterSpacing: 0 }}>{label}</T>
        <CountUp v={v} f={F.head} s={15} c={ink} run={first} delay={d0} />
        <T s={11.5} lh={14} c={ink2} lines={1}>{sub}</T>
        <SheenFill strength={0.1} every={6400} delay={k === "a" ? 0 : k === "n" ? 500 : 1000} id="h" />
      </View>
    );
    body = (
      <View>
        <View style={{ marginTop: 8 }}><Odo value={Math.round(t.rest.total)} f={F.hero} s={56} c={ink} run={first} delay={d0 + 60} dur={1250} /></View>
        <T s={14} lh={20} c={hero.tone === "alert" ? "#FF9F92" : ink2} style={{ marginTop: 10 }}>{hero.line}</T>
        <HeroChart c={hero.chart} delay={d0} run={first} />
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          {tl("A day", t.rest.perDay, "for " + plural(t.rest.days, "day"), "a")}
          {t.next ? tl("Next month", t.next.total, amt(t.next.perDay) + " a day", "n") : null}
          {t.usual ? tl("Usual month", t.usual.total, amt(t.usual.perDay) + " a day", "u") : null}
        </View>
      </View>
    );
  }
  return (
    <Rise i={0} first={first} hero>
      <View onLayout={(e) => setBox(e.nativeEvent.layout)} ref={ref} onTouchStart={start} onTouchMove={touch} onTouchEnd={heroTouch.off} onTouchCancel={heroTouch.off} style={{ borderRadius: 24, overflow: "hidden", marginBottom: 10, backgroundColor: C.heroA,
        borderWidth: C.dark ? 1 : 0, borderColor: C.line, shadowColor: "#000", shadowOpacity: C.dark ? 0.6 : 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 14 }, elevation: 8 }}>
        <Svg style={{ position: "absolute", left: 0, top: 0 }} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
          <Defs><LinearGradient id="heroBg" x1="0.15" y1="0" x2="0.6" y2="1"><Stop offset="0" stopColor={C.heroA} /><Stop offset="1" stopColor={C.heroB} /></LinearGradient></Defs>
          <Rect x="0" y="0" width="100" height="100" fill="url(#heroBg)" />
        </Svg>
        {box ? (GL && motionOn() ? <HeroField w={box.width} h={box.height} /> : <HeroLight w={box.width} h={box.height} />) : null}
        <View style={{ paddingTop: 22, paddingHorizontal: 20, paddingBottom: 18 }}>{top}{body}</View>
        <Coins />
      </View>
    </Rise>
  );
}
/** button.solid.on-dark */
function HeroBtn({ label, onPress }) {
  const C = useC();
  return <Btn label={label} onPress={onPress} bg={C.heroInk} fg={C.heroB} />;
}

function ComingUp({ cards, f, i, first }) {
  const days3 = E.comingUp(cards, f);
  if (!days3.length) return null;
  const day = (g, k) => [
    <DayHead key={"h" + k} left={dayName(g.d)} right={g.n === 0 ? E.fmt(g.d) : inDays(g.n)} />,
    ...g.items.map((e, j) => (
      <Row key={k + "-" + j} icon={<DotIc kind={e.dot} />} title={e.title} detail={e.detail} soft={e.soft}
        value={e.amt === null ? null : e.soft ? amt(Math.abs(e.amt)) : amt(e.amt, { sign: "plus" })}
        tone={e.soft ? "soft" : e.dot === "in" ? "pos" : e.dot === "bill" && g.n <= 3 ? "warn" : ""}
        onPress={e.card ? () => goTo({ view: "cards", card: e.card }) : undefined} />
    )),
  ];
  const rest = days3.slice(3);
  return (
    <Panel title="Coming up" info onInfo={() => openSheet("about-coming")} i={i} first={first}>
      <Rows>{days3.slice(0, 3).flatMap(day)}</Rows>
      {rest.length ? <More label={plural(rest.length, "more day")}><Rows>{rest.flatMap((g, k) => day(g, "m" + k))}</Rows></More> : null}
    </Panel>
  );
}

function BankPanel({ hero, i, first }) {
  const C = useC();
  const h = E.balanceHistory();
  if (!h) return E.DATA_IN ? (
    <Panel title="Bank balance" kind="w" i={i} first={first}>
      <Note>{"Enter what your " + E.bankNames() + " app" + (E.BANKS.length > 1 ? "s show" : " shows") + " once. After that, every alert keeps " + (E.BANKS.length > 1 ? "them" : "it") + " up to date and builds the history."}</Note>
      <Btn kind="ghost" small label="Set balances" onPress={() => openSheet("balance")} />
    </Panel>
  ) : null;
  const pts = h.pts.slice(-61), ahead = bankAhead(hero);
  const month = h.pts.slice(-31), low = month.reduce((a, p) => (p.bal < a.bal ? p : a), month[0]), ago = month[0];
  const diff = h.now - ago.bal, age = h.set ? E.days(h.set, new Date()) : null;
  const split = h.parts.map((p) => (p.set ? p.name + " " + money(p.bal) : p.name + " not set")).join(" · ");
  const sub = "From your alerts" + (age !== null ? " · checked " + (age === 0 ? "today" : age === 1 ? "yesterday" : age + " days ago") : "");
  return (
    <Panel title="Bank balance" kind="w" i={i} first={first} right={<View style={{ flexDirection: "row", gap: 14 }}><Btn kind="link" label="Update" onPress={() => openSheet("balance")} /><Btn kind="link" label="History" onPress={() => openSheet("bank")} /></View>}>
      <View onTouchEnd={() => openSheet("bank")}>
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <M v={h.now} f={F.fig} s={27} tone={h.now < 0 ? "alert" : ""} style={{ lineHeight: 32 }} />
          <M text={(diff >= 0 ? "▲ " : "▼ ") + amt(Math.abs(diff)) + " in 30 days"} f={F.semi} s={13} c={diff >= 0 ? C.pos : C.warn} />
        </View>
        <T s={13} lh={17} c={C.ink3} lines={1} style={{ marginTop: 2 }}>{split}</T>
        <T s={13} lh={17} c={C.ink3} lines={1} style={{ marginTop: 2 }}>{sub}</T>
        <BankChart pts={pts} ahead={ahead} marks={h.marks} h={92} delay={settleAt(i, first)} run={first} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4, marginTop: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent }} />
            <T s={13} c={C.ink2}>Lowest this month </T><M v={low.bal} f={F.body} s={13} c={low.bal < 0 ? C.alert : C.ink2} /><T s={13} c={C.ink2}>{" · " + E.fmt(low.d)}</T></View>
          {ahead.length ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 14, borderTopWidth: 1.6, borderStyle: "dashed", borderColor: C.ink3 }} />
            <T s={13} c={C.ink2}>By payday </T><M v={ahead[ahead.length - 1].bal} f={F.body} s={13} c={ahead[ahead.length - 1].bal < 0 ? C.alert : C.ink2} /></View> : null}
        </View>
      </View>
      {h.missing.length ? (
        <View style={{ marginTop: 10 }}>
          <Note>{"Your " + h.missing.join(" and ") + " balance isn't set, so it counts as ₹0."}</Note>
          <Btn kind="ghost" small label={"Set " + h.missing.join(" and ") + " balance"} onPress={() => openSheet("balance")} />
        </View>
      ) : null}
    </Panel>
  );
}

function Usual({ i, first }) {
  const C = useC();
  const u = E.usualMonth(); if (!u) return null;
  const parts = [[E.familyTitle(), u.family, C.nFamily], ["SIP", u.sip, C.nSip], ["Emergency fund", u.ef, C.nEf], ["Yours to spend", u.spend, C.nYours]].filter((x) => x[1] >= 1);
  const pct = (v) => Math.round((v / u.amt) * 100) + "%";
  return (
    <Panel title="A usual month" info onInfo={() => openSheet("about-usual")} i={i} first={first}>
      <SplitBar parts={parts} delay={settleAt(i, first)} />
      <Rows>
        <Row icon={<Ic name="salary" color={C.pos} />} title="Salary" detail="take-home pay" value={amt(u.amt, { sign: "in" })} tone="pos" />
        {parts.map((p) => (
          <Row key={p[0]} icon={<View style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}><Sw c={p[2]} /></View>} title={p[0]}
            detail={p[0] === "Yours to spend" ? amt(u.spend / 30) + " a day" : pct(p[1]) + " of your pay" + (p[0] === "Emergency fund" && u.efFull ? " · full" : "")}
            value={amt(p[1], { sign: p[0] === "Yours to spend" ? "" : "out" })} />
        ))}
      </Rows>
    </Panel>
  );
}
