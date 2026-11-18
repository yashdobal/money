/* =============================================================================================
   Money · Rewards: which card to pay with.

   "I want to spend on X": what X is (the kind of spending, the shop, the amount, online or in a shop, in a foreign
   currency), then every card you hold and every card you could get on your income, each paid every way it can be
   (straight on the card, through a bank's portal like HDFC SmartBuy, a SmartBuy brand voucher, Amazon Pay), counting
   the bonus rates, the spending that earns nothing and the caps (with what you've already used this month).

   Points are worth two things, and both are shown:
     cash   what the bank pays for them without moving them anywhere (the card's best ordinary redemption: SmartBuy
            flights and hotels, a rewards portal, statement credit; ₹1 for every ₹1 of cashback)
     miles  what they're worth moved to an airline or hotel programme: points ÷ the card's transfer ratio × what one
            partner point is worth (Air India and KrisFlyer: ₹1 each unless you change it; Accor: €40 per 2,000)
   Cards are ranked by the better of the two.

   It is loaded after engine.js and trips.js and uses their names (TRIP_DATA, tripPlan, txFor, MONTHS, overrides …).
   Nothing here is used by the server. REWARD_DATA is public information only, each number from a published page
   checked on REWARD_DATA.checked (`src` names it). Banks change these often: the screens show the date.

   Rates are per ₹100: points for a points card, rupees for a cashback card (so 5 on a cashback card is 5%).
   A card:
     base       the everyday rate
     no         kinds of spending that earn nothing (see REW_KINDS)
     intl       the rate on foreign-currency spending (0: nothing; absent: the everyday rate); fx: the bank's markup in %
     kindCap    kinds paid at the everyday rate up to a monthly limit in points ({grocery:2000})
     bonus      [{label, merchants|kinds, rate, online, except, cap}] higher rates straight on the card
     routes     [{id, label, how, kinds:{kind:rate}, merchants:{id:rate}, voucher:rate, partners:rate, cap, vcap, day}]
                other ways to pay (a portal, a voucher bought on it, a wallet)
     cap        {id, max, per:"month"|"quarter"|"cycle", on:"extra"|"total"}: "extra" limits the points above the
                everyday rate, "total" all of them. Caps with the same id are shared.
     cash       {per: ₹ a point, how}; to: {ai, kf, accor} points for ONE partner point (from TRIP_DATA when `trip`)
     trip       the card's id in TRIP_DATA.cards, for its name, fee, income, status and transfer ratios
     milestones [{spend, per:"quarter"|"year", worth, what}]
   ============================================================================================= */
