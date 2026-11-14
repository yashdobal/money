/* Trips: a trip paid for with card points. Top to bottom: what the trip is (where, the hotel and its budget, the flight
   class, the days) → the airline → the points it takes → the best cards for that airline (by conversion, whatever your
   income) → the cards you can get. The maths and the card data are app/trips.js. */
import React, { useState } from "react";
import { View, TextInput } from "react-native";
import { E } from "../store";
import { openSheet } from "../nav";
import { useC, F, darkCard } from "../theme";
import { Fly } from "../alive";
import { T, M, money, Panel, Rows, Row, Ic, Note, Badge, Chips, Seg, Switch, Btn, Press, plural, buzz, hidden, Page } from "../kit";
import { SelectField } from "../form";
import { Icon } from "../icons";

export const pts = (n) => Math.round(n).toLocaleString("en-IN");
export const span = (m) => (m < 12 ? plural(m, "month") : m % 12 ? Math.floor(m / 12) + " yr " + (m % 12) + " mo" : plural(m / 12, "year"));
export const monthOf = (d) => E.MON[d.getMonth()] + " " + d.getFullYear();
export const lakh = (n) => "₹" + (Math.round(n / 10000) / 10).toLocaleString("en-IN") + "L";
export const cabinName = (n) => (n.cabin === "j" ? "Business" : "Economy");
export const tripWhere = (n) => n.country.name + " · " + plural(n.people, "person", "people") + " · " + plural(n.nights, "night") + " · " + cabinName(n);
export const tripRatio = (r) => (r === 1 ? "1 for 1" : (Number.isInteger(r) ? r : r * 2) + " make " + (Number.isInteger(r) ? 1 : 2));
export const tripRate = (r) => String(Math.round(r * 100) / 100);

export default function Trips({ first }) {
  const m = E.tripModel();
  return (
    <Page id="trips">
      <Trip m={m} first={first} />
      <Airline m={m} first={first} />
      <Points m={m} first={first} />
      <Best m={m} first={first} />
      <Get m={m} first={first} />
      <Foot m={m} first={first} />
    </Page>
  );
}

