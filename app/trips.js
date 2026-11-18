/* =============================================================================================
   Money · Trips on points.

   "How much do I have to spend, and on which card, to pay for a trip with points?" Pick a country, how many of you,
   how many nights and how comfortable; this works out the points the flights and the hotel cost, and for every card
   worth considering: how much spending earns them, how long that takes at your own spending, what it costs in fees,
   and whether your income clears the card's bar.

   It is loaded after engine.js and uses its names (settings, overrides, MONTHS, txFor, act, render, queueSave …).
   Nothing here is used by the server.

   TRIP_DATA is public information only: card terms, transfer ratios, award prices, hotel prices. Every number came
   from a published page and was checked on TRIP_DATA.checked; `src` names the page (TRIP_DATA.sources). Banks and
   airlines change these often, so the screens always show the date and say what could not be confirmed.

   How the points are counted
     Flights  the airline's own award price, one way per person, × 2 × travellers, in the class you pick. The
              preferred airline is the one that asks for fewer points: Air India (Maharaja Club) or Singapore
              Airlines (KrisFlyer); you can pick the other. Taxes and airport fees on award tickets are paid in
              cash and are not counted.
     Cards    ranked for that airline by conversion: the airline points ₹100 of everyday spending turns into
              (what the card earns ÷ how many of its points make one airline point), whatever your income.
     Hotel    Accor (ibis, Novotel, Mercure, Pullman, Sofitel, Fairmont …): 2,000 points take €40 off any stay, so
              the price in points follows the room price. Rooms = one for every two travellers.
     A card   earns points on everyday spending and more on flights and hotels; some spending earns nothing (fuel,
              bills, rent, insurance, fees, taxes, wallet loads). Welcome and milestone points are counted in the
              month they would arrive; the yearly fee (with 18% GST) is counted unless spending waives it.
   ============================================================================================= */
