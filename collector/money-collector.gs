/**
 * Money collector + dashboard — v4.2 (v4.1: syncs the Sheet to the new app after each run;
 *   v4.2: the app owns settings, planner, payments, goals and rules, and each run copies them back into App data;
 *   v4.3: App data also keeps your salary & fixed payments from the app, as 'cfg')
 * -----------------------------------------------------------------------------
 * PART 1 collects bank and card alerts from your Gmail into this sheet, every
 *        hour, on Google's servers. Since v4 it also reads card statements
 *        (ICICI's, and CRED's copy of every bill) and payment confirmations
 *        (CRED "payment was successful", ICICI "payment received") into a
 *        "Card events" tab, so the dashboard knows the real bill, the real due
 *        date, and which card each payment went to.
 * PART 2 serves the dashboard behind your own Google login.
 *
 * This REPLACES the earlier file. In the Apps Script editor select everything,
 * delete it, paste this in, save, then follow the steps in the chat.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

var SENDERS = [
  'alerts@axis.bank.in',
  'credit_cards@icici.bank.in',
  'onlinesbicard@sbicard.com',
  'emandates@sbicard.com',
  'alerts@hdfcbank.bank.in',
  'alerts@hdfcbank.net'          // HDFC's older alert address
];

// CRED's "new bill" and "payment was successful" emails name the exact card and
// amount, which the bank debit alert never does. Only those two kinds are read.
var CRED_QUERY = '(from:cred.club {subject:"payment was successful" subject:"new bill"})';

var LOOKBACK_DAYS = 10;
var BACKFILL_DAYS = 120;
var SHEET_NAME    = 'Transactions';
var EVENTS_NAME   = 'Card events';
var LOG_NAME      = 'Run log';
var FEED_MAX_ROWS = 2000;
var EVENTS_MAX    = 400;

// Order matters: first match wins. \b word boundaries stop "toll" matching
// "Toll Free", "rent" matching "current", and so on.
var RULES = [
  ['Cash & transfers',      /\b(atm|cash ?wdl|cash withdrawal|credit ?card (payment|bill)|card ?payment|billdesk|bbps|cred|cred ?club|dreamplug|ccpay|autopay|sbi ?card|sbicard|icici ?(bank )?(credit )?card)\b/i],
  ['Groceries',             /\b(blinkit|zepto|instamart|bigbasket|big basket|dmart|jiomart|grofers|nature'?s basket|more retail|supermarket|kirana)\b/i],
  ['Food & dining',         /\b(swiggy|zomato|eternal|district|dominos|domino'?s|kfc|mcdonald'?s?|burger king|pizza ?hut|starbucks|chaayos|haldiram'?s?|barbeque|eatclub|faasos|behrouz|box8|restaurant|cafe|dhaba|bakery|biryani|kitchen)\b/i],
  ['Travel',                /\b(cleartrip|irctc|air ?india|indigo|interglobe|akasa|spicejet|vistara|makemytrip|make my trip|goibibo|yatra|ixigo|redbus|abhibus|uber|ola ?cabs|olacabs|rapido|blusmart|namma yatri|petrol|fuel|iocl|indian ?oil|hpcl|bpcl|fastag|toll ?plaza|dmrc|metro ?rail|railways?|oyo|airbnb|agoda)\b/i],
  ['Entertainment',         /\b(bookmyshow|book my show|pvr|inox|cinepolis|paytm insider|steam|playstation|xbox)\b/i],
  ['Bills & subscriptions', /\b(google ?play|netflix|spotify|hotstar|jiohotstar|prime ?video|youtube|apple\.com|icloud|jio|airtel|vodafone|bsnl|electricity|bescom|tata ?power|broadband|fibernet|insurance|ergo|lic|policy|premium|jobcopilot|openai|chatgpt|anthropic|claude|adobe|notion|github|linkedin|gst|card charges|annual fee|recharge|e-?mandate|rent|nobroker|maintenance)\b/i],
  ['Health',                /\b(apollo|pharmacy|pharma|pharmeasy|1mg|netmeds|hospital|clinic|diagnostics?|medplus|practo|cult\.?fit|healthkart|dental)\b/i],
  ['Investments',           /\b(zerodha|groww|upstox|mutual ?fund|sip|indian clearing|iccl|nsccl|smallcase|angel ?one|paytm money|kuvera|motilal)\b/i],
  ['Shopping',              /\b(amazon|flipkart|myntra|ajio|nykaa|meesho|decathlon|body ?shop|croma|reliance ?(digital|trends)|lenskart|ikea|tata ?cliq|snapdeal|uniqlo|zara|westside|shoppers stop)\b/i]
];

// Categories that are money moving, not money spent.
var NOT_SPENDING = { 'Cash & transfers': true, 'Investments': true };

var HEADERS = ['Message ID','Date','Day','Month','Account','Kind','Description',
               'Category','Amount','Direction','Counted as spending','Raw info'];

// Statements and payment confirmations: the bank's own figures, kept apart from spending.
var EVENT_HEADERS = ['Message ID','Email date','Card','Type','Amount','Minimum due',
                     'Due date','Statement date','Source','Issuer'];

// ===========================================================================
// PART 1 — collecting
// ===========================================================================

function collect()  { return run_(LOOKBACK_DAYS); }
function backfill() { return run_(BACKFILL_DAYS); }

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'collect') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('collect').timeBased().everyHours(1).create();
  collect();
  var msg = 'Schedule installed. The collector now runs every hour.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Money')
    .addItem('Collect now', 'collect')
    .addItem('Backfill history', 'backfill')
    .addItem('Install hourly schedule', 'installTrigger')
    .addSeparator()
    .addItem('Open dashboard here', 'showDashboard')
    .addItem('Show phone address', 'showAppLink')
    .addItem('Test the feed', 'testFeed')
    .addItem('Re-clean all rows', 'recleanSheet')
    .addItem('Sync to the new app now', 'syncNow')
    .addToUi();
}

function run_(days) {
  // An hourly run and a manual Backfill can overlap; without this both append the same rows.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'Another collection is still running — skipped.';
  try { return runLocked_(days); } finally { lock.releaseLock(); }
}

function runLocked_(days) {
  var started = new Date();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('sheetId', ss.getId());
  var sheet = ensureSheet_(ss);
  var evSheet = ensureEvents_(ss);

  var seen = {};
  [sheet, evSheet].forEach(function (sh) {
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
        if (r[0]) seen[String(r[0])] = true;
      });
    }
  });

  var query = '({from:' + SENDERS.join(' from:') + '} OR ' + CRED_QUERY + ') newer_than:' + days + 'd';
  var threads = GmailApp.search(query, 0, 400);
  var rows = [], events = [], skipped = 0, unparsed = 0;

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var id = msg.getId();
      if (seen[id]) { skipped++; return; }
      var c;
      try { c = ctx_(msg); } catch (err) { unparsed++; return; }   // one bad message mustn't stop the run
      var ev = null;
      try { ev = parseEvent_(c); } catch (err) { ev = null; }
      if (ev) {
        seen[id] = true;
        events.push([ev.id, ev.date, ev.last4, ev.type, ev.amount, ev.min === null ? '' : ev.min,
                     ymd_(ev.due), ymd_(ev.stmt), ev.src, ev.issuer]);
        return;
      }
      var tx;
      try { tx = parseMessage_(c); } catch (err) { tx = null; }
      if (!tx) { unparsed++; return; }
      seen[id] = true;
      rows.push([
        tx.id, tx.date, tx.date.getDate(),
        Utilities.formatDate(tx.date, Session.getScriptTimeZone(), 'yyyy-MM'),
        tx.account, tx.kind, tx.description, tx.category,
        tx.amount, tx.direction, tx.counted ? 'Yes' : 'No', tx.raw
      ]);
    });
  });

  if (rows.length) {
    rows.sort(function (a, b) { return a[1] - b[1]; });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
    sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).setNumberFormat('dd MMM yyyy, HH:mm');
    sheet.getRange(2, 9, sheet.getLastRow() - 1, 1).setNumberFormat('#,##0.00');
  }
  if (events.length) {
    events.sort(function (a, b) { return a[1] - b[1]; });
    var at = evSheet.getLastRow() + 1;
    evSheet.getRange(at, 1, events.length, 1).setNumberFormat('@');
    evSheet.getRange(at, 3, events.length, 1).setNumberFormat('@');     // keeps 0042 from becoming 42
    evSheet.getRange(at, 7, events.length, 2).setNumberFormat('@');     // dates stay as text
    evSheet.getRange(at, 1, events.length, EVENT_HEADERS.length).setValues(events);
    evSheet.getRange(at, 2, events.length, 1).setNumberFormat('dd MMM yyyy, HH:mm');
  }

  PropertiesService.getScriptProperties().setProperty('lastRun', String(started.getTime()));
  var msg = 'Added ' + rows.length + (events.length ? ' + ' + events.length + ' statements/payments' : '') +
            ', already had ' + skipped + ', ignored ' + unparsed + ' non-transaction emails';
  // v4.1: mirror the Sheet into the new app's database (supabase-sync.gs). A failure only notes itself in the log.
  if (typeof syncToSupabase === 'function') msg += ' · ' + syncToSupabase(msg);
  writeLog_(ss, started, msg);
  return msg;
}

function ensureSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#16241F').setFontColor('#F1F4F2');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150); sheet.setColumnWidth(2, 160);
    sheet.setColumnWidth(7, 220); sheet.setColumnWidth(12, 300);
  }
  return sheet;
}

function ensureEvents_(ss) {
  var sh = ss.getSheetByName(EVENTS_NAME);
  if (!sh) {
    sh = ss.insertSheet(EVENTS_NAME);
    sh.getRange(1, 1, 1, EVENT_HEADERS.length).setValues([EVENT_HEADERS])
      .setFontWeight('bold').setBackground('#16241F').setFontColor('#F1F4F2');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 160);
  }
  return sh;
}

function writeLog_(ss, started, message) {
  var log = ss.getSheetByName(LOG_NAME);
  if (!log) {
    log = ss.insertSheet(LOG_NAME);
    log.getRange(1, 1, 1, 3).setValues([['Ran at', 'Took (s)', 'Result']]).setFontWeight('bold');
    log.setFrozenRows(1);
    log.setColumnWidth(1, 170); log.setColumnWidth(3, 420);
  }
  log.insertRowAfter(1);
  log.getRange(2, 1, 1, 3).setValues([[started, (new Date() - started) / 1000, message]]);
  log.getRange(2, 1).setNumberFormat('dd MMM yyyy, HH:mm');
  if (log.getLastRow() > 200) log.deleteRows(201, log.getLastRow() - 200);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function num_(s) { return parseFloat(String(s).replace(/,/g, '')); }
function yy_(y)  { y = parseInt(y, 10); return y < 100 ? 2000 + y : y; }
function clean_(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function titleish_(s) {
  s = clean_(s).replace(/\s*\b(pvt|private|ltd|limited|india|systems?|technolog\w+)\b\.?/gi, ' ')
               .replace(/\s+/g, ' ').trim();
  if (!s) return s;
  if (/^[A-Z0-9 &.\-]+$/.test(s) && s.length > 3) {
    return s.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }
  return s;
}

/** Axis appends support numbers, disclaimers and a copyright footer. Cut at the first of them. */
function cleanInfo_(s) {
  s = clean_(s);
  var cut = s.search(/\s*(Feel free|Call us|Always open|Regards,|If this (transaction|was not)|To block|Please do not|This is a (system|generated)|Reach us|Copyright|\*{3,}|E\d{6,}_\d)/i);
  if (cut !== -1) s = s.slice(0, cut);
  return s.replace(/[\s.,;:-]+$/, '').slice(0, 90);
}

