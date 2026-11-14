/* Which screen is showing, as values the graphics thread can read: screens stay mounted when you leave them (so
   coming back is instant), and their running effects (the hero's light, the salary streams) pause while hidden. */
import { makeMutable } from "react-native-reanimated";
import { setAliveView } from "./alive";
export const live = { today: makeMutable(1), plan: makeMutable(0), cards: makeMutable(0), spend: makeMutable(0), activity: makeMutable(0), trips: makeMutable(0), rewards: makeMutable(0), settings: makeMutable(0) };
export function setLive(view, appActive = true) {
  setAliveView(view);                                // the always-moving parts of the other screens rest too (alive.js)
  Object.keys(live).forEach((k) => { const on = appActive && k === view ? 1 : 0; if (live[k].value !== on) live[k].value = on; });
}