const REWARD_DATA = {
  checked: "2026-11-14",
  /* ₹ one partner point is worth (you can change Air India and KrisFlyer in the tab) */
  value: {ai:1, kf:1, src:["ca-ai-value"]},
  cards: [
    /* ---------------- HDFC ---------------- */
    {id:"hdfc-regalia-gold", trip:"hdfc-regalia-gold", unit:"points", base:2.5, fx:2,
     no:["fuel", "rent", "govt", "wallets"], maybe:{education:"Education paid through an app earns nothing."},
     kindCap:{grocery:2000, utilities:2000, insurance:2000, telecom:2000},
     bonus:[{label:"5× at Myntra, Nykaa, Reliance Digital and M&S", merchants:["myntra", "nykaa", "reliancedigital", "ms"], rate:12.5, cap:{id:"rg-brands", max:5000, per:"month", on:"extra"}}],
     routes:[{id:"smartbuy", label:"HDFC SmartBuy", how:"Book or buy on HDFC SmartBuy",
              kinds:{hotels:25, flights:12.5, buses:12.5, trains:7.5}, merchants:{apple:12.5, myntra:12.5, jockey:25, igp:25, fnp:25, pharmeasy:25},
              voucher:12.5, cap:{id:"sb", max:4000, per:"month", on:"extra"}, vcap:{id:"sb-v", max:3000, per:"month", on:"extra"}, day:2000}],
     cash:{per:0.5, how:"on SmartBuy flights and hotels"},
     milestones:[{spend:150000, per:"quarter", worth:1500, what:"a ₹1,500 voucher"}, {spend:750000, per:"year", worth:5000, what:"a ₹5,000 flight voucher"}],
     src:["ca-rg", "ca-sb"]},
    {id:"hdfc-millennia", name:"HDFC Millennia", bank:"HDFC", unit:"cashback", base:1, fx:3.5, fee:1000, waive:100000, income:420000, status:"open", held:"millennia",
     no:["fuel", "rent", "govt", "wallets"], maybe:{education:"Education paid through an app earns nothing."},
     cap:{id:"mil-base", max:1000, per:"month", on:"total"},
     bonus:[{label:"5% at Amazon, Flipkart, Myntra, Swiggy, Zomato, Uber and four more", merchants:["amazon", "bookmyshow", "cult", "flipkart", "myntra", "sonyliv", "swiggy", "tatacliq", "uber", "zomato"], rate:5, cap:{id:"mil-5", max:1000, per:"month", on:"total"}}],
     routes:[{id:"smartbuy", label:"HDFC SmartBuy", how:"Book on HDFC SmartBuy", kinds:{hotels:5, flights:5}, cap:{id:"sb", max:1000, per:"month", on:"extra"}}],
     cash:{per:1, how:"as statement credit"}, src:["ca-mil", "ca-sb"]},
    {id:"hdfc-tata-neu-infinity", name:"Tata Neu Infinity HDFC", bank:"HDFC", unit:"NeuCoins", base:1.5, fx:2, fee:1499, waive:300000, income:1200000, status:"open", held:"neu infinity",
     no:["fuel", "rent", "govt", "wallets"], maybe:{education:"Education paid through an app earns nothing."},
     kindCap:{grocery:2000, utilities:2000, insurance:2000, telecom:2000},
     bonus:[{label:"5% at BigBasket, Croma, Tata CLiQ, Tata 1mg, Air India and the Tata Neu app", merchants:["bigbasket", "croma", "tatacliq", "1mg", "airindia", "tataneu"], rate:5, online:true}],
     cash:{per:1, how:"as NeuCoins (₹1 each, at Tata brands)"}, note:"NeuCoins are spent at Tata brands (Tata Neu, BigBasket, Croma, Air India, Taj …), not as cash.", src:["ca-neu"]},
    {id:"hdfc-swiggy-ornge", name:"Swiggy Ornge HDFC", bank:"HDFC", unit:"cashback", base:1, fx:3.5, fee:500, waive:150000, income:240000, status:"open", held:"swiggy",
     no:["fuel", "rent", "govt", "wallets", "education", "jewellery"], min:100,
     cap:{id:"sw-1", max:1000, per:"cycle", on:"total"},
     bonus:[{label:"5% on Swiggy, Instamart and Dineout, and at Amazon, Flipkart, Nykaa, Ajio, Cleartrip, Netflix, Uber and Croma", merchants:["swiggy", "instamart", "amazon", "flipkart", "nykaa", "ajio", "cleartrip", "netflix", "uber", "croma"], rate:5, min:249, cap:{id:"sw-5", max:1500, per:"cycle", on:"total"}}],
     cash:{per:1, how:"as statement credit"}, src:["ca-ornge"]},
    {id:"hdfc-dcb-metal", trip:"hdfc-dcb-metal", unit:"points", base:10 / 3, fx:2,
     no:["fuel", "rent", "govt", "wallets"], kindCap:{grocery:2000, utilities:2000, telecom:2000, insurance:5000},
     routes:[{id:"smartbuy", label:"HDFC SmartBuy", how:"Book or buy on HDFC SmartBuy",
              kinds:{hotels:100 / 3, flights:50 / 3, buses:50 / 3, trains:10}, merchants:{myntra:50 / 3, apple:10, jockey:100 / 3, igp:100 / 3, fnp:100 / 3, pharmeasy:100 / 3},
              voucher:10, cap:{id:"sb", max:10000, per:"month", on:"extra"}, vcap:{id:"sb-v", max:3000, per:"month", on:"extra"}, day:10000}],
     cash:{per:1, how:"on SmartBuy flights and hotels"}, note:"Twice the points at restaurants on Saturdays and Sundays.", src:["ca-dcb", "ca-sb"]},
    {id:"hdfc-infinia", trip:"hdfc-infinia", unit:"points", base:10 / 3, fx:2,
     no:["fuel", "rent", "govt", "wallets"], kindCap:{grocery:2000, utilities:2000, telecom:2000},
     routes:[{id:"smartbuy", label:"HDFC SmartBuy", how:"Book or buy on HDFC SmartBuy",
              kinds:{hotels:100 / 3, flights:50 / 3, buses:50 / 3, trains:10}, merchants:{myntra:50 / 3, apple:50 / 3, jockey:100 / 3, igp:100 / 3, fnp:100 / 3, pharmeasy:100 / 3},
              voucher:50 / 3, cap:{id:"sb", max:15000, per:"month", on:"extra"}, vcap:{id:"sb-v", max:3000, per:"month", on:"extra"}, day:15000}],
     cash:{per:1, how:"on SmartBuy flights and hotels"}, src:["ca-sb"]},
    /* ---------------- SBI ---------------- */
    {id:"sbi-aurum", trip:"sbi-aurum", unit:"points", base:4, fx:1.99, no:["fuel", "rent", "govt", "wallets"],
     cash:{per:0.25, how:"on the AURUM rewards portal or as statement credit"},
     milestones:[{spend:500000, per:"year", worth:5000, what:"a ₹5,000 Tata CLiQ Luxury voucher"}], src:["ca-aurum2"]},
    {id:"sbi-cashback", name:"SBI Cashback", bank:"SBI", unit:"cashback", base:1, fx:3.5, fee:999, waive:200000, income:null, status:"open", held:"cashback",
     no:["fuel", "rent", "govt", "wallets", "utilities", "insurance", "education", "jewellery", "trains"],
     cap:{id:"sc-off", max:2000, per:"cycle", on:"total"},
     bonus:[{label:"5% on almost anything bought online", online:true, rate:5, cap:{id:"sc-on", max:2000, per:"cycle", on:"total"}, own:true}],
     cash:{per:1, how:"as statement credit"}, src:["ca-sbic"]},
    {id:"sbi-miles-elite", trip:"sbi-miles-elite", unit:"points", base:1, no:["fuel", "rent", "govt", "wallets", "utilities", "insurance", "education"],
     bonus:[{label:"3 per ₹100 on travel", kinds:["flights", "hotels", "travel", "trains", "buses"], rate:3}], cap:{id:"sme", max:15000, per:"month", on:"total"},
     cash:{per:0.5, how:"on flights and hotels booked through SBI Card"}, src:["ca-sme"]},
    {id:"sbi-miles-prime", trip:"sbi-miles-prime", unit:"points", base:1, no:["fuel", "rent", "govt", "wallets", "utilities", "insurance", "education"],
     bonus:[{label:"2 per ₹100 on travel", kinds:["flights", "hotels", "travel", "trains", "buses"], rate:2}],
     cash:{per:0.5, how:"on flights and hotels booked through SBI Card"}, src:["ca-sme", "ca-sbi"]},
    {id:"sbi-miles", trip:"sbi-miles", unit:"points", base:0.5, no:["fuel", "rent", "govt", "wallets", "utilities", "insurance", "education"],
     bonus:[{label:"1 per ₹100 on travel", kinds:["flights", "hotels", "travel", "trains", "buses"], rate:1}],
     cash:{per:0.5, how:"on flights and hotels booked through SBI Card"}, src:["ca-sme", "ca-sbi"]},
    /* ---------------- ICICI ---------------- */
    {id:"icici-amazon-pay", name:"Amazon Pay ICICI", bank:"ICICI", unit:"cashback", base:1, fee:0, waive:null, income:null, status:"open", held:"amazon pay",
     no:["fuel", "rent", "govt", "jewellery", "education", "wallets"], intl:0, maybe:{utilities:"A bill paid straight to the company earns nothing; paid through Amazon Pay it earns 2%."},
     noDirect:["utilities"],
     bonus:[{label:"5% on Amazon with Prime (3% without)", merchants:["amazon"], rate:5, prime:3}],
     routes:[{id:"amazonpay", label:"Amazon Pay", how:"Pay through Amazon Pay with this card", partners:2, kinds:{utilities:2, telecom:2},
              note:"Amazon Pay partners and bills paid through Amazon Pay usually earn 2%."}],
     cash:{per:1, how:"as Amazon Pay balance"}, note:"Cashback arrives as Amazon Pay balance, spent on Amazon and Amazon Pay.", src:["ca-apay"]},
    /* ---------------- HSBC ---------------- */
    {id:"hsbc-travelone", trip:"hsbc-travelone", unit:"points", base:2,
     no:["fuel", "utilities", "rent", "insurance", "education", "govt", "wallets", "jewellery"], intl:4,
     bonus:[{label:"4 per ₹100 on flights and travel sites", kinds:["flights", "travel"], rate:4, cap:{id:"t1-travel", max:50000, per:"month", on:"total"}},
            {label:"4 per ₹100 on hotels booked on a travel site", kinds:["hotels"], viaOta:true, rate:4, cap:{id:"t1-travel", max:50000, per:"month", on:"total"}}],
     routes:[{id:"hsbcapp", label:"HSBC Travel with Points", how:"Book in the HSBC Travel with Points app", kinds:{hotels:24, flights:16}, cap:{id:"t1-app", max:18000, per:"month", on:"extra"},
              note:"HSBC charges ₹300 a person for each domestic flight leg booked there (₹700 international)."}],
     cash:{per:0.25, how:"as gift cards (no statement credit)"}, src:["ca-t1"]},
    {id:"hsbc-live-plus", name:"HSBC Live+", bank:"HSBC", unit:"cashback", base:1.5, fee:999, waive:200000, income:600000, status:"open", held:"live+",
     no:["fuel", "rent", "insurance", "education", "govt", "wallets", "jewellery"], intl:0,
     bonus:[{label:"10% on restaurants, food delivery, groceries, shopping and bills", kinds:["dining", "food", "grocery", "shopping", "fashion", "utilities"], except:["amazon", "flipkart", "myntra"], rate:10, cap:{id:"lp-10", max:1200, per:"month", on:"total"}}],
     cash:{per:1, how:"as statement credit"}, note:"Amazon, Flipkart and Myntra earn the everyday 1.5%.", src:["ca-lp"]},
    /* ---------------- Axis ---------------- */
    {id:"axis-flipkart", name:"Flipkart Axis", bank:"Axis", unit:"cashback", base:1, fee:500, waive:350000, income:null, status:"open", held:"flipkart",
     no:["utilities", "education", "rent", "wallets", "govt", "insurance", "fuel", "jewellery"], min:100,
     bonus:[{label:"7.5% on Myntra", merchants:["myntra"], rate:7.5, cap:{id:"fa-myntra", max:4000, per:"quarter", on:"total"}},
            {label:"5% on Flipkart", merchants:["flipkart"], rate:5, cap:{id:"fa-flipkart", max:4000, per:"quarter", on:"total"}},
            {label:"5% on Cleartrip", merchants:["cleartrip"], rate:5, cap:{id:"fa-cleartrip", max:4000, per:"quarter", on:"total"}},
            {label:"4% on Swiggy food delivery", merchants:["swiggy"], rate:4}],
     cash:{per:1, how:"as statement credit"}, note:"Gift cards bought on Flipkart and Myntra earn nothing.", src:["ca-fa"]},
    {id:"axis-horizon", trip:"axis-horizon", unit:"points", base:2,
     no:["rent", "fuel", "utilities", "insurance", "education", "govt", "wallets", "cabs", "buses", "trains"],
     bonus:[{label:"5 per ₹100 on flights booked with the airline", kinds:["flights"], rate:5, direct:["flights"]}],
     routes:[{id:"traveledge", label:"Axis Travel EDGE", how:"Book flights on Axis Travel EDGE", kinds:{flights:5}}],
     cash:{per:1, how:"on Travel EDGE or Pay with Rewards"}, src:["ca-horizon2"]},
    {id:"axis-magnus", trip:"axis-magnus", unit:"points", base:6,
     no:["utilities", "wallets", "govt", "insurance", "fuel", "jewellery"],
     routes:[{id:"traveledge", label:"Axis Travel EDGE", how:"Book on Axis Travel EDGE", kinds:{flights:30, hotels:30}, cap:{id:"mg-edge", max:48000, per:"month", on:"extra"}}],
     cash:{per:0.2, how:"as cashback or vouchers"}, note:"More than ₹1.5 lakh of spending in a month earns 35 per ₹200 above that.", src:["ca-magnus2"]}
  ],
  sources: {
    "ca-ai-value": {name:"CardAdvisor: Air India Maharaja Club (a point is worth about ₹1 on everyday economy awards)", url:"https://cardadvisor.in/programs/air-india-maharaja-club", at:"24 Oct 2026"},
    "ca-rg":      {name:"CardAdvisor: HDFC Regalia Gold", url:"https://cardadvisor.in/cards/hdfc-regalia-gold", at:"13 Nov 2026"},
    "ca-sb":      {name:"CardAdvisor: HDFC SmartBuy guide (rates and monthly caps by card)", url:"https://cardadvisor.in/articles/hdfc-smartbuy-guide", at:"13 Nov 2026"},
    "ca-sb-v":    {name:"CardAdvisor: SmartBuy voucher cap from 1 July 2026", url:"https://cardadvisor.in/articles/hdfc-smartbuy-voucher-devaluation-july-2026", at:"Jul 2026"},
    "ca-mil":     {name:"CardAdvisor: HDFC Millennia", url:"https://cardadvisor.in/cards/hdfc-millennia", at:"13 Nov 2026"},
    "ca-neu":     {name:"CardAdvisor: Tata Neu Infinity HDFC", url:"https://cardadvisor.in/cards/hdfc-tata-neu-infinity", at:"13 Nov 2026"},
    "ca-ornge":   {name:"CardAdvisor: Swiggy Ornge HDFC", url:"https://cardadvisor.in/cards/hdfc-swiggy-orange", at:"13 Nov 2026"},
    "ca-dcb":     {name:"CardAdvisor: HDFC Diners Club Black Metal", url:"https://cardadvisor.in/cards/hdfc-diners-black", at:"24 Oct 2026"},
    "ca-aurum2":  {name:"CardAdvisor: SBI Card AURUM", url:"https://cardadvisor.in/cards/sbi-aurum", at:"13 Nov 2026"},
    "ca-sbic":    {name:"CardAdvisor: SBI Cashback", url:"https://cardadvisor.in/cards/sbi-cashback", at:"13 Nov 2026"},
    "ca-sme":     {name:"CardAdvisor: SBI Card Miles Elite", url:"https://cardadvisor.in/cards/sbi-miles-elite", at:"13 Nov 2026"},
    "ca-sbi":     {name:"CardAdvisor: SBI Card Miles, Miles Prime and Miles Elite", url:"https://cardadvisor.in/cards/sbi-miles-elite", at:"11 Oct 2026"},
    "ca-apay":    {name:"CardAdvisor: Amazon Pay ICICI review", url:"https://cardadvisor.in/articles/amazon-pay-icici-bank-credit-card-review-2026", at:"14 Aug 2026"},
    "ca-t1":      {name:"CardAdvisor: HSBC TravelOne", url:"https://cardadvisor.in/cards/hsbc-travelone", at:"13 Nov 2026"},
    "ca-lp":      {name:"CardAdvisor: HSBC Live+", url:"https://cardadvisor.in/cards/hsbc-live-plus", at:"13 Nov 2026"},
    "ca-fa":      {name:"CardAdvisor: Flipkart Axis", url:"https://cardadvisor.in/cards/axis-flipkart", at:"11 Oct 2026"},
    "ca-horizon2": {name:"CardAdvisor: Axis Horizon", url:"https://cardadvisor.in/cards/axis-horizon", at:"13 Nov 2026"},
    "ca-magnus2": {name:"CardAdvisor: Axis Magnus", url:"https://cardadvisor.in/cards/axis-magnus", at:"11 Oct 2026"}
  }
};

