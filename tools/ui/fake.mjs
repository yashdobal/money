// Shared by the layout check and the click-through: serves dist/ at https://app.test with a fake Supabase over the
// demo data (tools/demo/demo-fixture.json). A table the data file doesn't have answers like a missing table.
import fs from "fs";
import path from "path";
import url from "url";

export const ROOT = process.env.MONEY_ROOT || path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
export const DIST = path.join(ROOT, "dist");
export const fixture = fs.readFileSync(process.env.MONEY_FIXTURE || path.join(ROOT, "tools/demo/demo-fixture.json"), "utf8");
export const TODAY = new Date((process.env.MONEY_TODAY || "2026-12-08T19:30") + ":00+05:30");
// the pre-installed Chromium, whichever version this machine has (CI uses Playwright's own)
const PW = "/opt/pw-browsers";
export const CHROMIUM = process.env.CHROMIUM || (fs.existsSync(PW) ? fs.readdirSync(PW).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
  .flatMap((d) => ["chrome-linux64", "chrome-linux"].map((sub) => path.join(PW, d, sub, "chrome"))).find((f) => fs.existsSync(f)) : undefined);

export const fakeSupabase = (fx, noSession) => `window.supabase = { createClient: () => { const F = ${fx}; window.__writes = [];
  const q = (t) => { let rows = (F[t] || []).slice(); const miss = !(t in F); const o = { select(){return o}, order(){return o}, eq(){return o}, in(){return o},
    range(a,b){ rows = rows.slice(a,b+1); return o }, limit(n){ rows = rows.slice(0,n); return o },
    upsert(row){ window.__writes.push({table:t, op:'upsert', row}); return Promise.resolve({data:null,error:null}) },
    delete(){ const d = { eq(k,v){ window.__writes.push({table:t, op:'delete', key:k, value:v}); return Promise.resolve({data:null,error:null}) } }; return d },
    then(r,j){ return Promise.resolve(miss ? {data:null, error:{code:'PGRST205', message:'Could not find the table'}} : {data: rows, error: null}).then(r,j) } }; return o; };
  return { from: q, auth: { getSession: async () => ({ data: { session: ${noSession ? "null" : "{user:{id:'u',email:'demo@example.com'},access_token:'T'}"} } }), onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}} }, signOut: async () => ({}),
    signInWithOtp: async () => ({}), verifyOtp: async () => ({}), signInWithPasskey: () => { window.__pk = (window.__pk || 0) + 1; return new Promise(() => {}); }, registerPasskey: async () => ({ data: {}, error: null }) } }; } };`;

/** Serve the built app and the fake Supabase in this browser context, and skip the one-time offers. */
export async function serve(ctx, fx, opts) {
  opts = opts || {};
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "app.test") {
      const f = DIST + (u.pathname === "/" ? "/index.html" : u.pathname);
      const type = f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : f.endsWith(".css") ? "text/css" : f.endsWith(".svg") ? "image/svg+xml" : f.endsWith(".woff2") ? "font/woff2" : f.endsWith(".png") ? "image/png" : undefined;
      return r.fulfill({ body: fs.existsSync(f) ? fs.readFileSync(f) : "", contentType: type });
    }
    if (u.hostname.includes("jsdelivr")) return r.fulfill({ body: fakeSupabase(fx || fixture, opts.noSession), contentType: "text/javascript" });
    if (u.hostname.endsWith("supabase.co")) return r.fulfill({ body: JSON.stringify({ ok: true, version: 4 }), contentType: "application/json" });
    return r.abort();
  });
  if (opts.offers !== true) await ctx.addInitScript(() => { try { ["money-passkey-later", "money-push-later", "money-pin-later"].forEach((k) => localStorage.setItem(k, "1")); localStorage.setItem("money-active", String(Date.now())); } catch (e) {} });
}

/** A stand-in for the Android app's AndroidBridge (android/…/Bridge.kt): records every call in window.__bridge.calls
    and answers the way the app does. Add with ctx.addInitScript(fakeBridge). */
export function fakeBridge() {
  const calls = []; window.__bridge = { calls };
  const lock = { available: true, enabled: false, after: 60, hideRecents: false, biometric: "fingerprint" };
  // the app's own copy of the sign-in, kept across reloads like the real app keeps it
  let store = {}; try { store = JSON.parse(sessionStorage.getItem("__bridgeStore") || "{}"); } catch (e) {}
  const keep = () => { try { sessionStorage.setItem("__bridgeStore", JSON.stringify(store)); } catch (e) {} };
  const fire = (d) => setTimeout(() => window.dispatchEvent(new CustomEvent("native", { detail: d })), 50);
  window.AndroidBridge = {
    version: () => "1.0 (test)",
    sessionGet: (k) => (k in store ? store[k] : null), sessionSet: (k, v) => { store[k] = v; keep(); }, sessionDel: (k) => { delete store[k]; keep(); },
    haptic: (k) => calls.push(["haptic", k]),
    setBars: (d) => calls.push(["setBars", d]),
    setBarColors: (a, b) => calls.push(["setBarColors", a, b]),
    systemColors: () => JSON.stringify({ light: "#3F6837", dark: "#A4D396", light2: "#54634D", dark2: "#BBCBB2" }),   // a green wallpaper
    lockInfo: () => JSON.stringify(lock),
    setLock: (on) => { calls.push(["setLock", on]); lock.enabled = on; fire({ type: "lock", ok: true, enabled: on }); },
    setLockAfter: (sec) => { lock.after = sec; calls.push(["setLockAfter", sec]); },
    setHideRecents: (on) => { lock.hideRecents = on; calls.push(["setHideRecents", on]); },
    openLockSettings: () => calls.push(["openLockSettings"]),
    notifInfo: () => JSON.stringify({ permission: "granted", enabled: true, muted: false }),
    testNotification: () => { calls.push(["testNotification"]); return "shown"; },
    openNotificationSettings: () => calls.push(["openNotificationSettings"]),
    openLinkSettings: () => calls.push(["openLinkSettings"]),
    linksVerified: () => "verified",
    openEmailApp: () => calls.push(["openEmailApp"]),
    shareFile: (name, text, mime) => calls.push(["shareFile", name, text.length, mime]),
    pushWidget: (json) => calls.push(["pushWidget", JSON.parse(json)]),
    signedOut: () => { calls.push(["signedOut"]); try { sessionStorage.setItem("__signedOut", "1"); } catch (e) {} },   // survives the reload
    hasDeviceKey: () => true,
    setDeviceKey: (t) => calls.push(["setDeviceKey", t]),
  };
}