const TRIP_DATA = {
  checked: "2026-11-10",
  /* ₹ for one dollar and one euro */
  fx: {usd:94.5, eur:105, src:["fx-usd", "fx-eur"]},
  /* Accor ALL: 2,000 points = €40 off a stay */
  accor: {per:2000, eur:40, src:["accor"]},
  air: {
    ai: {name:"Air India Maharaja Club", short:"Air India", unit:"points", src:["ai-chart", "ai-press", "ai-aw"]},
    kf: {name:"Singapore Airlines KrisFlyer", short:"KrisFlyer", unit:"miles", via:"via Singapore", src:["kf-chart"]}
  },
  /* flight class: "y" economy, "j" business. hotel budget: 0 budget, 1 mid-range, 2 luxury */
  cabins: [{id:"y", name:"Economy"}, {id:"j", name:"Business"}],
  hotelTier: ["budget", "mid-range", "luxury"],
  /* One-way award prices per person from Delhi. null = no published price found (or the airline doesn't sensibly
     fly it), so that airline isn't used for that cabin. hotel: average price of a room for a night in US dollars
     (budget, mid-range, luxury); rough:true where the usual source couldn't be read and another guide was used. */
  countries: [
    {id:"jp", name:"Japan",       city:"Tokyo",            ai:{y:30000, j:null},   kf:{y:42000, j:88000},  hotel:[43, 107, 245],  hsrc:"byt"},
    {id:"th", name:"Thailand",    city:"Bangkok",          ai:{y:12000, j:null},   kf:{y:20000, j:47500},  hotel:[15, 32, 91],    hsrc:"byt"},
    {id:"sg", name:"Singapore",   city:"Singapore",        ai:{y:12000, j:50000},  kf:{y:19000, j:45000},  hotel:[57, 146, 365],  hsrc:"gotripzi", rough:true},
    {id:"vn", name:"Vietnam",     city:"Ho Chi Minh City", ai:{y:12000, j:null},   kf:{y:20000, j:47500},  hotel:[14, 29, 72],    hsrc:"byt"},
    {id:"id", name:"Bali",        city:"Bali, Indonesia",  ai:{y:12000, j:null},   kf:{y:20000, j:47500},  hotel:[16, 40, 100],   hsrc:"yopki", rough:true},
    {id:"ae", name:"Dubai",       city:"Dubai, UAE",       ai:{y:12000, j:50000},  kf:null,                hotel:[38, 72, 175],   hsrc:"byt"},
    {id:"mv", name:"Maldives",    city:"Malé",             ai:{y:10000, j:null},   kf:null,                hotel:[54, 104, 402],  hsrc:"byt"},
    {id:"lk", name:"Sri Lanka",   city:"Colombo",          ai:{y:10000, j:null},   kf:null,                hotel:[18, 40, 96],    hsrc:"champion", rough:true},
    {id:"kr", name:"South Korea", city:"Seoul",            ai:{y:30000, j:null},   kf:{y:42000, j:88000},  hotel:[29, 49, 86],    hsrc:"byt"},
    {id:"gb", name:"UK",          city:"London",           ai:{y:35000, j:100000}, kf:null,                hotel:[74, 118, 189],  hsrc:"byt"},
    {id:"fr", name:"France",      city:"Paris",            ai:{y:35000, j:null},   kf:null,                hotel:[55, 130, 300],  hsrc:"yopki", rough:true},
    {id:"us", name:"USA",         city:"San Francisco",    ai:{y:40000, j:130000}, kf:{y:55000, j:133000}, hotel:[93, 171, 381],  hsrc:"byt"},
    {id:"au", name:"Australia",   city:"Sydney or Melbourne", ai:{y:50000, j:130000}, kf:{y:42000, j:100000}, hotel:[89, 179, 421], hsrc:"byt"}
  ],
  /* What a card doesn't pay points on, by the kind of spending (tripKind below sorts your payments into these). */
  /* Cards. fee: yearly, before 18% GST. waive: yearly spend that waives the next fee. income: yearly income the bank
     asks for (null = not published). earn: points for every ₹100: base, air (booked with the airline), ota (travel
     sites and hotels). no: kinds of spending that earn nothing. to: this card's points for ONE partner point
     (ai Air India, kf KrisFlyer, accor Accor). capA: the most points that can move to these partners in a calendar
     year. status: "open", "invite" (the bank picks you) or "paused". held: words that pick this card out among the
     cards the app already tracks for you (so it shows as yours without being told). */
  cards: [
    {id:"hsbc-travelone", name:"HSBC TravelOne", bank:"HSBC", pts:"points", fee:4999, waive:800000, income:600000, status:"open", held:"travelone",
     earn:{base:2, air:4, ota:4}, no:["fuel", "utilities", "rent", "insurance", "education", "govt", "wallets", "jewellery"],
     welcome:null, welcomeNote:"₹1,000 cashback and a ₹3,000 PostCard hotel voucher after ₹25,000 of spending in 30 days (no points)",
     milestones:[{at:1200000, pts:10000, per:"year"}], to:{ai:1, kf:1, accor:1},
     note:"Moves 1:1 to both airlines and to Accor, with no yearly limit.", src:["hsbc", "ca-hsbc", "accor"]},
    {id:"axis-horizon", name:"Axis Horizon", bank:"Axis", pts:"EDGE Miles", fee:3000, waive:null, income:600000, status:"open", held:"horizon",
     earn:{base:2, air:5, ota:2}, no:["fuel", "utilities", "rent", "insurance", "education", "govt", "wallets"],
     welcome:{pts:5000, spend:1000, days:30}, renewal:1500, to:{ai:1, kf:1, accor:2}, capA:100000,
     note:"5 miles per ₹100 only on flights booked with the airline or on Axis Travel EDGE; travel sites earn 2.", src:["ca-horizon", "axis-groups", "ci-horizon"]},
    {id:"sbi-miles-elite", name:"SBI Card Miles Elite", bank:"SBI", pts:"Travel Credits", fee:4999, waive:1500000, income:null, status:"open", held:"miles elite",
     earn:{base:1, air:3, ota:3}, no:["fuel", "utilities", "rent", "insurance", "education", "wallets"],
     welcome:{pts:5000, spend:100000, days:60}, milestones:[{at:1200000, pts:20000, per:"year"}], to:{ai:1, kf:null, accor:2}, expire:24,
     note:"No KrisFlyer. Travel Credits expire after 24 months.", src:["ca-sbi", "ca-ai", "accor"]},
    {id:"sbi-miles-prime", name:"SBI Card Miles Prime", bank:"SBI", pts:"Travel Credits", fee:2999, waive:1000000, income:null, status:"open", held:"miles prime",
     earn:{base:1, air:2, ota:2}, no:["fuel", "utilities", "rent", "insurance", "education", "wallets"],
     welcome:{pts:3000, spend:60000, days:60}, milestones:[{at:800000, pts:10000, per:"year"}], to:{ai:1, kf:null, accor:2}, expire:24,
     note:"No KrisFlyer. Travel Credits expire after 24 months.", src:["ca-sbi", "ca-ai", "accor"]},
    {id:"sbi-miles", name:"SBI Card Miles", bank:"SBI", pts:"Travel Credits", fee:1499, waive:600000, income:null, status:"open", held:"card miles",
     earn:{base:0.5, air:1, ota:1}, no:["fuel", "utilities", "rent", "insurance", "education", "wallets"],
     welcome:{pts:1500, spend:30000, days:60}, milestones:[{at:500000, pts:5000, per:"year"}], to:{ai:1, kf:null, accor:2}, expire:24,
     note:"No KrisFlyer. Travel Credits expire after 24 months.", src:["ca-sbi", "ca-ai", "accor"]},
    {id:"hdfc-regalia-gold", name:"HDFC Regalia Gold", bank:"HDFC", pts:"reward points", fee:2500, waive:400000, income:1800000, status:"open", held:"regalia gold",
     earn:{base:2.5, air:2.5, ota:2.5}, no:["fuel", "rent", "govt", "wallets"],
     to:{ai:3, kf:2, accor:2},
     note:"Three points make one Air India point, two make one KrisFlyer mile or Accor point.", src:["ca-hdfc", "accor"]},
    {id:"hdfc-dcb-metal", name:"HDFC Diners Club Black Metal", bank:"HDFC", pts:"reward points", fee:10000, waive:800000, income:3000000, status:"open", held:"diners club black",
     earn:{base:10 / 3, air:10 / 3, ota:10 / 3}, no:["fuel", "rent", "govt", "wallets"], cap:{grocery:2000, utilities:2000},
     milestones:[{at:400000, pts:10000, per:"quarter"}], to:{ai:2, kf:1, accor:2},
     note:"1:1 to KrisFlyer. Diners cards aren't taken everywhere.", src:["ca-dcb", "accor"]},
    {id:"axis-magnus", name:"Axis Magnus", bank:"Axis", pts:"EDGE points", fee:12500, waive:2500000, income:2400000, status:"open", held:"magnus",
     earn:{base:6, air:6, ota:6}, no:["fuel", "utilities", "insurance", "govt", "wallets", "jewellery"],
     to:{ai:2.5, kf:2.5, accor:5}, capA:100000,
     note:"Earns fast, but five points make two airline miles.", src:["ca-magnus", "axis-groups"]},
    {id:"hdfc-infinia", name:"HDFC Infinia", bank:"HDFC", pts:"reward points", fee:12500, waive:null, income:null, status:"invite", held:"infinia",
     earn:{base:10 / 3, air:10 / 3, ota:10 / 3}, no:["fuel", "rent", "govt", "wallets"],
     to:{ai:2, kf:1, accor:2}, why:"By invitation from HDFC only.", src:["accor", "ca-ai"]},
    {id:"icici-times-black", name:"ICICI Times Black", bank:"ICICI", pts:"reward points", fee:20000, waive:null, income:null, status:"invite", held:"times black",
     earn:{base:2, air:2, ota:2}, no:["fuel", "utilities", "rent", "insurance", "education", "govt", "wallets"],
     to:{ai:1, kf:null, accor:null}, why:"By invitation from ICICI only.",
     note:"Moves to Air India only, so the hotel would be paid in cash.", src:["ca-ai"]},
    {id:"sbi-aurum", name:"SBI Card AURUM", bank:"SBI", pts:"reward points", fee:9999, waive:1200000, income:null, status:"invite", held:"aurum",
     earn:{base:4, air:4, ota:4}, no:["fuel", "rent", "govt", "wallets"],
     to:{ai:5, kf:null, accor:null}, why:"By invitation from SBI Card only.",
     note:"Five points make one Air India point (500 at a time). No KrisFlyer or Accor, so the hotel would be paid in cash.", src:["ai-aurum", "ca-aurum"]}
  ],
  /* Cards that would otherwise be on the list, and why they aren't. */
  out: [
    {name:"Axis Atlas", why:"Axis has paused new applications."},
    {name:"American Express (India)", why:"New applications have been paused since March 2025."},
    {name:"Axis Olympus", why:"By invitation only."}
  ],
  sources: {
    "ai-press": {name:"Air India: Maharaja Club changes from 1 April 2026 (press release)", url:"https://www.airindia.com/content/dam/air-india/newsroom/press-releases/pdf/Press-Release-Maharaja-Club-Changes-01Apr26.pdf", at:"1 Apr 2026"},
    "ai-chart": {name:"Magnify: Air India's new economy award chart", url:"https://magnify.club/guides/air-india-maharaja-club-new-award-chart-economy/", at:"3 Apr 2026"},
    "ai-aw":    {name:"AwardWallet: Air India award chart changes (business-class examples)", url:"https://awardwallet.com/news/air-india-maharaja-club-award-chart-changes-2026/", at:"13 Apr 2026"},
    "kf-chart": {name:"Mainly Miles: KrisFlyer award chart (Saver prices from 1 November 2025)", url:"https://mainlymiles.com/wp-content/uploads/2026/10/SQ-KF-Award-Chart-2026.pdf", at:"Oct 2026"},
    "accor":    {name:"CardAdvisor: Accor ALL (2,000 points = €40) and the cards that transfer to it", url:"https://cardadvisor.in/programs/accor-all", at:"24 Oct 2026"},
    "hsbc":     {name:"HSBC India: TravelOne Credit Card", url:"https://www.hsbc.bank.in/credit-cards/products/travelone/", at:"10 Nov 2026"},
    "ca-hsbc":  {name:"CardAdvisor: HSBC TravelOne", url:"https://cardadvisor.in/cards/hsbc-travelone", at:"11 Oct 2026"},
    "ca-horizon": {name:"CardAdvisor: Axis Horizon", url:"https://cardadvisor.in/cards/axis-horizon", at:"11 Oct 2026"},
    "ci-horizon": {name:"Card Insider: Axis Horizon (income needed)", url:"", at:"Jan 2026"},
    "axis-groups": {name:"Magnify: Axis transfer partners, Group A and Group B limits", url:"https://magnify.club/guides/axis-bank-group-a-group-b-transfer-partners/", at:"23 Sep 2026"},
    "ca-magnus": {name:"CardAdvisor: Axis Magnus", url:"https://cardadvisor.in/cards/axis-magnus", at:"Oct 2026"},
    "ca-sbi":   {name:"CardAdvisor: SBI Card Miles, Miles Prime and Miles Elite", url:"https://cardadvisor.in/cards/sbi-miles-elite", at:"11 Oct 2026"},
    "ca-hdfc":  {name:"CardAdvisor: HDFC Regalia Gold", url:"https://cardadvisor.in/cards/hdfc-regalia-gold", at:"24 Oct 2026"},
    "ca-dcb":   {name:"CardAdvisor: HDFC Diners Club Black Metal", url:"https://cardadvisor.in/cards/hdfc-diners-black", at:"24 Oct 2026"},
    "ca-ai":    {name:"CardAdvisor: Air India Maharaja Club and the cards that transfer to it", url:"https://cardadvisor.in/programs/air-india-maharaja-club", at:"24 Oct 2026"},
    "ai-aurum": {name:"Air India: SBI AURUM points to Maharaja Club (5:1)", url:"https://www.airindia.com/in/en/maharaja-club/partner-offers/sbi-aurum.html", at:"11 Nov 2026"},
    "ca-aurum": {name:"CardAdvisor: SBI Card AURUM", url:"https://cardadvisor.in/cards/sbi-aurum", at:"24 Oct 2026"},
    "byt":      {name:"Budget Your Trip: average hotel prices by country", url:"https://www.budgetyourtrip.com/hotels", at:"10 Nov 2026"},
    "champion": {name:"Champion Traveler: hotel prices in Colombo (middle of each range)", url:"https://championtraveler.com/price/cost-of-a-trip-to-colombo-lk", at:"10 Nov 2026"},
    "yopki":    {name:"Yopki: hotel costs in France and Indonesia (a travel guide; it doesn't say where its figures come from)", url:"https://yopki.com/budget/france/hotels", at:"10 Nov 2026"},
    "gotripzi": {name:"Gotripzi: Singapore costs (Booking.com and Numbeo averages)", url:"https://www.gotripzi.com/destinations/singapore-sg/cost", at:"16 Feb 2026"},
    "fx-usd":   {name:"Rupee at 94.46 to the dollar (HDFC Sky)", url:"https://hdfcsky.com/news/rupee-settles-flat-at-94-46-against-us-dollar", at:"5 Nov 2026"},
    "fx-eur":   {name:"Euro at about ₹105 (Wise)", url:"https://www.wise.com/au/currency-converter/eur-to-inr-rate", at:"10 Nov 2026"}
  }
};