/* ---------------- what you can spend on ---------------- */
/* Kinds of spending. re: words that name it. */
const REW_KINDS = [
  {id:"flights",   name:"Flights",              re:/\b(flights?|air ?tickets?|plane tickets?|airfare|fly(ing)? to)\b/i},
  {id:"hotels",    name:"Hotels",               re:/\b(hotels?|resorts?|stay|homestay|hostel|villa booking)\b/i},
  {id:"trains",    name:"Trains",               re:/\b(trains?|railways?|rail tickets?|irctc|vande bharat|rajdhani)\b/i},
  {id:"buses",     name:"Buses",                re:/\b(bus(es)?|redbus|volvo bus)\b/i},
  {id:"cabs",      name:"Cabs",                 re:/\b(cabs?|taxi|auto ?rickshaw|ride|rapido)\b/i},
  {id:"travel",    name:"Travel bookings",      re:/\b(trip|holiday|vacation|tour|travel|package)\b/i},
  {id:"food",      name:"Food delivery",        re:/\b(food (order|delivery)|order(ing)? (food|dinner|lunch)|delivery|food)\b/i},
  {id:"dining",    name:"Restaurants",          re:/\b(restaurants?|dinner|lunch|breakfast|cafe|coffee|bar|pub|dine|dining|eat(ing)? out)\b/i},
  {id:"grocery",   name:"Groceries",            re:/\b(grocer(y|ies)|vegetables?|fruits?|milk|kirana|supermarket)\b/i},
  {id:"electronics", name:"Electronics",        re:/\b(i?phones?|mobile|laptop|macbook|ipad|tablet|tv|television|headphones?|earbuds|airpods|camera|watch|gadget|electronics?|fridge|refrigerator|washing machine|ac|air conditioner|appliance)\b/i},
  {id:"fashion",   name:"Clothes and beauty",   re:/\b(clothes|clothing|shirts?|jeans|dress|shoes|sneakers|kurta|saree|fashion|makeup|skincare|beauty|cosmetics)\b/i},
  {id:"shopping",  name:"Shopping",             re:/\b(shopping|buy|purchase|furniture|gift|home decor|books?|toys?)\b/i},
  {id:"movies",    name:"Movies and events",    re:/\b(movies?|cinema|concert|show tickets?|event tickets?|match tickets?)\b/i},
  {id:"ott",       name:"Streaming",            re:/\b(netflix|prime video|hotstar|jiohotstar|spotify|youtube premium|streaming|subscription)\b/i},
  {id:"health",    name:"Pharmacy and health",  re:/\b(medicines?|pharmacy|chemist|doctor|hospital|lab test|health)\b/i},
  {id:"fitness",   name:"Fitness",              re:/\b(gym|fitness|yoga|cult)\b/i},
  {id:"fuel",      name:"Fuel",                 re:/\b(petrol|diesel|fuel|cng)\b/i},
  {id:"rent",      name:"Rent",                 re:/\b(rent|deposit|maintenance)\b/i},
  {id:"utilities", name:"Bills",                re:/\b(electricity|power bill|gas bill|water bill|utility|utilities|bescom|bses|msedcl|tata power)\b/i},
  {id:"telecom",   name:"Phone and internet",   re:/\b(recharge|postpaid|prepaid|broadband|wifi|internet bill|phone bill|mobile bill|dth)\b/i},
  {id:"insurance", name:"Insurance",            re:/\b(insurance|premium|policy)\b/i},
  {id:"education", name:"Education",            re:/\b(school|college|tuition|course|fees|exam|university)\b/i},
  {id:"govt",      name:"Tax and government",   re:/\b(tax|gst|challan|passport|government|municipal|stamp duty)\b/i},
  {id:"wallets",   name:"Wallet top-up",        re:/\b(wallet|top ?up|add money|paytm balance)\b/i},
  {id:"jewellery", name:"Gold and jewellery",   re:/\b(gold|silver|jewel\w*|necklace)\b/i},
  {id:"other",     name:"Anything else",        re:null}
];
const rewKind = id => REW_KINDS.find(k => k.id === id) || REW_KINDS[REW_KINDS.length - 1];
/* Shops. kind: what it usually is; sells: what else you can buy there (so "a new phone" also looks at Amazon);
   voucher: SmartBuy sells its gift voucher; ap: an Amazon Pay partner; online: false for a shop you walk into. */
