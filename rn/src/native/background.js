/* Background work: about every hour (Android decides the exact time), ask the server (supabase/functions/device) for
   the widget's numbers and any alerts, with this phone's device key. Also run when you tap ↻ on the widget. */
import { Platform } from "react-native";
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import { deviceCall, secure } from "../store";
import { fromServer, clearWidget, redraw } from "./widget";
import { showAlerts } from "./alerts";

export const TASK = "money-sync";

export async function syncNow() {
  try {
    const r = await deviceCall({});
    if (!r.key) { await redraw(); return "signed-out"; }
    if (r.status >= 200 && r.status < 300) {
      if ((await secure.get("deviceKey")) !== r.key) return "changed";       // signed out while this ran
      await fromServer(r.out.widget);
      await showAlerts(r.out.alerts);
      return "ok";
    }
    if (r.unknown) { await secure.set("deviceKey", null); await clearWidget(); return "unknown"; }
    return "failed";
  } catch (e) { return "failed"; }
}

if (Platform.OS === "android") {
  TaskManager.defineTask(TASK, async () => {
    const r = await syncNow();
    return r === "failed" ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
  });
}

export async function schedule() {
  if (Platform.OS !== "android") return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(TASK)) return;
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 60 });
  } catch (e) {}
}
