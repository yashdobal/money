"""Builds tools/demo/demo-fixture.json: realistic, made-up data in exactly the shape the app reads from Supabase.

Nothing here is real. "Today" for the demo is 8 Dec 2026 (the screenshot tests freeze the clock there), which puts:
  - the first full salary (30 Nov) in, with the split rule on: money to family, SIP, emergency fund
  - Harbour Miles's 10 Nov bill overdue (due 1 Dec, unpaid), Lotus Shopper's 15 Nov bill paid, Lotus Orbit's 30 Nov
    bill due 18 Dec (Orbit is two cards, a Visa and a RuPay, on one bill)
  - a card EMI (a phone) on future statements and a bank-paid EMI (washing machine, 1 Dec / 1 Jan / 1 Feb)
The banks, cards and employer are invented too; they're set in the saved settings' profile, as yours would be.
  - a US-dollar charge, card and UPI refunds, long UPI payee names, money sent to people and a friend paying back
Usage: python3 tools/demo/make_demo.py  (writes tools/demo/demo-fixture.json)
"""
import json, random, datetime as dt, pathlib

R = random.Random(20261208)
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
OUT = pathlib.Path(__file__).with_name("demo-fixture.json")

ACC = {
    "bank":  {"kind": "bank", "aliases": ["Kestrel Bank Savings XX4417"]},
    "o1111": {"kind": "card", "aliases": ["Lotus Credit Card XX1111", "orbit"]},
    "o2222": {"kind": "card", "aliases": ["Lotus Credit Card XX2222"]},
    "shop":  {"kind": "card", "aliases": ["Lotus Credit Card XX3333", "shopper"]},
    "miles": {"kind": "card", "aliases": ["Harbour Card XX4444", "miles"]},
}
PROFILE = {
    "banks": [{"key": "kestrel", "name": "Kestrel", "full": "Kestrel Bank", "match": "Kestrel"},
              {"key": "heron", "name": "Heron", "full": "Heron Bank", "match": "Heron Bank"}],
    "groups": {
        "orbit":   {"short": "Lotus Orbit", "sub": "Visa + RuPay (·1111, ·2222) — one card account", "issuer": "Lotus", "stmtDay": 30, "dueAfter": 18, "net": "VISA · RUPAY"},
        "shopper": {"short": "Lotus Shopper ·3333", "issuer": "Lotus", "stmtDay": 15, "dueAfter": 18, "net": "VISA"},
        "miles":   {"short": "Harbour Miles add-on ·4444", "issuer": "Harbour", "stmtDay": 10, "dueAfter": 21, "net": "VISA", "catalog": "sbi-miles"},
    },
    "cards": {
        "Lotus Credit Card XX1111": {"group": "orbit", "last4": "1111", "short": "Visa ·1111"},
        "Lotus Credit Card XX2222": {"group": "orbit", "last4": "2222", "short": "RuPay ·2222"},
        "Lotus Credit Card XX3333": {"group": "shopper", "last4": "3333", "short": "·3333"},
        "Harbour Card XX4444":      {"group": "miles", "last4": "4444", "short": "·4444"},
    },
    "payText": [{"re": "harbour", "groups": ["miles"]}, {"re": "shopper", "groups": ["shopper"]}, {"re": "lotus", "issuer": "Lotus"}],
    "salaryText": "NIMBUS",
    "family": "your parents",
}
tx, emails, pays = [], [], []
row = [1]


def at(d, hh=12, mm=0):
    y, m, day = map(int, d.split("-"))
    return dt.datetime(y, m, day, hh, mm, tzinfo=IST).astimezone(dt.timezone.utc).isoformat().replace("+00:00", ".000000+00:00")


def t(d, acct, amt, desc, cat, direction="out", hh=None, mm=None, counted=None, ref=None):
    row[0] += 1
    hh = R.randint(8, 22) if hh is None else hh
    mm = R.randint(0, 59) if mm is None else mm
    tx.append({"source_ref": ref or "demo-%04d" % row[0], "occurred_at": at(d, hh, mm), "amount": round(amt * 100),
               "direction": direction, "description": desc, "counted": direction == "out" if counted is None else counted,
               "snippet": desc, "sheet_row": row[0], "deleted_at": None, "accounts": ACC[acct], "categories": {"name": cat}})


def email(kind, last4, issuer, received, amt, minimum=None, due=None, stmt=None, sender=None, hh=9, mm=15):
    emails.append({"message_id": "demo-mail-%d" % (len(emails) + 1), "received_at": at(received, hh, mm), "kind": kind,
                   "amount": round(amt * 100), "minimum_due": round(minimum * 100) if minimum else None, "due_date": due,
                   "statement_date": stmt, "sender": sender or issuer, "sheet_row": len(emails) + 2, "deleted_at": None,
                   "accounts": {"last4": last4, "issuer": issuer}})


def days(a, b):
    d0, d1 = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    return [(d0 + dt.timedelta(n)).isoformat() for n in range((d1 - d0).days + 1)]