/** "UPI/P2A/626.../JATIN RAW/HDFC/Paid" -> {rail, kind, name, note}. Also IMPS/NEFT. */
function parseRail_(s) {
  var m = String(s || '').match(/^(UPI|IMPS|NEFT|RTGS)\/(P2A|P2M|P2P)?\/?/i);
  if (!m) return null;
  var parts = s.split('/');
  var hasKind = /^(P2A|P2M|P2P)$/i.test(parts[1] || '');
  var name = parts[hasKind ? 3 : 2] || '';
  var note = parts.slice(hasKind ? 5 : 4).join(' ').trim();
  if (/^\d+$/.test(name)) name = '';
  return { rail: m[1].toUpperCase(), kind: hasKind ? parts[1].toUpperCase() : '', name: name.trim(), note: note };
}

function categorise_(text, kind, direction, railKind, hasName) {
  if (direction === 'in') return /refund|reversal|cashback/i.test(text) ? 'Refunds' : 'Money in';
  for (var i = 0; i < RULES.length; i++) {
    if (RULES[i][0] === 'Cash & transfers' && kind === 'card') continue;  // card-side spends are never bill payments
    if (RULES[i][1].test(text)) return RULES[i][0];
  }
  if (railKind === 'P2A' || railKind === 'P2P') return 'Transfers to people';
  if (!hasName) return 'UPI — payee unknown';
  return 'Other';
}

