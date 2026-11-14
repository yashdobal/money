/* The demo build (EXPO_PUBLIC_MONEY_DEMO=1, for the emulator check on GitHub; never released): a stand-in for Supabase
   over made-up data (the same demo-fixture.json the website's tests use), already signed in. */
export function demoClient() {
  const F = require("./demo-fixture.json");
  const q = (t) => {
    let rows = (F[t] || []).slice();
    const miss = !(t in F);
    const o = {
      select: () => o, order: () => o, eq: () => o, in: () => o,
      range: (a, b) => { rows = rows.slice(a, b + 1); return o; },
      limit: (n) => { rows = rows.slice(0, n); return o; },
      upsert: () => Promise.resolve({ data: null, error: null }),
      delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      then: (r, j) => Promise.resolve(miss ? { data: null, error: { code: "PGRST205", message: "Could not find the table" } } : { data: rows, error: null }).then(r, j),
    };
    return o;
  };
  const session = { user: { id: "demo", email: "demo@example.com" }, access_token: "demo" };
  return {
    from: q,
    auth: {
      getSession: async () => ({ data: { session } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}), signInWithOtp: async () => ({}), verifyOtp: async () => ({}), startAutoRefresh() {}, stopAutoRefresh() {},
    },
  };
}