/* ---------------- your plan (saved with your settings as overrides.trip) ---------------- */
const TRIP_LEAD = 2;        // have the points this many months before you fly: award seats go early
const TRIP_MAX_MONTHS = 1200;   // the month-by-month run gives up after a century
const TRIP_FAR = 240;           // past 20 years the screens say so instead of naming a date
const TRIP_NOMINAL = 50000; // a month's spending used to rank the cards when yours isn't known
const TRIP_NOEARN = ["fuel", "utilities", "rent", "insurance", "education", "govt", "wallets"];
const tripCountry = id => TRIP_DATA.countries.find(c => c.id === id) || TRIP_DATA.countries[0];
const tripCardById = id => TRIP_DATA.cards.find(c => c.id === id) || null;
/* Cards left off the Trips screen (you asked for them to go). Their figures stay here because Rewards uses them, and a
   card you hold is still shown. */
const TRIP_LEFT_OUT = ["sbi-miles-elite", "sbi-miles-prime", "sbi-miles"];
function tripPlan(){
  const o = overrides.trip && typeof overrides.trip === "object" ? overrides.trip : {};
  const int = (v, lo, hi, d) => { const n = Math.round(+v); return isFinite(n) && v !== null && v !== "" && v !== undefined ? Math.max(lo, Math.min(hi, n)) : d; };
  const opt = (v, hi) => (v === null || v === undefined || v === "" || !isFinite(+v) ? null : Math.max(0, Math.min(hi, Math.round(+v))));
  // plans saved before the form asked for the class and the hotel separately had one "style": 0 lean … 3 luxury
  const old = o.style !== undefined ? int(o.style, 0, 3, 1) : null;
  const pts = {}, mine = [];
  if(o.pts && typeof o.pts === "object") Object.keys(o.pts).forEach(id => { const n = opt(o.pts[id], 1e8); if(tripCardById(id) && n) pts[id] = n; });
  (Array.isArray(o.mine) ? o.mine : []).forEach(id => { if(tripCardById(id) && !mine.includes(id)) mine.push(id); });
  if(tripCardById(o.card)){ if(!mine.includes(o.card)) mine.push(o.card); if(opt(o.have, 1e8) && !pts[o.card]) pts[o.card] = opt(o.have, 1e8); }
  return {
    country: TRIP_DATA.countries.some(c => c.id === o.country) ? o.country : "jp",
    people: int(o.people, 1, 6, 2), nights: int(o.nights, 1, 30, 7),
    cabin: o.cabin === "j" || o.cabin === "y" ? o.cabin : old === 3 ? "j" : "y",
    stay: o.stay !== false, hotel: o.hotel !== undefined ? int(o.hotel, 0, 2, 1) : old !== null ? Math.min(2, old) : 1,
    air: o.air === "ai" || o.air === "kf" ? o.air : "",
    when: /^\d{4}-\d{2}$/.test(o.when || "") && o.when > ymOf(new Date()) ? o.when : "",
    income: opt(o.income, 1e9), spend: opt(o.spend, 1e8), travel: opt(o.travel, 1e8), night: opt(o.night, 1e7),
    mine, pts
  };
}
/** The cards that are yours: the ones the app already tracks (a card account whose profile names the catalog card, or
    whose name has the card's own words, `held`) and any you marked yourself.
    addOn: held as an add-on, so the points sit with the main cardholder. */
