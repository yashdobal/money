/** Sends a web-push notification to every device you turned notifications on for. */
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

let ready = false;
function init() {
  if (ready) return;
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:noreply@yash-money.pages.dev",
    Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  ready = true;
}

export interface Note { title: string; body: string; url?: string; tag?: string }

export type SendOptions = { skipDeviceNames?: string[] };

export async function sendToAll(db: SupabaseClient, user: string, note: Note, opts: SendOptions = {}) {
  init();
  const { data: all, error } = await db.from("push_subscriptions").select("id,endpoint,p256dh,auth,failures,device_name").eq("user_id", user);
  if (error) throw new Error("subscriptions: " + error.message);
  const subs = (all ?? []).filter((s) => !(opts.skipDeviceNames ?? []).includes(s.device_name));
  let ok = 0;
  const errors: string[] = [];
  const payload = JSON.stringify({ title: note.title, body: note.body, url: note.url ?? "/#/today", tag: note.tag });
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: "normal" });
      ok++;
      await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), failures: 0 }).eq("id", s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      errors.push(code ? `HTTP ${code}` : String((e as Error).message || e).slice(0, 160));
      if (code === 404 || code === 410 || (s.failures ?? 0) >= 2) await db.from("push_subscriptions").delete().eq("id", s.id);   // gone
      else await db.from("push_subscriptions").update({ failures: (s.failures ?? 0) + 1 }).eq("id", s.id);
    }
  }
  return { devices: subs?.length ?? 0, delivered: ok, errors };
}

/** Send once: records the key first, so a retry or an overlapping run can't send it twice. */
export async function sendOnce(db: SupabaseClient, user: string, key: string, note: Note, opts: SendOptions = {}) {
  const { error } = await db.from("notifications_log").insert({ user_id: user, key, title: note.title, body: note.body });
  if (error) return { skipped: true };                         // unique (user_id, key): already sent
  const r = await sendToAll(db, user, note, opts);
  await db.from("notifications_log").update({ devices: r.delivered }).eq("user_id", user).eq("key", key);
  return r;
}
