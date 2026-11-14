/**
 * Device keys for the Android app's background work. The phone keeps the key; the server keeps only its SHA-256, in
 * the settings row "devices": {list: [{id, name, hash, created, seen}]}.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

type Device = { id: string; name: string; hash: string; created: string; seen: string | null };
const KEY = "devices", MAX = 5;

async function sha256(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function list(db: SupabaseClient, owner: string): Promise<Device[]> {
  const { data, error } = await db.from("settings").select("value").eq("user_id", owner).eq("key", KEY).maybeSingle();
  if (error) throw new Error("devices: " + error.message);
  return ((data?.value as { list?: Device[] })?.list ?? []).filter((d) => d && d.hash);
}
async function save(db: SupabaseClient, owner: string, devices: Device[]) {
  const { error } = await db.from("settings").upsert({ user_id: owner, key: KEY, value: { list: devices }, updated_at: new Date().toISOString() },
    { onConflict: "user_id,key" });
  if (error) throw new Error("devices: " + error.message);
}

/** A new key for a device. Keeps the newest few devices, so an old phone's key stops working eventually. */
export async function registerDevice(db: SupabaseClient, owner: string, name: string) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const dev: Device = { id: crypto.randomUUID(), name: String(name || "Android app").slice(0, 40), hash: await sha256(token), created: new Date().toISOString(), seen: null };
  const devices = (await list(db, owner)).concat(dev).slice(-MAX);
  await save(db, owner, devices);
  return { token, id: dev.id };
}

export async function findDevice(db: SupabaseClient, owner: string, token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const h = await sha256(token);
  return (await list(db, owner)).find((d) => d.hash === h) ?? null;
}

/** Notes when a device last asked (at most once an hour, so the row isn't rewritten on every call). */
export async function touchDevice(db: SupabaseClient, owner: string, id: string) {
  const devices = await list(db, owner), d = devices.find((x) => x.id === id);
  if (!d || (d.seen && Date.now() - Date.parse(d.seen) < 3600000)) return;
  d.seen = new Date().toISOString();
  await save(db, owner, devices);
}

export async function forgetDevice(db: SupabaseClient, owner: string, id: string) {
  await save(db, owner, (await list(db, owner)).filter((d) => d.id !== id));
}

/** The Android app has asked for alerts in the last two days: it shows them itself, so the phone's browser shouldn't
 *  get them too (opening the website in Chrome on the phone can sign its notifications up again). */
export async function appActive(db: SupabaseClient, owner: string) {
  const since = Date.now() - 48 * 3600000;
  return (await list(db, owner)).some((d) => Date.parse(d.seen ?? d.created) > since);
}