/**
 * Rebuilds description, category and the counted flag from the stored raw text.
 * Used on new rows and on every row served, so rules improve old data too.
 */
function refine_(kind, desc, raw, direction) {
  var info = cleanInfo_(raw || '');
  var rail = parseRail_(info);
  var name = '';

  if (rail) name = rail.name;
  else if (info) name = info.replace(/^UPI-\d+-/i, '').replace(/^UPI\//i, '');
  name = name.replace(/([A-Za-z])(LIMITED|LTD|PRIVATE|PVT|INDIA|TECHNOLOGIES)\b/g, '$1 $2');

  var d = name ? titleish_(name) : cleanInfo_(desc || '');
  if (!d || /^UPI payment$/i.test(d)) d = rail && rail.kind === 'P2A' ? 'Transfer' : 'UPI payment';
  if (rail && rail.note && !/^(paid|pay|payment|upi|na|sent|transfer)$/i.test(rail.note)) {
    d += ' · ' + titleish_(rail.note).slice(0, 30);
  }
  if (desc && /\(auto-debit\)/.test(desc) && d.indexOf('auto-debit') === -1) d += ' (auto-debit)';

  // Categorise on the payee and note only — never on email boilerplate.
  var text = [name, rail ? rail.note : '', rail ? '' : info].join(' ');
  var cat = categorise_(text, kind, direction, rail ? rail.kind : '', !!name);
  return { description: d.slice(0, 60), category: cat, raw: info,
           counted: direction === 'out' && !NOT_SPENDING[cat] };
}

/** Reads a message once; both parsers work from this. */
function ctx_(msg) {
  return {
    id: msg.getId(),
    from: String(msg.getFrom() || '').toLowerCase(),
    subject: clean_(msg.getSubject()),
    body: clean_(msg.getPlainBody()),
    date: msg.getDate()
  };
}

var MONTHS_ = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
// Tolerant on purpose: getPlainBody() can put "₹", "Rs.", "INR", an image placeholder or a
// stray symbol between a label and its number.
var AMT_ = '\\D{0,12}?(\\d[\\d,]*(?:\\.\\d{1,2})?)';
var MDY_ = '([A-Za-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})';
var MASKED_ = '(?:X{2,}|\\*{2,}|•{2,}|ending(?: with)?)[\\s-]*(\\d{4})\\b';

function dateOf_(mon, d, y) {
  var m = MONTHS_.indexOf(String(mon || '').slice(0, 3).toLowerCase());
  return m < 0 ? null : new Date(+y, m, +d, 12, 0);
}
function ymd_(d) {
  return d instanceof Date && !isNaN(d.getTime())
    ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
}
function issuer_(body, last4) {
  var m = body.match(new RegExp('(ICICI|SBI|HDFC|Axis|Kotak|IDFC|HSBC|Amex|American Express|RBL|IndusInd|Yes|AU|BOB)\\b[^\\d]{0,24}' + last4, 'i'));
  return m ? m[1].toUpperCase() : '';
}
function ev_(c, last4, type, amount, min, due, stmt, src, issuer) {
  if (!(amount >= 0) || !/^\d{4}$/.test(last4)) return null;
  // Statement emails arrive the day after the statement closes; use that if the date wasn't readable.
  if (type === 'statement' && !stmt && c.date) stmt = new Date(c.date.getTime() - 86400000);
  return { id: c.id, date: c.date, last4: last4, type: type, amount: amount,
           min: min, due: due, stmt: stmt, src: src, issuer: issuer || '' };
}
function field_(body, label) {
  var m = body.match(new RegExp(label + AMT_, 'i'));
  return m ? num_(m[1]) : null;
}
function dateField_(body, label) {
  var m = body.match(new RegExp(label + '\\D{0,12}?' + MDY_, 'i'));
  return m ? dateOf_(m[1], m[2], m[3]) : null;
}

/**
 * Statements and payment confirmations. These carry the bank's own figures — the
 * real bill, its real due date, and which card a payment went to — so the
 * dashboard doesn't have to guess them from spending alerts.
 *   CRED   "…•••• 1234 payment details amount paid ₹17,419.70 payment date Oct 05, 2026…"
 *   CRED   "…•••• 5678 bill summary total amount due ₹2870.00 minimum due ₹200.00 due date October 01, 2026 bill generated on Sep 10, 2026…"
 *   ICICI  "We have received payment of INR 17419.70 on your ICICI Bank Credit Card account 4501 XXXX XXXX 1234 on 05-Oct-2026."
 *   ICICI  statement: "Payment due by October 3, 2026 … Credit Card XX1234 … Minimum Amount Due: ₹100.00 … Total Amount Due: ₹817.32"
 */
function parseEvent_(c) {
  var body = c.body.replace(/\|/g, ' ').replace(/\s+/g, ' ');
  var m;

  if (c.from.indexOf('cred.club') !== -1) {
    m = body.match(new RegExp('(\\d{4})\\D{0,40}?payment details\\D{0,40}?amount paid' + AMT_, 'i'));
    if (m) return ev_(c, m[1], 'payment', num_(m[2]), null, null, null, 'CRED', issuer_(body, m[1]));
    // Bills: read each field on its own, so a reordered or decorated layout still works.
    m = body.match(/(\d{4})\D{0,40}?bill summary/i);
    var total = field_(body, 'total amount due');
    if (m && total !== null) {
      return ev_(c, m[1], 'statement', total, field_(body, 'minimum (?:amount )?due'),
                 dateField_(body, 'due date'), dateField_(body, 'bill generated on'), 'CRED', issuer_(body, m[1]));
    }
    return null;
  }

  if (c.from.indexOf('icici') !== -1) {
    m = body.match(new RegExp('received (?:a )?payment of' + AMT_ + '[\\s\\S]{0,80}?' + MASKED_, 'i'));
    if (m) return ev_(c, m[2], 'payment', num_(m[1]), null, null, null, 'ICICI', 'ICICI');

    if (/statement/i.test(c.subject) && /total amount due/i.test(body)) {
      var card = body.match(new RegExp('Credit Card[\\s\\S]{0,40}?' + MASKED_, 'i'));
      var tot  = field_(body, 'Total Amount Due');
      var per  = c.subject.match(new RegExp('period.*?\\bto\\s+' + MDY_, 'i'));
      if (card && tot !== null) {
        return ev_(c, card[1], 'statement', tot, field_(body, 'Minimum Amount Due'),
                   dateField_(body, 'Payment due'), per ? dateOf_(per[1], per[2], per[3]) : null, 'ICICI', 'ICICI');
      }
    }
  }
  return null;
}

/**
 * HDFC Bank savings accounts. One alert per transaction:
 *   UPI out   "Rs.1616.92 is debited from your account ending 1234 towards VPA ****abcd@rapl (Amazon Pay) on 31-10-26.
 *              UPI transaction reference no.: 630400000000."
 *   UPI in    "Rs.500.00 is successfully credited to your account **1234 by VPA friend@okhdfcbank A FRIEND on 01-11-26."
 *   NEFT in   "Update! INR 54,606.00 deposited in HDFC Bank A/c XX1234 on 30-OCT-26 for NEFT Cr-HDFC0000000-EXAMPLE EMPLOYER
 *              LTD-YOUR NAME-EMP0001.Avl bal INR 54,606.00."
 * The alert has a date but no time: the email's own time is used when it's the same day.
 * Returns a row in the Axis shape (raw = "UPI/<ref>/<name>" or "NEFT//<name>", so refine_ names and files it).
 */
function hdfcAccount_(hb, fallback) {
  var m = hb.match(/(?:Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)\s*(?:has been|is|was)?\s*(?:successfully\s*)?(debited|credited|deposited)\s+(?:from|to|in(?:to)?)\s+(?:your\s+)?(?:HDFC Bank\s+)?(?:a\/c|account)\s*(?:ending|no\.?)?\s*(?:XX|\*+|x+)?(\d{4})(.*?)\s+on\s+(\d{1,2})-([A-Za-z]{3}|\d{1,2})-(\d{2,4})(.*)$/i);
  if (!m) return null;
  var mon = /^\d+$/.test(m[6]) ? +m[6] - 1 : ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[6].toLowerCase());
  var yr = m[7].length === 2 ? yy_(m[7]) : +m[7];
  var day = new Date(yr, mon, +m[5], 12, 0);
  var at = fallback && fallback.getFullYear() === yr && fallback.getMonth() === mon && fallback.getDate() === +m[5] ? fallback : day;
  var mid = m[4].replace(/^\s*(towards|to|by|from)\s+/i, '').trim(), tail = m[8] || '';
  var ref = (tail.match(/reference (?:no\.?|number)(?: is)?:?\s*(\d{6,})/i) || [])[1] || '';
  var raw = '', desc = 'UPI payment', v;
  if ((v = mid.match(/VPA\s+(\S+)\s*(?:\(([^)]+)\)|(.+))?$/i))) {
    var who = (v[2] || v[3] || '').trim() || v[1].replace(/^\*+/, '');
    raw = 'UPI/' + (ref || 'x') + '/' + who;
  } else if ((v = tail.match(/(?:for|by|towards)\s+(NEFT|IMPS|RTGS)\s*(?:Cr|Dr)?\s*-?\s*([^.]*)/i))) {
    var parts = v[2].split('-').map(function (x) { return x.trim(); }).filter(function (x) { return x && !/\d{3,}/.test(x); });
    raw = v[1].toUpperCase() + '//' + (parts[0] || '');
    desc = v[1].toUpperCase();
  } else {
    raw = (mid || tail).replace(/\.\s*$/, '').slice(0, 80);
  }
  return { account: 'HDFC Bank Savings XX' + m[3], kind: 'bank', date: at, amount: num_(m[1]),
           direction: /debited/i.test(m[2]) ? 'out' : 'in', description: desc, raw: raw };
}