/* ---------------- your trip ---------------- */
function Stepper({ k, label, value, max }) {
  const C = useC();
  const btn = (d, sign, word) => {
    const off = d < 0 ? value <= 1 : value >= max;
    return (
      <Press disabled={off} scale={0.9} onPress={() => E.act.setTrip(k, value + d)} accessibilityLabel={word + " " + label.toLowerCase()}
        style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: C.surface, boxShadow: C.card, opacity: off ? 0.35 : 1 }}>
        <T f={F.medium} s={20} lh={22} style={{ letterSpacing: 0 }}>{sign}</T>
      </Press>
    );
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingLeft: 14, paddingRight: 8, borderRadius: 14, backgroundColor: C.inset }}>
      <T f={F.medium} s={14} lh={18} c={C.ink2} lines={1} style={{ flex: 1 }}>{label}</T>
      {btn(-1, "−", "Fewer")}
      <T f={F.semi} s={17} lh={22} style={{ minWidth: 24, textAlign: "center" }} accessibilityLabel={label + ": " + value}>{String(value)}</T>
      {btn(1, "+", "More")}
    </View>
  );
}
/** A rupee amount you can type over (the planner's .sl-num). Empty hands back null: use the app's own figure. */
function Amount({ value, placeholder, onDone, label, width = 112, plain }) {
  const C = useC();
  const [text, setText] = useState(null);
  const shown = text !== null ? text : value === null || value === undefined ? "" : hidden() && !plain ? "••••" : money(value);
  return (
    <TextInput value={shown} placeholder={placeholder} placeholderTextColor={C.ink3} onFocus={() => setText(value === null || value === undefined ? "" : String(Math.round(value)))}
      onChangeText={(t) => setText(t.replace(/[^\d.]/g, ""))} keyboardType="numeric" selectTextOnFocus accessibilityLabel={label}
      onBlur={() => { const v = parseFloat(text); const was = text; setText(null); if (isFinite(v)) onDone(Math.round(v)); else if (was === "") onDone(null); }}
      style={{ width, textAlign: "right", color: C.ink, fontFamily: F.semi, fontSize: 15, letterSpacing: -0.3, paddingVertical: 2, paddingHorizontal: 0, borderBottomWidth: 1.5, borderBottomColor: text !== null ? C.accent : C.line2, includeFontPadding: false }} />
  );
}
function Q({ children, top }) {
  const C = useC();
  return <T f={F.semi} s={11.5} lh={16} c={C.ink3} style={{ letterSpacing: 0.5, textTransform: "uppercase", marginTop: top ? 2 : 18, marginBottom: 8 }}>{children}</T>;
}
function Line({ label, sub, children }) {
  const C = useC();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }}>
      <View style={{ flex: 1, minWidth: 0 }}><T f={F.medium} s={14.5} lh={20}>{label}</T>{sub ? <T s={12.5} lh={16} c={C.ink3} lines={1}>{sub}</T> : null}</View>
      {children}
    </View>
  );
}
/* ---------------- 1 · the trip ---------------- */
function Trip({ m, first }) {
  const D = E.TRIP_DATA, p = m.plan, n = m.need;
  const now = new Date();
  const months = [["", "No date yet"]].concat(Array.from({ length: 48 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() + 1 + i, 1); return [E.ymOf(d), monthOf(d)]; }));
  const touched = E.overrides.trip && Object.keys(E.overrides.trip).length > 0;
  return (
    <Panel title="Your trip" kind="w" i={0} first={first} right={touched ? <Btn kind="link" small label="Start again" onPress={() => { buzz("tick"); E.act.resetTrip(); }} /> : null}>
      <Q top>Where to</Q>
      <Chips value={p.country} onChange={(v) => E.act.setTrip("country", v)} options={D.countries.map((c) => [c.id, c.name])} />
      <Q>Hotel</Q>
      <Line label="Pay for the hotel with points" sub="off: you pay for the stay yourself">
        <Switch value={p.stay} onChange={(v) => E.act.setTrip("stay", v ? null : false)} label="Pay for the hotel with points" />
      </Line>
      {p.stay ? (
        <View>
          <Line label="Budget"><Seg label="Hotel budget" value={p.hotel} onChange={(v) => E.act.setTrip("hotel", v)} options={D.hotelTier.map((t, i) => [i, t.charAt(0).toUpperCase() + t.slice(1)])} /></Line>
          <Line label="A room for a night" sub={n.typed ? "your price · usually " + money(n.usual) : "the usual " + D.hotelTier[n.tier] + " price in " + n.country.name}>
            <Amount plain value={n.typed ? p.night : null} placeholder={money(n.usual)} label="A room for a night in rupees" onDone={(v) => E.act.setTrip("night", v)} />
          </Line>
        </View>
      ) : null}
      <Q>Flight</Q>
      <Line label="Class"><Seg label="Flight class" value={p.cabin} onChange={(v) => E.act.setTrip("cabin", v)} options={D.cabins.map((c) => [c.id, c.name])} /></Line>
      <Q>Travel days</Q>
      <View style={{ gap: 8 }}>
        <Stepper k="nights" label="Nights" value={p.nights} max={30} />
        <Stepper k="people" label="Travellers" value={p.people} max={6} />
      </View>
      <SelectField label="When you want to fly (if you know)" value={p.when} options={months} onChange={(v) => E.act.setTrip("when", v || null)} style={{ marginTop: 14 }} />
    </Panel>
  );
}