# ---------- everyday life, Jun → 8 Dec ----------
FOOD = ["Swiggy", "Zomato", "Blue Tokai Coffee Roasters", "Theobroma Patisserie", "Chaayos Chai Cafe"]
GROC = ["Zepto", "Blinkit", "Amazon Pay In Grocery", "Shree Ganesh General Stores And Dairy Products Main Road"]
SHOP = ["Amazon Pay In E Commerce", "Myntra Designs Private Limited", "Decathlon Sports India", "Croma Infiniti Retail Limited"]
PEOPLE = ["Ramesh Kumar Yadav", "Sandeep Ukha Dhivar", "Mohammed Irfan Abdul Rashid Shaikh", "Ravi Shankar", "Pooja Ganesh Naik"]
TRAVEL = ["Uber India Systems Pvt Ltd", "Ola Cabs", "City Metro Rail Corporation", "Indian Railway Catering And Tourism Corporation"]
for d in days("2026-06-01", "2026-12-08"):
    n = R.choice([0, 1, 1, 2, 2, 3])
    for _ in range(n):
        kind = R.choices(["food", "groc", "shop", "people", "travel"], [5, 4, 2, 3, 3])[0]
        if kind == "food":   t(d, R.choice(["o2222", "bank", "shop"]), R.choice([180, 249, 315, 420, 560, 99]), R.choice(FOOD), "Food & dining")
        if kind == "groc":   t(d, R.choice(["shop", "bank"]), R.choice([212, 348, 486, 730, 1120]), R.choice(GROC), "Groceries")
        if kind == "shop" and R.random() < .5: t(d, R.choice(["shop", "o2222"]), R.choice([599, 1299, 2499, 3899]), R.choice(SHOP), "Shopping")
        if kind == "people": t(d, "bank", R.choice([20, 60, 120, 250, 500]), R.choice(PEOPLE), "Transfers to people")
        if kind == "travel": t(d, R.choice(["bank", "o2222"]), R.choice([65, 140, 260, 480]), R.choice(TRAVEL), "Travel")

# ---------- money in ----------
t("2026-10-30", "bank", 41260, "NEFT CR NIMBUS SOFTWARE PVT LTD SALARY OCT 2026", "Money in", "in", 10, 5)
t("2026-11-30", "bank", 98600, "NEFT CR NIMBUS SOFTWARE PVT LTD SALARY NOV 2026", "Money in", "in", 9, 40)
t("2026-11-22", "bank", 1250, "Rohan Verma", "Money in", "in", 21, 10, ref="demo-payback-rohan")      # a friend paying back
t("2026-10-08", "bank", 412.50, "Kailash Parbat Refund UPI Reversal", "Refunds", "in", 17, 46)
# ---------- the first full salary's transfers (1 Dec) ----------
t("2026-12-01", "bank", 19720, "Asha Sharma", "Transfers to people", hh=9, mm=5)                   # family share
t("2026-12-01", "bank", 14000, "Vijay Sales Washing Machine EMI", "Transfers to people", hh=11, mm=20)      # bank-paid EMI 1 of 3
t("2026-12-02", "bank", 12000, "Groww Mutual Fund SIP", "Investments", hh=7, mm=30)
# ---------- cards: bills, payments, EMIs, refunds, a dollar charge ----------
t("2026-11-04", "o2222", 1339, "Netflix.com (USD 15.49 at Rs 86.45)", "Bills & subscriptions", hh=3, mm=12)
t("2026-12-03", "shop", 2148, "AMAZON WEB SERVICES (USD 24.85 at Rs 86.44)", "Bills & subscriptions", hh=5, mm=41, ref="demo-aws")
t("2026-11-26", "shop", 1499, "Myntra Refund", "Refunds", "in", 15, 2)
t("2026-10-12", "o2222", 9450, "Phone 9,450 converted to EMI", "Money in", "in", 12, 0)
t("2026-10-12", "o2222", 3271.35, "Phone EMI 1 of 3 (3,103.20 + 142.50 interest + 25.65 GST)", "Shopping", hh=12, mm=1)
t("2026-11-12", "o2222", 3262.34, "Phone EMI 2 of 3 (3,150.00 + 95.20 interest + 17.14 GST)", "Shopping", hh=12, mm=0)
t("2026-12-12", "o2222", 3253.32, "Phone EMI 3 of 3 (3,196.80 + 47.90 interest + 8.62 GST) - scheduled", "Shopping", hh=12, mm=0, ref="manual-20261212-phone-emi-3")
t("2026-11-18", "o2222", 6780, "Sunrise Multispeciality Hospital And Research Centre", "Health", hh=13, mm=30, ref="demo-hospital")   # paid for someone else (a note says so)
# Lotus Orbit (statement 30th, due +18), Lotus Shopper (15th, +18), Harbour Miles (10th, +21)
email("statement", "2222", "Lotus", "2026-10-31", 22140, 1110, "2026-11-17", "2026-10-30")
t("2026-11-16", "bank", 22140, "CRED Club", "Cash & transfers", hh=19, mm=12); email("payment", "2222", "Lotus", "2026-11-17", 22140, sender="CRED", hh=8, mm=2)   # confirmed only by CRED the next day: left for you to match
email("statement", "2222", "Lotus", "2026-12-01", 2630, 130, "2026-12-18", "2026-11-30")              # due soon
email("statement", "3333", "Lotus", "2026-10-16", 7420, 370, "2026-11-02", "2026-10-15")
t("2026-11-01", "bank", 7420, "CRED Club", "Cash & transfers", hh=20, mm=4); email("payment", "3333", "Lotus", "2026-11-01", 7420, sender="CRED", hh=20, mm=9)
email("statement", "3333", "Lotus", "2026-11-16", 9870, 500, "2026-12-03", "2026-11-15")
t("2026-12-02", "bank", 9870, "CRED Club", "Cash & transfers", hh=18, mm=55); email("payment", "3333", "Lotus", "2026-12-02", 9870, sender="CRED", hh=19, mm=1)   # paid
email("statement", "4444", "Harbour", "2026-10-11", 6900, 345, "2026-10-31", "2026-10-10")
t("2026-10-30", "bank", 6900, "CRED Club", "Cash & transfers", hh=21, mm=2); email("payment", "4444", "Harbour", "2026-10-30", 6900, sender="CRED", hh=21, mm=7)
email("statement", "4444", "Harbour", "2026-11-11", 18450, 925, "2026-12-01", "2026-11-10")              # overdue: no payment
for d, amt, desc in [("2026-11-14", 8650, "Bharat Petroleum Corporation Ltd Highway Service Station"), ("2026-11-29", 3420, "Sri Venkateshwara Enterprises Private Limited")]:
    t(d, "miles", amt, desc, "Shopping")