/** An account's last 4 digits where the bank's email leaves them out (Axis's UPI alerts, SBI Card's auto-debits): kept in
    this script's properties (Apps Script → Project Settings → Script properties: AXIS_LAST4, SBI_CARD_LAST4), so this
    file holds no account numbers. */
function last4_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '0000';
}

function parseMessage_(c) {
  var from = c.from, subject = c.subject, body = c.body;
  var fallback = c.date;
  var hit = null, m;

  if (from.indexOf('axis') !== -1) {
    if (/pre-?debit|feedback|survey|application|apply now|offer|statement/i.test(subject)) return null;
    m = subject.match(/INR\s([\d,]+\.?\d*)\swas\s(debited|credited)/i);
    if (m) {
      var d1 = body.match(/Date & Time:\s*(\d{2})-(\d{2})-(\d{2})[, ]+(\d{2}):(\d{2})/);
      var info = body.match(/Transaction Info:\s*(.*)/i);
      hit = {
        account: 'Axis Bank Savings XX' + last4_('AXIS_LAST4'), kind: 'bank',
        date: d1 ? new Date(yy_(d1[3]), +d1[2] - 1, +d1[1], +d1[4], +d1[5]) : fallback,
        amount: num_(m[1]), direction: /credited/i.test(m[2]) ? 'in' : 'out',
        description: 'UPI payment', raw: info ? info[1] : ''
      };
    } else {
      m = body.match(/A\/c no\.\s*XX(\d{4})\s*has been (debited|credited) with INR\s([\d,]+\.?\d*)\s*on\s(\d{2})-(\d{2})-(\d{4})\s*(\d{2}):(\d{2})/i);
      if (m) {
        var why = body.match(/IST\s+by\s+(.*?)\s*\./i);
        hit = {
          account: 'Axis Bank Savings XX' + m[1], kind: 'bank',
          date: new Date(+m[6], +m[5] - 1, +m[4], +m[7], +m[8]),
          amount: num_(m[3]), direction: /credited/i.test(m[2]) ? 'in' : 'out',
          description: 'Bank charge', raw: why ? why[1] : ''
        };
      }
    }
  }
  else if (from.indexOf('icici') !== -1) {
    if (/statement|offer|reward|personal loan|gift card|secure your|digital modes|application/i.test(subject)) return null;
    m = body.match(/Credit Card\s*XX(\d{4})\s*has been used for a transaction of INR\s([\d,]+\.?\d*)\s*on\s(\w{3})\s(\d{1,2}),\s*(\d{4})\s*at\s*(\d{2}):(\d{2})/i);
    if (m) {
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var mi = months.indexOf(m[3]);
      var info2 = body.match(/Info:\s*(.*?)(?:\.\s|The Available|$)/i);
      hit = {
        account: 'ICICI Credit Card XX' + m[1], kind: 'card',
        date: new Date(+m[5], mi < 0 ? 0 : mi, +m[4], +m[6], +m[7]),
        amount: num_(m[2]), direction: 'out',
        description: 'Card transaction', raw: info2 ? info2[1] : ''
      };
    }
  }
  else if (from.indexOf('sbicard') !== -1) {
    if (/pre-?debit|registration success|drive with|know more|statement/i.test(subject)) return null;
    m = body.match(/Rs\.?\s*([\d,]+\.?\d*)\s*spent on your SBI Credit Card ending\s*(\d{4})\s*at\s*(.+?)\s*on\s*(\d{2})\/(\d{2})\/(\d{2})/i);
    if (m) {
      hit = { account: 'SBI Card XX' + m[2], kind: 'card',
              date: new Date(yy_(m[6]), +m[5] - 1, +m[4], 12, 0),
              amount: num_(m[1]), direction: 'out', description: m[3], raw: m[3] };
    } else if (/e-?mandate/i.test(subject) && /processed|success/i.test(subject) && (m = body.match(/Amount:\s*(?:Rs\.?|INR|₹)?\s*([\d,]+\.?\d*)/i))) {
      // Since Nov 2026: "Recurring E-mandate processed successfully on your SBI Credit Card" — "… SBI Credit Card XX
      // ending with 1234 … Amount: Rs.2,869.83 Merchant: HDFC ERGO SiHub ID: … Trxn. Ref. No.: … Date: 05-Nov-2026
      // Time: 14:34:34"
      var mer = body.match(/Merchant:\s*(.+?)\s*(?:SiHub|Trxn|Date:|To manage|$)/i);
      var dt = body.match(/Date:\s*(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ](\d{4})(?:\s*Time:\s*(\d{1,2}):(\d{2}))?/i);
      var card = body.match(/ending(?: with)?\s*(\d{4})/i);
      var mi2 = dt ? MONTHS_.indexOf(dt[2].toLowerCase()) : -1;
      var who = mer ? mer[1] : 'E-mandate';
      hit = { account: 'SBI Card XX' + (card ? card[1] : last4_('SBI_CARD_LAST4')), kind: 'card',
              date: mi2 < 0 ? fallback : new Date(+dt[3], mi2, +dt[1], dt[4] ? +dt[4] : 12, dt[5] ? +dt[5] : 0),
              amount: num_(m[1]), direction: 'out', description: who + ' (auto-debit)', raw: who + ' e-mandate' };
    } else if (/debit success/i.test(subject)) {
      m = body.match(/Transaction of Rs\.?\s*([\d,]+\.?\d*)\s*at\s*(.+?)\s*against E-?mandate/i);
      if (m) {
        hit = { account: 'SBI Card XX' + last4_('SBI_CARD_LAST4'), kind: 'card', date: fallback,
                amount: num_(m[1]), direction: 'out',
                description: m[2] + ' (auto-debit)', raw: m[2] + ' e-mandate' };
      }
    }
  }

  else if (from.indexOf('hdfcbank') !== -1) {
    // "Rs. 2.00 has been debited from your HDFC Bank Credit Card ending 1234 towards PTM*UBER INDIA SYSTEMS on
    //  30 Oct, 2026 at 17:57:26." Only card spends: HDFC's account, offer and statement emails are skipped.
    if (/statement|offer|reward|loan|registration|on its way|account is active|welcome/i.test(subject)) return null;
    var hb = body.replace(/\|/g, ' ').replace(/\s+/g, ' ');
    // HDFC's card emails are HTML only, with the amount, card, merchant and date in bold; Apps Script's plain text turns
    // bold into *stars* ("*Rs. 192.00* has been debited … ending *1234* towards *RSP*SWIGGY PVT LTD FOO* on *31 Oct…*").
    // Drop the stars around words but keep the one inside a merchant name (RSP*SWIGGY).
    hb = hb.replace(/(^|[\s(:])\*+(?=\S)/g, '$1').replace(/(\S)\*+(?=[\s.,;:)]|$)/g, '$1');
    hit = hdfcAccount_(hb, fallback);                      // a savings account first
    if (!hit) m = hb.match(/Rs\.?\s*([\d,]+\.?\d*)\s*(?:has been|is|was)\s*debited from your HDFC Bank Credit Card ending\s*(\d{4})\s*(?:towards|at)\s*(.+?)\s+on\s+(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[, -]+(\d{2,4})(?:\s*at\s*(\d{1,2}):(\d{2}))?/i);
    // "Thank you for using your HDFC Bank Card XX1234 for Rs. 1999.0 at GOOGLEPLAY on 05-11-2026 18:53:26." (subscriptions,
    // auto-debits and tap payments use this wording instead)
    if (!hit && !m) m = hb.match(/using your HDFC Bank (?:Credit )?Card\s*(?:ending\s*)?(?:XX|\*+|x+)?(\d{4})\s*for\s*(?:Rs\.?|INR)\s*([\d,]+\.?\d*)\s*at\s*(.+?)\s+on\s+(\d{1,2})[ -](\d{1,2}|[A-Za-z]{3})[a-z]*[ -](\d{2,4})(?:\s*(\d{1,2}):(\d{2}))?/i);
    if (m && /using your HDFC/i.test(m[0])) m = [m[0], m[2], m[1], m[3], m[4], m[5], m[6], m[7], m[8]];
    var refund = false;
    // "A transaction reversal of Rs. 2.00 has been initiated to your HDFC Bank Credit Card ending 1234 From Merchant:
    //  PTM*UBER INDIA SYSTEMS Date Time: 30 Oct, 2026 at 17:58:10"
    if (!hit && !m) {
      m = hb.match(/(?:reversal|refund) of Rs\.?\s*([\d,]+\.?\d*)\s*has been (?:initiated|processed|credited) to your HDFC Bank Credit Card ending\s*(\d{4})\s*From Merchant:?\s*(.+?)\s+Date(?:\s*(?:&|and)?\s*Time)?:?\s*(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[, -]+(\d{2,4})(?:\s*at\s*(\d{1,2}):(\d{2}))?/i);
      refund = !!m;
    }
    if (!hit && m) {
      var hm = /^\d+$/.test(m[5]) ? +m[5] - 1 : ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[5].toLowerCase());
      var hy = m[6].length === 2 ? yy_(m[6]) : +m[6];
      // "RSP*SWIGGY PVT LTD FOO" -> "SWIGGY": drop the payment gateway's prefix (Razorpay, Paytm…) and the cut-off company suffix
      var who = m[3].replace(/^[A-Z]{2,5}\s?\*\s?/, '').replace(/\s+(PVT|PRIVATE)?\s*(LTD|LIMITED)\b.*$/i, '').trim() || m[3];
      hit = { account: 'HDFC Credit Card XX' + m[2], kind: 'card',
              date: hm < 0 ? fallback : new Date(hy, hm, +m[4], m[7] ? +m[7] : 12, m[8] ? +m[8] : 0),
              amount: num_(m[1]), direction: refund ? 'in' : 'out', description: who, raw: who, refund: refund };
    }
  }

  if (!hit || !(hit.amount > 0) || !hit.date) return null;
  var r = refine_(hit.kind, hit.description, hit.raw, hit.direction);
  hit.id = c.id;
  hit.description = r.description;
  hit.category = r.category;
  hit.raw = r.raw;
  hit.counted = r.counted;
  if (hit.refund) { hit.category = 'Refunds'; hit.description = 'Refund · ' + hit.description; hit.counted = false; delete hit.refund; }
  return hit;
}

/** Rewrites Description, Category, Counted and Raw info on every existing row with the current rules. */
function recleanSheet() {
  var sheet = sheet_();
  if (!sheet || sheet.getLastRow() < 2) return 'Nothing to clean';
  var n = sheet.getLastRow() - 1;
  var rng = sheet.getRange(2, 1, n, HEADERS.length);
  var v = rng.getValues();
  for (var i = 0; i < n; i++) {
    var r = refine_(String(v[i][5]), String(v[i][6]), String(v[i][11]), String(v[i][9]));
    v[i][6] = r.description; v[i][7] = r.category; v[i][10] = r.counted ? 'Yes' : 'No'; v[i][11] = r.raw;
  }
  rng.setValues(v);
  var msg = 'Cleaned ' + n + ' rows';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

// ===========================================================================
// PART 2 — the dashboard, served by Google and gated by your own login
// ===========================================================================

/**
 * Serves the dashboard. Deploy with:
 *   Execute as:      Me
 *   Who has access:  Only myself
 * Google then demands your sign-in before this ever runs. There is no token,
 * no public URL and no endpoint to leak.
 */
function doGet() {
  var out = HtmlService.createHtmlOutputFromFile('Dashboard').setTitle('Money');

  // addMetaTag accepts only a short whitelist and THROWS on anything else,
  // which takes the whole page down. Viewport is the one that matters on a
  // phone; every other meta tag lives in Dashboard.html's own <head>. Guarded,
  // because a missing meta tag is a cosmetic problem, not a reason to fail.
  try {
    out.addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  } catch (e) {
    try { out.addMetaTag('viewport', 'width=device-width, initial-scale=1'); } catch (e2) {}
  }

  return out.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Opens the dashboard inside the sheet, for when you're at a desktop. */
function showDashboard() {
  var html = HtmlService.createHtmlOutputFromFile('Dashboard').setWidth(900).setHeight(750);
  SpreadsheetApp.getUi().showModalDialog(html, 'Money');
}

/** Shows the address to open on your phone. */
function showAppLink() {
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}

  // Only trust a URL Google actually hands back for the LIVE deployment. A /dev
  // URL carries a different deployment id, so rewriting it into /exec builds an
  // address that has never existed, and Google answers "unable to open the file".
  var live = url && url.indexOf('/exec') !== -1;

  var msg = live
    ? 'Open this on your phone and add it to the home screen:\n\n' + url +
      '\n\nOnly your Google account can open it.'
    : 'No live web app yet.\n\n' +
      (url ? 'This project only has a test URL right now:\n' + url +
             '\nThat one will not work on your phone.\n\n' : '') +
      'In the Apps Script editor: Deploy, then New deployment, click the gear, pick ' +
      'Web app, set "Execute as: Me" and "Who has access: Only myself", then Deploy.\n\n' +
      'Afterwards copy the Web app URL from Deploy, then Manage deployments. That is ' +
      'the address to use — not one this box builds for you.';

  Logger.log(msg);
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert(live ? 'Your dashboard address' : 'Not deployed yet', msg, ui.ButtonSet.OK);
  } catch (e) {}
  return url;
}

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('sheetId');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_() { return ss_().getSheetByName(SHEET_NAME); }

/** Statements and payment confirmations, newest last. */
function events_() {
  var sh = ss_().getSheetByName(EVENTS_NAME), out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  var total = sh.getLastRow() - 1, take = Math.min(total, EVENTS_MAX);
  var asYmd = function (v) { return v instanceof Date ? ymd_(v) : String(v || ''); };
  var seen = {};
  sh.getRange(2 + total - take, 1, take, EVENT_HEADERS.length).getValues().forEach(function (r) {
    var d = r[1] instanceof Date ? r[1] : new Date(r[1]);
    if (!r[0] || seen[r[0]] || isNaN(d.getTime())) return;   // a row written twice counts once
    seen[r[0]] = true;
    out.push({
      id: String(r[0]), ts: d.getTime(), last4: ('000' + String(r[2]).trim()).slice(-4),
      type: String(r[3]), amt: Number(r[4]) || 0, min: r[5] === '' ? null : Number(r[5]),
      due: asYmd(r[6]), stmt: asYmd(r[7]), src: String(r[8]), issuer: String(r[9] || '')
    });
  });
  return out;
}

/** Called by the dashboard through google.script.run. Runs as you. */
function getData() {
  var props = PropertiesService.getScriptProperties();
  var sheet = sheet_();
  var tx = [];

  if (sheet && sheet.getLastRow() > 1) {
    var total = sheet.getLastRow() - 1;
    var take = Math.min(total, FEED_MAX_ROWS);
    var start = 2 + (total - take);
    var values = sheet.getRange(start, 1, take, HEADERS.length).getValues();
    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      var d = r[1] instanceof Date ? r[1] : new Date(r[1]);
      if (isNaN(d.getTime())) continue;
      tx.push({
        id: String(r[0]), ts: d.getTime(), day: d.getDate(),
        ym: Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM'),
        account: String(r[4]), kind: String(r[5]), desc: String(r[6]),
        cat: String(r[7]), amt: Number(r[8]), dir: String(r[9]),
        counted: String(r[10]) !== 'No'
      });
      // Re-derive from the raw text so rule fixes reach old rows without a migration.
      var ref = refine_(String(r[5]), String(r[6]), String(r[11]), String(r[9]));
      var last = tx[tx.length - 1];
      last.desc = ref.description; last.cat = ref.category; last.counted = ref.counted; last.raw = ref.raw;
    }
  }

  return {
    ok: true,
    updatedAt: Date.now(),
    lastRun: Number(props.getProperty('lastRun')) || null,
    settings: loadSettings_(),
    tx: tx,
    events: events_()
  };
}