const REW_SHOPS = [
  {id:"amazon",   name:"Amazon",          re:/\bamazon(?! ?pay ?icici)(\.in)?\b/i, kind:"shopping", sells:["shopping", "electronics", "fashion", "grocery", "health"], voucher:true},
  {id:"flipkart", name:"Flipkart",        re:/\bflipkart\b/i, kind:"shopping", sells:["shopping", "electronics", "fashion", "grocery"], voucher:true},
  {id:"myntra",   name:"Myntra",          re:/\bmyntra\b/i, kind:"fashion", sells:["fashion"], voucher:true},
  {id:"nykaa",    name:"Nykaa",           re:/\bnykaa\b/i, kind:"fashion", sells:["fashion"], voucher:true},
  {id:"ajio",     name:"Ajio",            re:/\bajio\b/i, kind:"fashion", sells:["fashion"], voucher:true},
  {id:"tatacliq", name:"Tata CLiQ",       re:/\btata ?cliq\b/i, kind:"shopping", sells:["electronics", "fashion"]},
  {id:"croma",    name:"Croma",           re:/\bcroma\b/i, kind:"electronics", sells:["electronics"], voucher:true},
  {id:"reliancedigital", name:"Reliance Digital", re:/\breliance ?digital\b/i, kind:"electronics", sells:["electronics"], voucher:true},
  {id:"apple",    name:"Apple",           re:/\bapple( store)?\b/i, kind:"electronics"},
  {id:"ms",       name:"Marks & Spencer", re:/\b(marks ?(&|and) ?spencer|m ?& ?s)\b/i, kind:"fashion"},
  {id:"swiggy",   name:"Swiggy",          re:/\bswiggy(?! ?instamart)\b/i, kind:"food", voucher:true, ap:true},
  {id:"instamart", name:"Swiggy Instamart", re:/\binstamart\b/i, kind:"grocery"},
  {id:"zomato",   name:"Zomato",          re:/\bzomato\b/i, kind:"food", voucher:true},
  {id:"blinkit",  name:"Blinkit",         re:/\bblinkit\b/i, kind:"grocery"},
  {id:"zepto",    name:"Zepto",           re:/\bzepto\b/i, kind:"grocery"},
  {id:"bigbasket", name:"BigBasket",      re:/\bbig ?basket\b/i, kind:"grocery", sells:["grocery"], voucher:true, ap:true},
  {id:"uber",     name:"Uber",            re:/\buber\b/i, kind:"cabs", voucher:true},
  {id:"ola",      name:"Ola",             re:/\bola\b/i, kind:"cabs"},
  {id:"bookmyshow", name:"BookMyShow",    re:/\bbook ?my ?show|\bbms\b/i, kind:"movies", voucher:true, ap:true},
  {id:"pvr",      name:"PVR INOX",        re:/\bpvr|inox\b/i, kind:"movies", voucher:true},
  {id:"netflix",  name:"Netflix",         re:/\bnetflix\b/i, kind:"ott"},
  {id:"sonyliv",  name:"SonyLIV",         re:/\bsony ?liv\b/i, kind:"ott"},
  {id:"cult",     name:"Cult.fit",        re:/\bcult(\.?fit)?\b/i, kind:"fitness"},
  {id:"1mg",      name:"Tata 1mg",        re:/\b(tata ?)?1 ?mg\b/i, kind:"health", sells:["health"]},
  {id:"pharmeasy", name:"PharmEasy",      re:/\bpharm ?easy\b/i, kind:"health", sells:["health"]},
  {id:"tataneu",  name:"Tata Neu",        re:/\btata ?neu\b/i, kind:"shopping"},
  {id:"cleartrip", name:"Cleartrip",      re:/\bcleartrip\b/i, kind:"travel", sells:["flights", "hotels"]},
  {id:"makemytrip", name:"MakeMyTrip",    re:/\b(make ?my ?trip|mmt)\b/i, kind:"travel", sells:["flights", "hotels"], voucher:true},
  {id:"goibibo",  name:"Goibibo",         re:/\bgoibibo\b/i, kind:"travel", sells:["flights", "hotels"]},
  {id:"irctc",    name:"IRCTC",           re:/\birctc\b/i, kind:"trains"},
  {id:"indigo",   name:"IndiGo",          re:/\bindigo\b/i, kind:"flights", airline:true},
  {id:"airindia", name:"Air India",       re:/\bair ?india\b/i, kind:"flights", airline:true},
  {id:"tanishq",  name:"Tanishq",         re:/\btanishq\b/i, kind:"jewellery", voucher:true},
  {id:"decathlon", name:"Decathlon",      re:/\bdecathlon\b/i, kind:"shopping", voucher:true},
  {id:"ikea",     name:"IKEA",            re:/\bikea\b/i, kind:"shopping", voucher:true},
  {id:"starbucks", name:"Starbucks",      re:/\bstarbucks\b/i, kind:"dining", voucher:true, online:false},
  {id:"jockey",   name:"Jockey",          re:/\bjockey\b/i, kind:"fashion"},
  {id:"igp",      name:"IGP",             re:/\bigp\b/i, kind:"shopping"},
  {id:"fnp",      name:"Ferns N Petals",  re:/\b(ferns ?n ?petals|fnp)\b/i, kind:"shopping"},
  {id:"smartbuy", name:"HDFC SmartBuy",   re:/\bsmart ?buy\b/i, kind:"travel"}
];
const rewShop = id => REW_SHOPS.find(s => s.id === id) || null;
/* kinds bought online unless you say otherwise */
const REW_ONLINE = ["shopping", "electronics", "fashion", "food", "flights", "hotels", "travel", "trains", "buses", "ott", "movies", "cabs", "telecom", "utilities", "insurance", "wallets"];
const REW_DEFAULT_AMT = 1000;