state = {
    "version": 3, "savedAt": "2026-12-01T09:00:00.000Z",
    "data": {
        "ob": 42000, "obAt": int(dt.datetime(2026, 11, 1, 0, 1, tzinfo=IST).timestamp() * 1000), "inc": 98600, "payDay": 0, "payDayV": 1,
        "buffer": 2000, "joined": "2026-10-16", "seeded": True, "migrated": "v4", "manual": [
            {"id": "m-demo-1", "d": 6, "t": "Chai and samosa at the office canteen with the whole team", "amt": 180, "c": "Food & dining", "ym": "2026-12"}],
        "payAssign": {}, "payments": [],
        "goals": [{"id": "g-laptop", "name": "Laptop", "start": 15000, "target": 120000, "prio": 1, "date": "2027-06-30"},
                  {"id": "g-washer", "name": "Washing machine", "start": 0, "target": 42000, "prio": 2, "date": "2027-02-01"},
                  {"id": "g-ef", "name": "Emergency fund", "start": 0, "target": 600000, "prio": 1, "date": "2028-12-31"}],
        "contribs": [{"id": "c-1", "goal": "g-laptop", "amt": 8000, "date": "2026-11-05"}, {"id": "c-2", "goal": "g-ef", "amt": 11391, "date": "2026-12-01"}],
        "overrides": {"paidback|demo-payback-rohan": True},
        "catRules": {"kailash parbat refund upi reversal": "Refunds"},
        "cfg": {"offer": {"gross": 101800, "basic": 50000, "pf": 0.06, "pt": 200, "firstPayday": "2026-10-31", "stipend": 20000, "allow": 300, "pfCap": 0, "pfCapFrom": "2026-12-01", "v": 2},
                "rule": {"from": "2026-11-25", "savings": 0.25, "ef": 0.10, "family": 0.20, "efCapX": 6, "billsFrom": "2026-11-25"},
                "planned": [{"name": "Washing machine EMI 1 of 3", "amt": 14000, "due": "2026-12-01", "from": "savings", "goal": "Washing machine"},
                            {"name": "Washing machine EMI 2 of 3", "amt": 14000, "due": "2027-01-01", "from": "savings", "goal": "Washing machine"},
                            {"name": "Washing machine EMI 3 of 3", "amt": 14000, "due": "2027-02-01", "from": "savings", "goal": "Washing machine"}]},
        "profile": PROFILE,
    },
}
fixture = {
    "transactions": sorted(tx, key=lambda r: r["occurred_at"]),
    "card_emails": emails, "card_payments": [], "card_statements": [], "salary_cycles": [], "goals": [], "goal_contributions": [], "rules": [],
    "settings": [{"key": "app.state", "value": state}],
    "ingest_log": [{"received_at": at("2026-12-08", 18, 49)}],
    # your own edits (Phase B tables): a payee rule, a payment made for someone else, a friend paying back, a note
    "payee_rules": [{"pattern": "kailash parbat refund upi reversal", "category": "Refunds"},
                    {"pattern": "amazon pay in grocery", "category": "Groceries"}],
    "txn_notes": [{"txn_ref": "demo-hospital", "category": None, "for_someone_else": True, "paid_back": False, "note": "Neha's hospital bill, she'll send it back"},
                  {"txn_ref": "demo-payback-rohan", "category": None, "for_someone_else": False, "paid_back": True, "note": ""},
                  {"txn_ref": "demo-aws", "category": None, "for_someone_else": False, "paid_back": False, "note": "Side project server"}],
}
OUT.write_text(json.dumps(fixture, indent=0))
print(f"wrote {OUT} · {len(tx)} transactions, {len(emails)} card emails")