/** Called by the dashboard to store your balance, stipend and manual entries. */
// ---------------------------------------------------------------------------
// Settings store: one row per key on a hidden "App data" tab. Script Properties
// cap each value at 9 KB, which goals + payments + manual entries would outgrow.
// ---------------------------------------------------------------------------
var STORE_NAME = 'App data';
var STORE_KEYS = {
  ob: 'num', obAt: 'num', hob: 'num', hobAt: 'num', inc: 'num', payDay: 'num', buffer: 'num', seeded: 'bool', migrated: 'str', joined: 'str',
  manual: 'arr', payments: 'arr', goals: 'arr', contribs: 'arr',
  overrides: 'obj', catRules: 'obj', payAssign: 'obj', cfg: 'obj'
};
var STORE_CAP = { manual: 1000, payments: 600, goals: 30, contribs: 1500 };

function store_() {
  var id = PropertiesService.getScriptProperties().getProperty('sheetId');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(STORE_NAME);
  if (!sh) {
    sh = ss.insertSheet(STORE_NAME);
    sh.getRange(1, 1, 1, 2).setValues([['key', 'json']]).setFontWeight('bold');
    sh.getRange('B:B').setNumberFormat('@');   // keep JSON as text
    sh.hideSheet();
  }
  return sh;
}