/* ---------------- 2 · the airline ---------------- */
function Airline({ m, first }) {
  const C = useC();
  const D = E.TRIP_DATA, n = m.need, cab = cabinName(n).toLowerCase();
  return (
    <Panel title="Airline" i={1} first={first}>
      <Rows>
        {n.airs.map((a, i) => {
          const on = a.id === n.airline, A = D.air[a.id];
          return <Row key={a.id} first={i === 0} icon={on ? <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: C.accent, alignItems: "center", justifyContent: "center", overflow: "hidden" }}><Fly><Icon name="trips" size={20} color={C.accentInk} /></Fly></View> : <Ic name="trips" />}
            title={a.id === n.preferred ? <>{A.short + "  "}<Badge text="Preferred" tone="pos" /></> : A.short}
            detail={pts(a.oneWay) + " " + A.unit + " each way" + (A.via ? " · " + A.via : "")} value={pts(a.total)} sub={"for " + plural(n.people, "person", "people")}
            onPress={() => { buzz("tick"); E.act.setTrip("air", a.id === n.preferred ? null : a.id); }} />;
        })}
      </Rows>
      <Note style={{ marginTop: 10, marginBottom: 0 }}>{n.airs.length > 1 ? D.air[n.preferred].short + " is preferred because it asks for the fewest points. Tap the other to plan with it instead."
        : "Only " + D.air[n.airline].short + " has a confirmed " + cab + " price from Delhi to " + n.country.city + "."}</Note>
      {n.noBusiness ? <View style={{ marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: C.warnSoft }}><T s={14} lh={20} c={C.ink2}>{"No confirmed business-class price to " + n.country.name + " on either airline, so the flights are counted in economy."}</T></View> : null}
    </Panel>
  );
}

/* ---------------- 3 · the points ---------------- */
function Points({ m, first }) {
  const C = darkCard(useC());                         // a dark card: the colours named here are its own
  const D = E.TRIP_DATA, n = m.need, air = D.air[n.airline];
  const notes = ["Taxes and airport fees on award tickets are paid in cash and aren't counted."];
  if (n.stay && n.country.rough && !n.typed) notes.push("Room prices for " + n.country.name + " are a rough guide. Type your own above if you know it.");
  return (
    <Panel title="Points for this trip" kind="d" info onInfo={() => openSheet("about-trips")} i={2} first={first}>
      <T f={F.medium} s={13} lh={18} c={C.ink2}>{tripWhere(n)}</T>
      <T f={F.hero} s={40} lh={46} style={{ marginTop: 4 }}>{pts(n.flight.total)}</T>
      <T s={14.5} lh={21} c={C.ink2} style={{ marginTop: 4 }}><T f={F.semi} s={14.5} lh={21}>{air.name + " " + air.unit}</T>{" for the flights: " + pts(n.flight.oneWay) + " each way × " + plural(n.people, "person", "people") + ", Delhi to " + n.country.city + " and back."}</T>
      {n.stay ? (
        <Rows style={{ marginTop: 12, paddingHorizontal: 12, borderRadius: 14, backgroundColor: C.inset }}>
          <Row first icon={<Ic name="bed" />} title={"Hotel, " + D.hotelTier[n.tier] + (n.typed ? " (your price)" : "")}
            detail={plural(n.nights, "night") + " · " + plural(n.rooms, "room") + " at " + money(n.nightly) + " = " + money(n.hotelCost)} value={pts(n.accorPts)} sub="Accor points" />
        </Rows>
      ) : (
        <View style={{ marginTop: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: C.accentSoft }}><T s={14.5} lh={21} c={C.ink2}>The hotel isn't counted: you pay for the stay yourself.</T></View>
      )}
      {notes.map((t, i) => <Note key={i} style={{ marginTop: i ? 0 : 10, marginBottom: i === notes.length - 1 ? 0 : 8 }}>{t}</Note>)}
    </Panel>
  );
}