function tripHeld(plan){
  const mine = {};
  openGroups().forEach(g => { const name = String(GROUPS[g].short || "").toLowerCase();
    TRIP_DATA.cards.forEach(c => { if(GROUPS[g].catalog === c.id || (!GROUPS[g].catalog && c.held && name.includes(c.held))) mine[c.id] = {auto:true, addOn:/add-on/i.test(name)}; }); });
  plan.mine.forEach(id => { if(!mine[id]) mine[id] = {auto:false, addOn:false}; });
  return mine;
}
/** Yearly income for the cards' income bars: what you typed, or your gross pay × 12 (Plan → Salary & fixed payments:
    banks go by gross income), or your monthly take-home × 12 when the gross isn't set. */
function tripIncome(plan){
  if(plan.income !== null) return {amt:plan.income, from:"you"};
  if(OFFER.gross > 0) return {amt:Math.round(OFFER.gross * 12), from:"salary"};
  return settings.inc ? {amt:Math.round(settings.inc * 12), from:"salary"} : {amt:null, from:null};
}

/* ---------------- your spending, sorted by what a card pays points on ---------------- */
const TRIP_RE = {
  air: /\b(indigo|interglobe|air ?india|vistara|akasa|spicejet|emirates|etihad|qatar air|singapore air|lufthansa|british airways|airlines?|airways)\b/i,
  ota: /\b(makemytrip|mmt|goibibo|cleartrip|ixigo|easemytrip|ease my trip|yatra|booking\.com|agoda|airbnb|expedia|trip\.com|oyo|marriott|hilton|hyatt|taj hotels?|novotel|ibis)\b/i,
  stay: /\b(hotels?|resorts?)\b/i,          // "Hotel" is often a restaurant's name here, so this counts only under Travel
  fuel: /\b(petrol|fuel|hpcl|bpcl|iocl|indian ?oil|bharat petroleum|hindustan petroleum|shell|nayara)\b/i,
  rent: /\b(rent|nobroker|rentpay|redgiraffe|society maintenance)\b/i,
  insurance: /\b(insurance|lic|policybazaar|hdfc life|icici pru|max life|star health|acko|niva bupa)\b/i,
  education: /\b(school|college|universit\w*|tuition|institute)\b/i,
  govt: /\b(govt|government|income tax|gst|challan|municipal|passport|stamp duty|traffic police)\b/i,
  wallets: /\b(wallet|paytm add money|amazon pay balance|mobikwik|freecharge)\b/i,
  utilities: /\b(electric\w*|bescom|msedcl|tata power|adani (electricity|gas)|torrent power|bses|mahanagar gas|indraprastha gas|water bill|broadband|fibernet|airtel|jio|vodafone|bsnl|recharge|dth|tata ?play|bill ?pay\w*|bbps)\b/i,
  jewellery: /\b(jewel\w*|tanishq|kalyan|malabar gold|caratlane|bluestone)\b/i
};
/** What kind of spending a payment is, for a card's points: "air", "ota", one of the kinds that often earn nothing,
    "grocery", or "other". */
