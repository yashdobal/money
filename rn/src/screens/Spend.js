/* Spending: a month's total against the month before, categories, where it went, and six months. */
import React from "react";
import { View } from "react-native";
import { E } from "../store";
import { nav, setParams, goTo, openSheet } from "../nav";
import { useC, F, darkCard } from "../theme";
import { T, M, amt, Panel, Rows, Row, Tile, CatIc, Chips, Bar, Note, Rise, CountUp, Press, cardLook, nice, plural, catHue, settleAt, Page, SPAN } from "../kit";
import { Donut, Trend } from "../charts";

export default function Spend({ first }) {
  const C = useC();
  const MONTHS = E.MONTHS;
  const ym = MONTHS.includes(nav.params.m) ? nav.params.m : MONTHS[0] || E.ymOf(new Date());
  const s = E.spendModel(ym), name = E.ymName(ym).split(" ")[0];
  const yr = String(new Date().getFullYear());
  const prev = E.ymName(s.prevYM).split(" ")[0];
  const vs = s.vs === null ? null : (s.vs > 0.5 ? "▲ " : s.vs < -0.5 ? "▼ " : "") + Math.abs(Math.round(s.vs)) + "% vs " + prev + (s.isCur ? " by the " + E.ordinal(s.upTo) : "");
  const pick = (k) => setParams((p) => { p.m = k; });
  const d1 = settleAt(1, first);
  const D = darkCard(C);                              // the total sits on a dark card
  return (
    <Page id="spend">
      <Rise i={0} first={first} style={[{ marginBottom: 10 }, SPAN]}>
        <Chips scroll small value={ym} onChange={pick} options={MONTHS.slice(0, 12).map((k) => [k, k.slice(0, 4) === yr ? E.ymName(k, true) : E.ymName(k, true) + " " + k.slice(2, 4)])} />
      </Rise>
      <Panel kind="d" i={1} first={first} key={"t" + ym}>
        <T f={F.medium} s={14} lh={20} c={D.ink2}>{"Spent in " + name}</T>
        <CountUp v={Math.round(s.spend)} f={F.hero} s={46} delay={d1} style={{ lineHeight: 52, marginTop: 4 }} />
        {vs ? <T f={F.medium} s={13.5} lh={19} c={s.vs > 0.5 ? D.warn : s.vs < -0.5 ? D.pos : D.ink2} style={{ marginTop: 6 }}>{vs}</T> : null}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
          <Tile inPanel three label="Per day" value={amt(s.perDay)} sub={s.isCur ? "over " + plural(s.upTo, "day") : "in " + name} />
          <Tile inPanel three label="Biggest" value={s.biggest ? amt(s.biggest.amt) : "—"} sub={s.biggest ? nice(s.biggest.desc).title : "nothing yet"} onPress={s.biggest ? () => openSheet("tx:" + s.biggest.id) : undefined} />
          <Tile inPanel three label={prev.slice(0, 3) + (s.isCur ? " so far" : "")} value={amt(s.lastBy)} sub={s.isCur ? "by the " + E.ordinal(s.upTo) : "the whole month"} />
        </View>
      </Panel>
      {s.cats.length ? (
        <Panel title="Categories" i={2} first={first} key={"c" + ym}>
          <Donut cats={s.cats} total={s.spend} delay={settleAt(2, first)} />
          {s.cats.map((c, k) => (
            <Press key={c.name} scale={0.985} wash onPress={() => goTo({ view: "activity", cat: c.name, m: ym })} style={[cardLook(C), { paddingHorizontal: 12, marginTop: 6 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 58, paddingVertical: 10 }}>
                <CatIc cat={c.name} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T f={F.medium} s={14.5} lh={19} lines={1}>{c.name}</T>
                  <Bar pct={(c.amt / s.cats[0].amt) * 100} color={catHue(c.name)} delay={settleAt(2, first) + k * 36} style={{ marginTop: 6 }} />
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <M v={c.amt} />
                  <T s={12} lh={16} c={C.ink3}>{Math.round(c.pct) + "%"}</T>
                </View>
              </View>
            </Press>
          ))}
          <Rows style={{ marginTop: 6 }}>
            {s.cardRefunds >= 0.5 ? <Row icon={<CatIc cat="Refunds" />} title="Refunds back to cards" detail="taken off the total" value={amt(-s.cardRefunds)} tone="pos" /> : null}
            {s.paybacks >= 0.5 ? <Row icon={<CatIc cat="Paid back" />} title="Paid back by friends" detail="taken off the total" value={amt(-s.paybacks)} tone="pos" /> : null}
          </Rows>
        </Panel>
      ) : <Panel title="Categories" i={2} first={first}><Note style={{ paddingHorizontal: 6 }}>{"Nothing spent in " + name + " yet."}</Note></Panel>}
      {s.payees.length ? (
        <Panel title="Where it went" i={3} first={first} key={"p" + ym}>
          <Rows>{s.payees.map((p, k) => <Row key={k} icon={<CatIc cat={p.cat} />} title={nice(p.name).title} detail={plural(p.n, "payment") + " · " + p.cat} value={amt(p.amt)}
            onPress={() => goTo({ view: "activity", q: p.name, m: ym })} />)}</Rows>
        </Panel>
      ) : null}
      <Panel title="Six months" kind="w" i={4} first={first} right={s.avg ? <T s={13} c={C.ink3}>{"average "}<M v={s.avg} f={F.body} s={13} c={C.ink3} /></T> : null}>
        <Trend s={s} onPick={pick} delay={settleAt(4, first)} />
      </Panel>
    </Page>
  );
}