/** What you typed, as a spend: {text, amt (null: not said), kind, shop (an id or null), online, intl}. */
function rewParse(text){
  const t = String(text || "").trim(), low = t.toLowerCase();
  // the amount: "₹40k", "40,000", "1.5 lakh", "rs 999"; a lone small number ("iPhone 16") isn't an amount
  let amt = null;
  const re = /(₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand|lakhs?|lacs?|l\b|cr\b|crores?)?/gi;
  let m;
  while((m = re.exec(t))){
    const n = parseFloat(m[2].replace(/,/g, "")); if(!isFinite(n)) continue;
    const unit = (m[3] || "").toLowerCase(), mult = /^k|thousand/.test(unit) ? 1e3 : /^l/.test(unit) ? 1e5 : /^c/.test(unit) ? 1e7 : 1;
    const v = n * mult;
    if(m[1] || unit || v >= 100){ amt = Math.round(v); break; }
  }
  const shop = REW_SHOPS.find(s => s.re.test(t)) || null;
  let kind = null;
  for(const k of REW_KINDS) if(k.re && k.re.test(t)){ kind = k.id; break; }
  // a shop that sells what you named keeps your kind ("a phone on Amazon" is electronics); otherwise the shop's own
  if(shop && !(kind && (shop.sells || []).includes(kind)) && !(kind === "flights" && shop.kind === "travel") && !(kind === "hotels" && shop.kind === "travel")) kind = shop.kind;
  if(!kind) kind = "other";
  // a foreign currency, or shopping and eating in a place abroad (flights and hotels abroad are usually paid in rupees)
  const places = TRIP_DATA.countries.flatMap(c => [c.name, c.city.split(",")[0], c.city.split(" or ")[0]]).concat(["abroad", "overseas"]);
  const placeRe = new RegExp("\\b(in|at) (" + places.map(p => p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "i");
  const intl = /\b(usd|dollars?|euros?|pounds?|yen|dirhams?|forex|foreign currency|international (spend|purchase|transaction))\b|[$€£¥]/i.test(t) ||
    (!["flights", "hotels", "travel"].includes(kind) && placeRe.test(low));
  let online = null;
  if(/\b(online|website|app|order(ed|ing)?)\b/i.test(t)) online = true;
  if(/\b(in[- ]store|offline|in person|at the (shop|store|mall)|showroom|outlet|walk[- ]in)\b/i.test(t)) online = false;
  if(online === null) online = shop ? shop.online !== false : REW_ONLINE.includes(kind);
  return {text:t, amt, kind, shop:shop ? shop.id : null, online, intl};
}

/* ---------------- your cards ---------------- */
/** A rulebook card with its name, fee, income, status and transfer ratios filled in (from TRIP_DATA when `trip`). */
function rewCard(c){
  const t = c.trip ? TRIP_DATA.cards.find(x => x.id === c.trip) : null;
  return Object.assign({name:t && t.name, bank:t && t.bank, fee:t ? t.fee : 0, waive:t ? t.waive : null, income:t ? t.income : null,
    status:t ? t.status : "open", held:t ? t.held : "", to:t ? t.to : null, why:t && t.why}, c);
}
const REW_CARDS = REWARD_DATA.cards.map(rewCard);
const rewCardById = id => REW_CARDS.find(c => c.id === id) || null;
/** Your open card accounts, each with its rulebook card (null when the rulebook doesn't have it). */
function rewHeld(){
  return openGroups().map(g => {
    const G = GROUPS[g], name = String(G.short || "").toLowerCase();
    const card = rewCardById(G.catalog) || (!G.catalog || !rewCardById(G.catalog) ? REW_CARDS.find(c => c.held && name.includes(c.held)) : null) || null;
    return {g, short:G.short, card, addOn:/add-on/i.test(name)};
  });
}
/** Your settings for this tab (overrides.rew): Prime, and what a partner point is worth. */
function rewPrefs(){
  const o = overrides.rew && typeof overrides.rew === "object" ? overrides.rew : {};
  const v = (x, d) => typeof x === "number" && isFinite(x) && x >= 0 && x <= 10 ? x : d;
  return {prime:o.prime !== false, ai:v(o.ai, REWARD_DATA.value.ai), kf:v(o.kf, REWARD_DATA.value.kf)};
}
/** ₹ one partner point is worth: Air India, KrisFlyer (yours to set), Accor (€40 off for 2,000). */
function rewPartnerValue(p){
  const P = rewPrefs();
  return {ai:P.ai, kf:P.kf, accor:TRIP_DATA.accor.eur * TRIP_DATA.fx.eur / TRIP_DATA.accor.per}[p] || 0;
}
const REW_PARTNER = {ai:"Air India", kf:"KrisFlyer", accor:"Accor"};
/** What `pts` of this card are worth: {cash, miles, partner, best}. A cashback card's are rupees either way. */
function rewWorth(card, pts){
  const cash = pts * (card.cash ? card.cash.per : 0);
  let miles = 0, partner = null;
  if(card.unit === "points" && card.to) Object.keys(card.to).forEach(p => {
    const r = card.to[p]; if(!r) return;
    const v = pts / r * rewPartnerValue(p);
    if(v > miles){ miles = v; partner = p; }
  });
  return {cash, miles, partner, best:Math.max(cash, miles)};
}

/* ---------------- one spend on one card ---------------- */
/** The start of the cap period `per` that `ts` falls in (calendar months and quarters; a statement cycle is counted
    as a calendar month, which is close enough to plan with). */
function rewPeriod(per, ts){
  const d = new Date(ts);
  if(per === "quarter") return d.getFullYear() + "-Q" + Math.floor(d.getMonth() / 3);
  return d.getFullYear() + "-" + d.getMonth();
}
const rewKey = (cap, ts) => cap.id + "@" + rewPeriod(cap.per, ts);
/** Every way to pay for `sp` ({amt, kind, shop, online, intl}) with `card`: [{route, label, how, pts, rate, worth,
    capped, notes}], best first. used: {capKey: points used} (what you've earned toward each cap this period).
    at: when (for the cap periods). */
function rewWays(card, sp, used, at){
  const amt = sp.amt, kind = sp.kind, shop = sp.shop ? rewShop(sp.shop) : null, P = rewPrefs();
  const out = [];
  if(!(amt > 0)) return out;
  if(card.min && amt < card.min) return [{route:"card", label:"On the card", how:"Pay with the card", pts:0, extra:0, rate:0, caps:[], notes:["Spends under ₹" + card.min + " earn nothing on this card."], capped:false, worth:rewWorth(card, 0), net:0}];
  const base = card.base;
  const earnsNothing = card.no.includes(kind);
  const capOf = (pts, extra, caps) => {
    // apply each cap in turn; "extra" caps limit the points above the everyday rate
    let capped = false;
    caps.filter(Boolean).forEach(cp => {
      const left = Math.max(0, cp.max - (used[rewKey(cp, at)] || 0));
      if(cp.on === "extra"){ if(extra > left){ pts -= extra - left; extra = left; capped = true; } }
      else if(pts > left){ const cut = pts - left; pts = left; extra = Math.max(0, extra - cut); capped = true; }
    });
    return {pts, extra, capped};
  };
  const add = (route, label, how, rate, caps, notes, day, free) => {
    let pts = amt * rate / 100, extra = Math.max(0, amt * (rate - base) / 100);
    if(day && extra > day){ pts -= extra - day; extra = day; notes = notes.concat(["At most " + rewPts(day) + " extra points a day."]); }
    const r = capOf(pts, extra, caps);
    out.push({route, label, how, rate, pts:r.pts, extra:r.extra, capped:r.capped, caps:caps.filter(Boolean), notes, free:!!free});
  };
  // straight on the card
  const direct = () => {
    const notes = [];
    if(sp.intl){
      const r = card.intl === undefined ? base : card.intl;
      if(r === 0) return add("card", "On the card", "Pay with the card", 0, [], ["Foreign-currency spending earns nothing on this card."]);
      return add("card", "On the card", "Pay with the card", r, [card.cap], notes);
    }
    if(earnsNothing || (card.noDirect || []).includes(kind)){
      const why = card.maybe && card.maybe[kind] ? card.maybe[kind] : rewKind(kind).name + " earns nothing on this card.";
      return add("card", "On the card", "Pay with the card", 0, [], [why]);
    }
    let rate = base, label = "On the card", caps = [card.cap], how = "Pay with the card";
    if(card.kindCap && card.kindCap[kind]) caps.push({id:card.id + "-" + kind, max:card.kindCap[kind], per:"month", on:"total"});
    (card.bonus || []).forEach(b => {
      if(b.merchants && !(shop && b.merchants.includes(shop.id))) return;
      if(b.kinds && !b.kinds.includes(kind)) return;
      if(b.except && shop && b.except.includes(shop.id)) return;
      if(b.online && !sp.online) return;
      if(b.direct && b.direct.includes(kind) && shop && !shop.airline) return;     // the airline's own site only
      if(b.viaOta && !(shop && shop.kind === "travel")) return;                     // booked on a travel site
      if(b.min && amt < b.min) return;
      const r = b.prime && !P.prime ? b.prime : b.rate;
      if(r > rate){ rate = r; label = b.label; caps = (b.own ? [] : [card.cap]).concat(caps.slice(1), b.cap ? [b.cap] : []); }
    });
    if(card.maybe && card.maybe[kind]) notes.push(card.maybe[kind]);
    add("card", label, how, rate, caps, notes);
  };
  direct();
  if(!sp.intl) (card.routes || []).forEach(r => {
    const notes = r.note ? [r.note] : [];
    if(r.kinds && r.kinds[kind] !== undefined) add(r.id, r.label + " · " + rewKind(kind).name.toLowerCase(), r.how, r.kinds[kind], [r.cap], notes, r.day, true);
    if(shop && r.merchants && r.merchants[shop.id] !== undefined) add(r.id, r.label + " · " + shop.name, r.how, r.merchants[shop.id], [r.cap], notes, r.day);
    if(shop && shop.voucher && r.voucher !== undefined && !earnsNothing)
      add(r.id + "-v", r.label + " · " + shop.name + " voucher", "Buy a " + shop.name + " gift voucher on " + r.label + ", then pay with the voucher", r.voucher, [r.cap, r.vcap], notes.concat(["Check " + r.label + " sells " + shop.name + " vouchers today, and the voucher's own discount."]), r.day);
    if(r.partners !== undefined && shop && shop.ap) add(r.id, r.label + " at " + shop.name, r.how, r.partners, [], notes);
  });
  out.forEach(o => { o.worth = rewWorth(card, o.pts); if(sp.intl && card.fx){ o.fee = amt * card.fx / 100; } });
  out.forEach(o => { o.net = o.worth.best - (o.fee || 0); });
  return out.sort((a, b) => b.net - a.net || (a.route === "card" ? -1 : 1));
}
const rewPts = n => Math.round(n).toLocaleString("en-IN");

/* ---------------- what you've used this month ---------------- */
/** A transaction as a spend: the shop and kind from its description and category; SmartBuy and gift-voucher
    payments (GyFTR, Woohoo) count as SmartBuy. */
function rewTxSpend(x){
  const d = String(x.desc || "");
  const shop = REW_SHOPS.find(s => s.id !== "smartbuy" && s.re.test(d));
  let kind = null;
  const tk = tripKind(x);
  if(tk === "air") kind = "flights";
  else if(tk === "ota") kind = "travel";
  else if(tk !== "other" && tk !== "grocery") kind = tk;
  if(!kind && shop) kind = shop.kind;
  if(!kind){
    for(const k of REW_KINDS) if(k.re && !["shopping", "travel", "rent", "insurance", "jewellery"].includes(k.id) && k.re.test(d)){ kind = k.id; break; }
  }
  if(!kind) kind = {"Food & dining":"dining", "Groceries":"grocery", "Travel":"travel", "Shopping":"shopping", "Entertainment":"movies", "Health":"health", "Bills & subscriptions":"utilities"}[x.cat] || "other";
  const route = /gyftr|woohoo/i.test(d) ? "voucher" : /smart ?buy/i.test(d) ? "smartbuy" : "card";
  return {amt:x.amt, kind, shop:shop ? shop.id : null, online:!!shop, intl:false, route};
}
/** The points a card payment earned, the way it was paid (SmartBuy as a flight, a voucher as a voucher). */
function rewTxEarn(card, sp, used, at){
  const ways = rewWays(card, sp, used, at);
  let w = ways.find(o => o.route === "card");
  if(sp.route === "smartbuy"){ const s = rewWays(card, Object.assign({}, sp, {kind:"flights"}), used, at).find(o => o.route === "smartbuy"); if(s) w = s; }
  if(sp.route === "voucher"){
    const r = (card.routes || []).find(r => r.voucher !== undefined);
    if(r){ const s = rewWays(card, Object.assign({}, sp, {shop:"amazon"}), used, at).find(o => o.route === r.id + "-v"); if(s) w = s; }
  }
  return w || null;
}
/** Count `w` toward its caps. */
function rewUse(used, w, at){ (w.caps || []).forEach(cp => { const k = rewKey(cp, at); used[k] = (used[k] || 0) + (cp.on === "extra" ? w.extra : w.pts); }); }
const REW_SKIP = new Set(["Transfers to people", "UPI — payee unknown"]);
/** Your spending this month that a card could have paid (not money sent to people, investments, card bills …). */
function rewSpends(list){ return list.filter(x => x.dir === "out" && x.counted && !x.refunded && !REW_SKIP.has(x.cat) && x.amt > 0).sort((a, b) => a.ts - b.ts); }
/** "2.5 per ₹100" on a points card, "5%" on a cashback card. */
const rewRateText = (card, rate) => { const r = Math.round(rate * 100) / 100; return card.unit === "points" ? r.toLocaleString("en-IN") + " per ₹100" : r.toLocaleString("en-IN") + "%"; };
/** How one spend earned, in words: the everyday rate, a bonus, a portal, or why it earned nothing. */
function rewHow(card, w){
  if(!w) return {key:"none", text:"Earns nothing"};
  if(!(w.pts > 0)) return {key:"none:" + (w.notes[0] || ""), text:"Earns nothing", why:w.notes[0] || ""};
  const rate = rewRateText(card, w.rate);
  if(w.route !== "card") return {key:w.route + ":" + w.label, text:w.label + " · " + rate};
  if(w.label === "On the card") return {key:"base", text:"Everyday rate · " + rate};
  // a bonus that says its own rate ("5% on Amazon with Prime") doesn't need it twice
  return {key:"bonus:" + w.label, text:/\d/.test(w.label) ? w.label : w.label + " · " + rate};
}
/** This month on each card you hold: the points so far, what they're worth, and the caps used. */
function rewMonth(){
  const now = new Date(), ym = ymOf(now), held = rewHeld(), all = txFor(ym);
  // what the card earned on: your spending on it, and what you paid for someone else (it earns the same)
  const list = all.filter(x => x.dir === "out" && x.card && x.amt > 0 && !x.refunded && !REW_SKIP.has(x.cat) && (x.counted || x.forOther)).sort((a, b) => a.ts - b.ts);
  return held.map(h => {
    const used = {}, mine = list.filter(x => x.card === h.g), items = [], groups = {};
    let pts = 0, spent = 0;
    if(h.card) mine.forEach(x => {
      const sp = rewTxSpend(x), w = rewTxEarn(h.card, sp, used, x.ts);
      if(w){ pts += w.pts; rewUse(used, w, x.ts); }
      spent += x.amt;
      const how = rewHow(h.card, w);
      items.push({id:x.id, desc:x.desc, ts:x.ts, ym:x.ym, day:x.day, amt:x.amt, kind:sp.kind, pts:w ? w.pts : 0, capped:!!(w && w.capped), how:how.text, why:how.why || "", forOther:!!x.forOther});
      const gr = groups[how.key] = groups[how.key] || {text:how.text, why:how.why || "", n:0, amt:0, pts:0, none:!(w && w.pts > 0)};
      gr.n++; gr.amt += x.amt; gr.pts += w ? w.pts : 0;
    });
    else spent = mine.reduce((s, x) => s + x.amt, 0);
    const caps = [];
    if(h.card){
      const seen = {};
      const look = (cp, name) => { if(!cp || seen[cp.id]) return; seen[cp.id] = 1; caps.push({id:cp.id, name, max:cp.max, per:cp.per, on:cp.on, used:Math.min(cp.max, used[rewKey(cp, now.getTime())] || 0)}); };
      (h.card.routes || []).forEach(r => { look(r.cap, r.label + (r.cap && r.cap.on === "extra" ? " bonus points" : "")); look(r.vcap, r.label + " voucher bonus points"); });
      (h.card.bonus || []).forEach(b => look(b.cap, b.label));
      look(h.card.cap, "Everything on the card");
      Object.keys(h.card.kindCap || {}).forEach(k => look({id:h.card.id + "-" + k, max:h.card.kindCap[k], per:"month", on:"total"}, rewKind(k).name));
    }
    const ways = Object.values(groups).sort((a, b) => (a.none - b.none) || b.pts - a.pts || b.amt - a.amt);
    const full = caps.filter(c => c.per !== "quarter" && c.max > 0 && c.used / c.max >= 0.8).sort((a, b) => b.used / b.max - a.used / a.max);
    return Object.assign({}, h, {pts, spent, n:mine.length, used, caps, worth:h.card ? rewWorth(h.card, pts) : null,
      items:items.reverse(), ways, full:full[0] || null});
  });
}

/* ---------------- the search ---------------- */
/** Every card for a spend: yours (with your caps used) and the ones you could get, best way first.
    sp: from rewParse (amt null: ₹1,000 is used). */
function rewSearch(sp){
  const now = Date.now(), amt = sp.amt > 0 ? sp.amt : REW_DEFAULT_AMT, s = Object.assign({}, sp, {amt});
  const month = rewMonth(), income = rewIncome();
  // a kind you can buy in many places ("a new phone") also looks at the shops that sell it
  // (a chain you walk into, like Starbucks, isn't offered for "a restaurant": only apps and sites you'd use instead)
  const shops = s.shop ? [s.shop] : [null].concat(REW_SHOPS.filter(x => x.id !== "smartbuy" && ((x.sells || []).includes(s.kind) || (x.kind === s.kind && x.online !== false))).map(x => x.id));
  const bestOf = (card, used) => {
    const all = [], seen = {};
    shops.forEach(id => {
      rewWays(card, Object.assign({}, s, {shop:id}), used, now).forEach(w => {
        w.at = w.free ? null : id;
        const k = w.route + "|" + w.label + "|" + w.at;
        if(!seen[k]){ seen[k] = 1; all.push(w); }
      });
    });
    // best first; on a tie, the plain way (no particular shop, straight on the card)
    all.sort((a, b) => b.net - a.net || (a.at === null ? 0 : 1) - (b.at === null ? 0 : 1) || (a.route === "card" ? -1 : 1));
    return all;
  };
  const yours = month.filter(h => h.card).map(h => {
    const ways = bestOf(h.card, h.used), best = ways[0] || null;
    return {g:h.g, short:h.short, card:h.card, addOn:h.addOn, ways, best, mine:true};
  }).sort((a, b) => (b.best ? b.best.net : 0) - (a.best ? a.best.net : 0));
  const heldIds = new Set(month.filter(h => h.card).map(h => h.card.id));
  const could = REW_CARDS.filter(c => !heldIds.has(c.id) && rewCanGet(c, income)).map(c => {
    const ways = bestOf(c, {}), best = ways[0] || null;
    return {card:c, ways, best, mine:false};
  }).sort((a, b) => (b.best ? b.best.net : 0) - (a.best ? a.best.net : 0));
  const top = yours[0] && yours[0].best ? yours[0] : null;
  const better = could.find(x => x.best && x.best.net > (top ? top.best.net : 0) + 0.5) || null;
  return {sp:s, typedAmt:sp.amt > 0, yours, could, top, runner:yours[1] && yours[1].best ? yours[1] : null, better, unknown:month.filter(h => !h.card), income};
}

/* ---------------- income: which cards you could get ---------------- */
/** Yearly income for the cards' bars: what you typed on Trips, else your gross pay × 12 (Plan → Salary), else
    take-home × 12. */
function rewIncome(){ return tripIncome(tripPlan()); }
/* Cards left out of every "a card you could get" list (the search's "If you had…" and "Your next card"): you asked for
   them to go. Their rules stay, so the search still counts one you hold. */
const REW_LEFT_OUT = ["hsbc-travelone", "hsbc-live-plus"];
const rewCanGet = (c, inc) => c.status === "open" && !REW_LEFT_OUT.includes(c.id) && !(inc.amt !== null && c.income && inc.amt < c.income);

/* ---------------- the tab ---------------- */
/** What would the best of `cards` have paid for spend x (straight on the card), with caps counted in `used`. */
function rewBestFor(cards, x, usedBy){
  let best = 0, who = null, w0 = null;
  const sp = rewTxSpend(x);
  cards.forEach(c => {
    const used = usedBy[c.id] = usedBy[c.id] || {};
    const w = rewWays(c, Object.assign({}, sp, {route:"card"}), used, x.ts).find(o => o.route === "card");
    if(w && w.worth.best > best){ best = w.worth.best; who = c; w0 = w; }
  });
  if(who) rewUse(usedBy[who.id], w0, x.ts);
  return {best, card:who, sp, pts:w0 ? w0.pts : 0};
}
/** This month: what you earned against the best of your cards for every spend (paid the same way, straight on a card).
    misses: the biggest gaps. */
function rewMissed(){
  const now = new Date(), ym = ymOf(now), held = rewHeld(), cards = held.filter(h => h.card).map(h => h.card);
  const byG = {}, nameOf = {}; held.forEach(h => { byG[h.g] = h.card; if(h.card && !nameOf[h.card.id]) nameOf[h.card.id] = cardShort(h.g); });
  const list = rewSpends(txFor(ym)), usedBest = {}, usedReal = {};
  let got = 0, could = 0;
  const misses = [];
  list.forEach(x => {
    if(x.card && !byG[x.card]) return;                // a card the rulebook doesn't have: nothing to compare
    const b = rewBestFor(cards, x, usedBest);
    let real = 0;
    const c = x.card ? byG[x.card] : null;
    let realPts = 0;
    if(c){ const used = usedReal[c.id] = usedReal[c.id] || {}; const w = rewTxEarn(c, rewTxSpend(x), used, x.ts); if(w){ real = w.worth.best; realPts = w.pts; rewUse(used, w, x.ts); } }
    got += real; could += Math.max(real, b.best);
    if(b.best - real >= 1) misses.push({x, real, realPts, used:c, best:b.best, bestPts:b.pts, card:b.card, kind:b.sp.kind, gap:b.best - real});
  });
  misses.sort((a, b) => b.gap - a.gap);
  // the same lesson grouped: "for food delivery, use Amazon Pay ICICI"
  const tips = {};
  misses.forEach(y => {
    const k = y.card.id + "|" + y.kind;
    const t = tips[k] = tips[k] || {card:y.card, short:nameOf[y.card.id] || y.card.name, kind:y.kind, kindName:rewKind(y.kind).name, n:0, amt:0, gap:0, bestPts:0, from:{}, list:[]};
    t.n++; t.amt += y.x.amt; t.gap += y.gap; t.bestPts += y.bestPts; t.list.push(y);
    const f = y.used ? y.used.id : "bank";
    t.from[f] = t.from[f] || {card:y.used || null, short:y.x.card ? cardShort(y.x.card) : "bank or UPI", pts:0, worth:0};
    t.from[f].pts += y.realPts; t.from[f].worth += y.real;
  });
  const tipList = Object.values(tips).map(t => Object.assign(t, {from:Object.values(t.from)})).sort((a, b) => b.gap - a.gap);
  return {got, could, gap:Math.max(0, could - got), misses:misses.slice(0, 3), tips:tipList.slice(0, 4), n:list.length, cards:cards.length};
}
/** Your next card: your last three full months of spending (or this month so far) through your cards and each card
    you could get, the extra a year it would earn on the spends where it beats yours, less its yearly fee (with GST)
    unless that spending would waive it. */
function rewNext(){
  const now = new Date(), cur = ymOf(now), held = rewHeld(), mine = held.filter(h => h.card).map(h => h.card);
  let months = MONTHS.filter(k => k < cur).slice(0, 3), scale = 12 / Math.max(1, months.length), basis = "months";
  if(!months.length){
    months = [cur]; basis = "month";
    const day = now.getDate(), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    scale = 12 * (day >= 7 ? dim / day : 1);
  }
  const list = rewSpends(months.flatMap(k => txFor(k)));
  const income = rewIncome(), heldIds = new Set(mine.map(c => c.id));
  const usedMine = {}, base = list.map(x => rewBestFor(mine, x, usedMine).best);
  const rows = REW_CARDS.filter(c => !heldIds.has(c.id) && rewCanGet(c, income)).map(c => {
    const used = {}, kinds = {};
    let extra = 0, onIt = 0, pts = 0;
    list.forEach((x, i) => {
      const sp = rewTxSpend(x);
      const w = rewWays(c, Object.assign({}, sp, {route:"card"}), used, x.ts).find(o => o.route === "card");
      if(w && w.worth.best > base[i]){ extra += w.worth.best - base[i]; onIt += x.amt; pts += w.pts; rewUse(used, w, x.ts); kinds[sp.kind] = (kinds[sp.kind] || 0) + w.worth.best - base[i]; }
    });
    const year = extra * scale, spendYear = onIt * scale, ptsYear = pts * scale;
    const fee = c.waive && spendYear >= c.waive ? 0 : Math.round((c.fee || 0) * 1.18);
    const top = Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a]).slice(0, 2).map(k => rewKind(k).name.toLowerCase());
    return {card:c, year, fee, net:year - fee, spendYear, ptsYear, top, waived:!!(c.waive && spendYear >= c.waive && c.fee)};
  }).sort((a, b) => b.net - a.net);
  return {rows, basis, n:months.length, income, spent:list.reduce((s, x) => s + x.amt, 0)};
}
/** Milestones and fee waivers on the cards you hold: the spend so far this quarter, and over the last 12 months. */
function rewGoals(){
  const now = new Date(), q0 = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).getTime(), y0 = now.getTime() - 365 * DAY;
  const all = rewSpends(txFor(null));
  const out = [];
  rewHeld().filter(h => h.card).forEach(h => {
    const mine = all.filter(x => x.card === h.g);
    const sum = from => mine.filter(x => x.ts >= from).reduce((s, x) => s + x.amt, 0);
    (h.card.milestones || []).forEach(m => out.push({g:h.g, short:h.short, card:h.card, addOn:h.addOn, what:m.what, worth:m.worth, per:m.per, target:m.spend, done:sum(m.per === "quarter" ? q0 : y0)}));
    if(h.card.waive && h.card.fee && !h.addOn) out.push({g:h.g, short:h.short, card:h.card, addOn:h.addOn, what:"next year's fee waived", worth:Math.round(h.card.fee * 1.18), per:"year", target:h.card.waive, done:sum(y0), fee:true});
  });
  return out;
}
/** Everything the Rewards tab shows (the search is separate: rewSearch). */
function rewardsModel(){
  const month = rewMonth();
  return {month, missed:rewMissed(), next:rewNext(), goals:rewGoals(), prefs:rewPrefs(), income:rewIncome(), data:REWARD_DATA, kinds:REW_KINDS, shops:REW_SHOPS};
}

/* ---------------- actions ---------------- */
/** Change a Rewards setting (prime, ai, kf); null puts it back. */
act.setRew = function(k, v){
  const o = Object.assign({}, overrides.rew && typeof overrides.rew === "object" ? overrides.rew : {});
  if(v === null || v === undefined || v === "") delete o[k]; else o[k] = v;
  overrides.rew = o;
  if(!Object.keys(o).length) delete overrides.rew;
  render(); queueSave();
};