function tripKind(x){
  const d = String(x.desc || "");
  if(TRIP_RE.air.test(d)) return "air";
  if(TRIP_RE.ota.test(d) || (x.cat === "Travel" && TRIP_RE.stay.test(d))) return "ota";
  for(const k of ["fuel", "rent", "insurance", "education", "govt", "wallets", "utilities", "jewellery"]) if(TRIP_RE[k].test(d)) return k;
  return x.cat === "Groceries" ? "grocery" : "other";
}
/* Payments a card can't take (money sent to people, UPI to someone unnamed) are left out. */
const TRIP_SKIP = new Set(["Transfers to people", "UPI — payee unknown"]);
/** A month of your spending by kind: the average of your last three full months (or this month so far, scaled up,
    when there isn't a full month yet). */
function tripProfile(){
  const now = new Date(), cur = ymOf(now);
  const kinds = list => { const by = {}; list.filter(x => x.dir === "out" && x.counted && !TRIP_SKIP.has(x.cat)).forEach(x => { const k = tripKind(x); by[k] = (by[k] || 0) + x.amt; }); return by; };
  const full = MONTHS.filter(k => k < cur).slice(0, 3).map(k => kinds(txFor(k))).filter(by => Object.keys(by).length);
  let by = {}, n = full.length, basis = "none";
  if(n){
    full.forEach(m => Object.keys(m).forEach(k => by[k] = (by[k] || 0) + m[k] / n));
    basis = "months";
  }else{
    const m = kinds(txFor(cur)), day = now.getDate(), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if(Object.keys(m).length){ const up = day >= 7 ? dim / day : 1; Object.keys(m).forEach(k => by[k] = m[k] * up); basis = "month"; n = 1; }
  }
  Object.keys(by).forEach(k => by[k] = Math.round(by[k]));
  const sum = ks => ks.reduce((s, k) => s + (by[k] || 0), 0);
  const travel = sum(["air", "ota"]), noearn = sum(TRIP_NOEARN);
  const everyday = sum(Object.keys(by)) - travel - noearn;
  return {by, n, basis, everyday, travel, noearn, total:everyday + travel + noearn};
}
/** The month of spending the cards are worked out on: yours, with anything you typed in its place. */
function tripMix(plan, prof){
  const by = Object.assign({}, prof.by);
  if(plan.spend !== null){
    Object.keys(by).forEach(k => { if(k !== "air" && k !== "ota" && !TRIP_NOEARN.includes(k)) delete by[k]; });
    by.other = plan.spend;
  }
  if(plan.travel !== null){
    const a = prof.by.air || 0, o = prof.by.ota || 0, share = a + o > 0 ? a / (a + o) : 0.5;
    by.air = Math.round(plan.travel * share); by.ota = plan.travel - by.air;
  }
  const travel = (by.air || 0) + (by.ota || 0), noearn = TRIP_NOEARN.reduce((s, k) => s + (by[k] || 0), 0);
  const total = Object.keys(by).reduce((s, k) => s + by[k], 0);
  return {by, everyday:total - travel - noearn, travel, noearn, earning:total - noearn, total};
}