function loadSettings_() {
  var sh = store_(), out = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (!r[0]) return;
      try { out[String(r[0])] = JSON.parse(String(r[1])); } catch (e) {}
    });
  }
  if (!Object.keys(out).length) {      // first run after upgrading: bring the old settings across
    var legacy = PropertiesService.getScriptProperties().getProperty('settings');
    if (legacy) { try { out = JSON.parse(legacy); } catch (e) {} }
  }
  return out;
}

function saveSettings(s) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { writeAppData_(s); } finally { lock.releaseLock(); }
  return { ok: true };
}

/** Writes the settings object into the App data tab. Callers hold the script lock. */
function writeAppData_(s) {
  s = s || {};
  var rows = [];
  Object.keys(STORE_KEYS).forEach(function (k) {
    var t = STORE_KEYS[k], v = s[k];
    if (t === 'num') v = (typeof v === 'number' && isFinite(v)) ? v : null;
    else if (t === 'bool') v = v === true;
    else if (t === 'str') v = typeof v === 'string' ? v.slice(0, 40) : '';
    else if (t === 'arr') v = Array.isArray(v) ? v.slice(-(STORE_CAP[k] || 500)) : [];
    else v = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    var j = JSON.stringify(v);
    while (j.length > 49000 && t === 'arr' && v.length) { v = v.slice(Math.ceil(v.length / 4)); j = JSON.stringify(v); }
    if (j.length > 49000) j = t === 'arr' ? '[]' : '{}';   // a cell holds 50,000 characters
    rows.push([k, j]);
  });
  var sh = store_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  sh.getRange(2, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
}

/** Checks the data layer without a browser involved. */
function testFeed() {
  var d = getData();
  var st = d.events.filter(function (e) { return e.type === 'statement'; }).length;
  var msg = 'Sheet OK — ' + d.tx.length + ' transactions, ' + st + ' statements, ' +
            (d.events.length - st) + ' payment confirmations. Collector last ran ' +
            (d.lastRun ? new Date(d.lastRun) : 'never');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('Feed test', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
}