/* ---------------- 4 · the best cards for that airline ---------------- */
const named = (x, invite) => (x.owned ? <>{x.card.name + "  "}<Badge text="Yours" tone="pos" /></> : invite && x.card.status !== "open" ? <>{x.card.name + "  "}<Badge text="Invite only" /></> : x.card.name);
function Best({ m, first }) {
  const D = E.TRIP_DATA, air = D.air[m.need.airline];
  return (
    <Panel title={"Best cards for " + air.short} i={3} first={first}>
      <Note>{"Best conversion first, whatever your income: the " + air.short + " " + air.unit + " that ₹100 of everyday spending turns into."}</Note>
      <Rows>
        {m.best.map((x, i) => {
          const done = x.run && x.run.months !== null;
          return <Row key={x.card.id} first={i === 0} icon={<Ic name="cards" />} title={named(x, true)}
            detail={tripRatio(x.fl.ratio) + (done ? " · " + (x.run.spend ? lakh(x.run.spend) + " to spend" : "you have the points") : "")} value={tripRate(x.rate)} sub="per ₹100"
            onPress={() => openSheet("tripcard:" + x.card.id)} />;
        })}
      </Rows>
      {m.off.length ? <Note style={{ marginTop: 10, marginBottom: 0 }}>{"Not listed because their points don't move to " + air.short + ": " + m.off.map((x) => x.card.name).join(", ") + "."}</Note> : null}
    </Panel>
  );
}

/* ---------------- 5 · the cards you can get ---------------- */
function Get({ m, first }) {
  const D = E.TRIP_DATA, air = D.air[m.need.airline], inc = m.income;
  return (
    <Panel title="Cards you can get" i={4} first={first}>
      {m.get.length ? (
        <Rows>{m.get.map((x, i) => <Row key={x.card.id} first={i === 0} icon={<Ic name="cards" />} title={named(x)} chevron onPress={() => openSheet("tripcard:" + x.card.id)} />)}</Rows>
      ) : <Note>{"None of the cards that move to " + air.short + " is open to you on the income this goes by."}</Note>}
      <Note style={{ marginTop: 10, marginBottom: 4 }}>{(inc.from === "salary" ? "Going by your salary, in the same order as above." : inc.from === "you" ? "Going by the income you set, in the same order as above." : "Your income isn't set, so every card open to apply is listed.") + " The bank still decides each application."}</Note>
      <View style={{ alignItems: "flex-start", paddingHorizontal: 6 }}><Btn kind="link" small label={inc.from ? "Change the income used" : "Set your income"} onPress={() => openSheet("trip-income")} /></View>
    </Panel>
  );
}

function Foot({ m, first }) {
  const D = E.TRIP_DATA, p = m.plan;
  const basis = p.spend !== null || p.travel !== null ? "the figures you typed" : m.prof.basis === "months" ? "your last " + plural(m.prof.n, "full month") : m.prof.basis === "month" ? "this month so far" : "";
  return (
    <Panel kind="w" i={5} first={first}>
      <Note style={{ marginTop: 0, marginBottom: 4 }}>{m.known ? "The spending and time shown for each card use " + (hidden() ? "••••" : money(m.mix.earning)) + " a month of card spending (" + basis + ")." : "The spending shown for each card uses " + money(50000) + " a month until you add your own."}</Note>
      <View style={{ alignItems: "flex-start", marginBottom: 12 }}><Btn kind="link" small label="Change the monthly spending" onPress={() => openSheet("trip-spend")} /></View>
      <Note style={{ marginTop: 0 }}>{"Card terms, transfer rates and award prices were checked on " + E.fmt(E.parseISO(D.checked)) + " " + D.checked.slice(0, 4) + ". They change often, award seats aren't always there, and the bank decides who gets a card. This is arithmetic to plan with, not financial advice."}</Note>
      <View style={{ alignItems: "flex-end" }}><Btn kind="link" small label="Where the numbers come from" onPress={() => openSheet("trip-sources")} /></View>
    </Panel>
  );
}