/* ---------------- what the trip costs in points ---------------- */
function tripNeed(plan){
  const c = tripCountry(plan.country), fx = TRIP_DATA.fx, ac = TRIP_DATA.accor;
  const priced = cab => ["ai", "kf"].filter(p => c[p] && c[p][cab]);
  const noBusiness = plan.cabin === "j" && !priced("j").length;          // no confirmed business price: count economy
  const cabin = noBusiness ? "y" : plan.cabin;
  const seats = plan.people * 2, rooms = Math.ceil(plan.people / 2);
  // the airlines that price this route in this class, fewest points first: the first is the preferred one
  const airs = priced(cabin).map(p => ({id:p, oneWay:c[p][cabin], total:c[p][cabin] * seats})).sort((a, b) => a.oneWay - b.oneWay);
  const airline = airs.some(a => a.id === plan.air) ? plan.air : airs[0].id;
  const flight = airs.find(a => a.id === airline);
  const usual = Math.round(c.hotel[plan.hotel] * fx.usd / 50) * 50;
  const nightly = plan.night !== null && plan.night > 0 ? plan.night : usual;
  const hotelCost = plan.stay ? nightly * rooms * plan.nights : 0;
  const perPoint = ac.eur * fx.eur / ac.per;                                   // ₹ one Accor point takes off
  const accorPts = Math.ceil(hotelCost / perPoint / ac.per) * ac.per;         // points come off in blocks of 2,000
  return {country:c, cabin, noBusiness, seats, rooms, people:plan.people, nights:plan.nights, airs, preferred:airs[0].id, airline, flight,
          stay:plan.stay, tier:plan.hotel, usual, nightly, typed:nightly !== usual, hotelCost, perPoint, accorPts};
}

/* ---------------- a card, month by month ---------------- */
/** Points and counted spending from one month of `by` (₹ by kind) on a card. */
function tripEarn(card, by){
  let pts = 0, spend = 0;
  Object.keys(by).forEach(k => {
    const amt = by[k]; if(!(amt > 0) || card.no.includes(k)) return;
    let p = amt * (k === "air" ? card.earn.air : k === "ota" ? card.earn.ota : card.earn.base) / 100;
    if(card.cap && card.cap[k]) p = Math.min(p, card.cap[k]);
    pts += p; spend += amt;
  });
  return {pts, spend};
}
const tripFee = card => Math.round((card.fee || 0) * 1.18);
/** Months of this spending until the card holds `need` points. owned: you already have it (no joining fee or
    welcome points to come). Returns months:null when it is never reached. */
function tripRun(card, need, by, have, owned){
  const e = tripEarn(card, by), wel = card.welcome, ms = card.milestones || [];
  let pts = have || 0, m = 0, yr = 0, q = 0, total = 0, fees = owned ? 0 : tripFee(card), bonus = 0, got = !!owned || !wel, hit = {};
  const done = () => pts + 1e-6 >= need;
  if(!owned && wel && wel.spend <= 0){ pts += wel.pts; bonus += wel.pts; got = true; }
  while(!done() && m < TRIP_MAX_MONTHS){
    m++; pts += e.pts; yr += e.spend; q += e.spend; total += e.spend;
    if(!got && m <= Math.max(1, Math.round(wel.days / 30)) && total >= wel.spend){ pts += wel.pts; bonus += wel.pts; got = true; }
    ms.forEach((x, i) => { if(x.per === "year" && !hit[i] && yr >= x.at){ hit[i] = 1; pts += x.pts; bonus += x.pts; } });
    if(m % 3 === 0){ ms.forEach(x => { if(x.per === "quarter" && q >= x.at){ pts += x.pts; bonus += x.pts; } }); q = 0; }
    if(done()) break;
    if(m % 12 === 0){
      if(!(card.waive && yr >= card.waive)) fees += tripFee(card);
      if(card.renewal){ pts += card.renewal; bonus += card.renewal; }
      yr = 0; hit = {};
    }
  }
  return {months:done() ? m : null, spend:Math.round(total), fees, bonus, perMonth:e.pts, counted:e.spend};
}
/** `by` scaled so the counted spending on this card is `monthly`. With no spending to scale, it's all everyday. */
function tripScaled(card, by, monthly){
  const e = tripEarn(card, by);
  if(!(e.spend > 0)) return {other:monthly};
  const out = {}, f = monthly / e.spend;
  Object.keys(by).forEach(k => { if(!card.no.includes(k)) out[k] = by[k] * f; });
  return out;
}
/** The counted spending a month that reaches `need` within `months` (to the next ₹500), or null. */
function tripPace(card, need, by, have, owned, months){
  if(!(months >= 1)) return null;
  const ok = v => { const r = tripRun(card, need, tripScaled(card, by, v), have, owned); return r.months !== null && r.months <= months; };
  let lo = 0, hi = 5e6;
  if(ok(0)) return 0;
  if(!ok(hi)) return null;
  for(let i = 0; i < 40; i++){ const mid = (lo + hi) / 2; if(ok(mid)) hi = mid; else lo = mid; }
  return Math.ceil(hi / 500) * 500;
}
const tripAddMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const tripMonthName = d => MON[d.getMonth()] + " " + d.getFullYear();

/** One card against the trip on the chosen airline: its conversion, the points it must hold, how long your spending
    takes, and anything to know. rate: airline points from ₹100 of everyday spending. */
function tripCard(card, need, mix, plan, income, avail, held){
  const air = need.airline, r = card.to[air] || null;
  const fl = r ? {prog:air, miles:need.flight.total, ratio:r, pts:Math.ceil(need.flight.total * r), oneWay:need.flight.oneWay} : null;
  const ht = need.stay && card.to.accor ? {points:need.accorPts, ratio:card.to.accor, pts:Math.ceil(need.accorPts * card.to.accor)} : null;
  const total = (fl ? fl.pts : 0) + (ht ? ht.pts : 0);
  const mine = held[card.id] || null, owned = !!mine, have = plan.pts[card.id] || 0;
  const known = mix.earning > 0, by = known ? mix.by : {other:TRIP_NOMINAL};
  const run = fl ? tripRun(card, total, by, have, owned) : null;
  const pace = fl && avail !== null ? tripPace(card, total, by, have, owned, avail) : null;
  const canGet = card.status === "open" && !(income.amt !== null && card.income && income.amt < card.income);
  const warn = [];
  if(!fl) warn.push("Its points don't move to " + TRIP_DATA.air[air].short + ".");
  if(need.stay && !ht) warn.push("No hotel partner: the " + money(need.hotelCost) + " hotel would be paid in cash.");
  if(card.capA && total > card.capA) warn.push("Axis moves at most " + card.capA.toLocaleString("en-IN") + " " + card.pts + " a year to these partners, so the transfers take " + Math.ceil(total / card.capA) + " calendar years.");
  if(card.expire && run && run.months !== null && run.months > card.expire) warn.push(card.pts + " expire after " + card.expire + " months, so the earliest would lapse before you get there.");
  const far = !!run && (run.months === null || run.months > TRIP_FAR);
  if(far) warn.push("More than 20 years away at this spending.");
  if(mine && mine.addOn) warn.push("Yours is an add-on card: the points sit with the main cardholder, who makes the transfer.");
  return {card, rate:r ? card.earn.base / r : 0, owned, auto:!!(mine && mine.auto), addOn:!!(mine && mine.addOn), have, fl, ht, total, left:Math.max(0, total - have),
          run, pace, far, canGet, ready:run && run.months !== null && !far ? tripAddMonths(new Date(), run.months) : null, warn};
}

/** Everything the Trips screen shows. best: every card that moves to the chosen airline, best conversion first,
    whatever your income. get: the ones you could apply for on your income. */
function tripModel(){
  const plan = tripPlan(), income = tripIncome(plan), need = tripNeed(plan), prof = tripProfile(), mix = tripMix(plan, prof), held = tripHeld(plan);
  const now = new Date();
  let avail = null;
  if(plan.when){ const [y, m] = plan.when.split("-").map(Number); avail = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()) - TRIP_LEAD; }
  const all = TRIP_DATA.cards.filter(c => !TRIP_LEFT_OUT.includes(c.id) || held[c.id]).map(c => tripCard(c, need, mix, plan, income, avail, held));
  const best = all.filter(r => r.fl).sort((a, b) => b.rate - a.rate || a.card.fee - b.card.fee || (a.card.name < b.card.name ? -1 : 1));
  return {plan, income, need, prof, mix, known:mix.earning > 0, avail, lead:TRIP_LEAD, all, best, get:best.filter(r => r.canGet),
          yours:all.filter(r => r.owned), off:all.filter(r => !r.fl),
          whenDate:plan.when ? new Date(+plan.when.slice(0, 4), +plan.when.slice(5, 7) - 1, 1) : null, data:TRIP_DATA};
}

/* ---------------- actions ---------------- */
/** Change one thing about the trip (light: while a slider is still moving). */
act.setTrip = function(k, v, light){
  const o = Object.assign({}, overrides.trip && typeof overrides.trip === "object" ? overrides.trip : {});
  if(o.style !== undefined || o.card !== undefined){                      // an older plan: keep what it meant, in today's fields
    const p = tripPlan(); o.cabin = p.cabin; o.hotel = p.hotel; if(p.mine.length) o.mine = p.mine; if(Object.keys(p.pts).length) o.pts = p.pts;
    delete o.style; delete o.card; delete o.have;
  }
  if(v === null || v === undefined || v === "") delete o[k]; else o[k] = v;
  if(k === "country" || k === "hotel" || k === "people" || k === "nights") delete o.night;      // a typed room price belongs to the trip it was typed for
  if(k === "country" || k === "cabin") delete o.air;                                             // and a chosen airline to its route and class
  overrides.trip = o;
  if(light) lightRender(); else render();
  queueSave();
};
/** Mark a card as yours (or not), and the points on it now. */
act.setTripCard = function(id, mine, pts){
  const p = tripPlan(), m = p.mine.filter(x => x !== id), q = Object.assign({}, p.pts);
  if(mine) m.push(id);
  if(pts > 0) q[id] = Math.round(pts); else delete q[id];
  act.setTrip("mine", m.length ? m : null, true); act.setTrip("pts", Object.keys(q).length ? q : null);
};
act.resetTrip = function(){ delete overrides.trip; render(); queueSave(); };
