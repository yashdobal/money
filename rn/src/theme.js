/* Colours: the Money app's own design tokens (app/app.css: "The look", light and dark, and the colour themes built
   from one seed colour with color-mix), worked out here so every screen uses exactly the same values.
   The look is bento: a warm off-white page (ground), grey trays (tray) that hold white cards (surface, with the soft
   two-layer shadow in `card`), near-black dark cards (heroA) and one accent, signal blue. "Minimal" swaps the blue for
   ink. "System" takes the seed from the phone's Material You colours (system_accent1 600 / 200). */
import React, { useContext } from "react";
import { systemPalettes } from "../modules/money-native/src";
import { WEB, systemSeeds as hostSeeds } from "./host";

export const PALETTES = [["signal", "Signal", "#2F5BFF"], ["minimal", "Minimal", "#141414"], ["indigo", "Indigo", "#4B44C8"], ["forest", "Forest", "#2E6B4E"],
  ["ocean", "Ocean", "#1F5F8B"], ["rose", "Rose", "#A23E62"], ["sand", "Sand", "#8A5A2B"], ["system", "System", ""]];
const SEEDS = { indigo: ["#4B44C8", "#A9A4FF"], forest: ["#2E6B4E", "#8CCFAE"], ocean: ["#1F5F8B", "#8EC3E8"], rose: ["#A23E62", "#EDA0BC"],
  sand: ["#8A5A2B", "#E0B98C"], system: ["#5B5BD6", "#B9B8FF"] };

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => "#" + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
/** color-mix(in srgb, a p, b): p of a, the rest b. */
export const mix = (a, p, b) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v * p + B[i] * (1 - p))); };
/** "#RRGGBB" with an alpha, as rgba(). */
export const rgba = (h, a) => { const [r, g, b] = rgb(h); return "rgba(" + r + "," + g + "," + b + "," + a + ")"; };

/** The phone's seed colours (Android 12+), or null. */
export function systemSeeds() {
  if (WEB) return hostSeeds();                         // as a website: the Android app that carries it passes them on
  const s = systemPalettes();
  return s && s.accent1 && s.accent1["600"] ? { light: s.accent1["600"], dark: s.accent1["200"] } : null;
}

/** Every token, for a colour choice and light/dark. */
export function tokens(palette, dark) {
  // Signal (app.css "The look"): the default
  const c = dark ? {
    ground: "#0A0A0C", tray: "#131316", surface: "#1C1C20", inset: "#232328", inset2: "#2E2E34", line: "#27272C", line2: "#38383E",
    ink: "#F2F2F0", ink2: "#A9A9A6", ink3: "#77777A",
    accent: "#7F97FF", accent2: "#A0B2FF", accentInk: "#0A1033", accentSoft: "#1B2246",
    pos: "#74C29A", posSoft: "#15231B", warn: "#D8B25E", warnSoft: "#2A2416", alert: "#EC8E80", alertSoft: "#2E1C19", info: "#A8B0B8", infoSoft: "#1E2226",
    nEmi: "#D0D0CC", nFamily: "#A6A6A2", nSip: "#82827E", nEf: "#62625E", nCard: "#454542", nYours: "#7F97FF",
    heroA: "#1B1B20", heroB: "#1B1B20", heroInk: "#F5F5F3", heroInk2: "rgba(245,245,243,0.62)", heroLine: "rgba(255,255,255,0.1)", heroTile: "rgba(255,255,255,0.07)",
    glass: "rgba(28,28,32,0.7)", glassStrong: "rgba(38,38,43,0.86)", glassRim: "rgba(255,255,255,0.22)", glassEdge: "rgba(0,0,0,0.5)", glassHi: "rgba(255,255,255,0.12)",
    shadow: "#000000", scrim: "rgba(10,12,24,0.42)",
    card: "0px 0px 0px 1px rgba(255,255,255,0.04), 0px 8px 18px -10px rgba(0,0,0,0.7)", face: "0px 1px 2px rgba(0,0,0,0.6), 0px 18px 36px -18px rgba(0,0,0,0.9)",
  } : {
    ground: "#F7F7F5", tray: "#EEEEEA", surface: "#FFFFFF", inset: "#F3F3F0", inset2: "#E3E3DE", line: "#ECECE8", line2: "#D9D9D4",
    ink: "#141416", ink2: "#5C5C59", ink3: "#8B8B87",
    accent: "#2F5BFF", accent2: "#1F47E0", accentInk: "#FFFFFF", accentSoft: "#EEF2FF",
    pos: "#2E7552", posSoft: "#E9F2EC", warn: "#8A6516", warnSoft: "#F6EFDF", alert: "#B3412F", alertSoft: "#F7E9E6", info: "#4E5A66", infoSoft: "#ECEEF0",
    nEmi: "#3A3A37", nFamily: "#686864", nSip: "#8E8E89", nEf: "#B4B4AE", nCard: "#D3D3CD", nYours: "#2F5BFF",
    heroA: "#0F0F12", heroB: "#0F0F12", heroInk: "#F5F5F3", heroInk2: "rgba(245,245,243,0.62)", heroLine: "rgba(255,255,255,0.12)", heroTile: "rgba(255,255,255,0.07)",
    glass: "rgba(255,255,255,0.7)", glassStrong: "rgba(255,255,255,0.84)", glassRim: "rgba(255,255,255,0.95)", glassEdge: "rgba(0,0,0,0.08)", glassHi: "rgba(255,255,255,0.75)",
    shadow: "#000000", scrim: "rgba(10,12,24,0.42)",
    card: "0px 1px 1px rgba(20,20,22,0.05), 0px 8px 18px -10px rgba(20,20,22,0.16)", face: "0px 1px 2px rgba(20,20,22,0.1), 0px 18px 36px -20px rgba(20,20,22,0.45)",
  };
  c.dark = dark; c.palette = "signal"; c.usedSystem = false;
  c.drop = dark ? rgba(mix(c.accent, 0.16, "#1A1A1A"), 0.9) : rgba(mix(c.accent, 0.1, "#FFFFFF"), 0.92);
  c.icTint = null;                                   // list icons grey on grey
  if (palette === "minimal") {
    // Minimal: the same greys, ink for the accent
    Object.assign(c, dark ? { accent: "#F2F2F0", accent2: "#FFFFFF", accentInk: "#121212", accentSoft: "#2A2A2E", nYours: "#F2F2F0" }
      : { accent: "#141414", accent2: "#000000", accentInk: "#FFFFFF", accentSoft: "#E9E9E5", nYours: "#141414" });
    c.palette = "minimal";
    c.drop = dark ? rgba(mix(c.accent, 0.14, "#1A1A1A"), 0.9) : rgba(mix(c.accent, 0.08, "#FFFFFF"), 0.92);
  } else if (palette && palette !== "signal" && SEEDS[palette]) {
    let [seed, seedDk] = SEEDS[palette];
    if (palette === "system") { const s = systemSeeds(); if (s) { seed = s.light; seedDk = s.dark; c.usedSystem = true; } }
    c.palette = palette;
    if (!dark) Object.assign(c, {
      accent: seed, accent2: mix(seed, 0.82, "#000000"), accentInk: "#FFFFFF", accentSoft: mix(seed, 0.12, "#FFFFFF"),
      ground: mix(seed, 0.04, "#F7F7F5"), tray: mix(seed, 0.08, "#EEEEEA"), surface: "#FFFFFF", inset: mix(seed, 0.06, "#F1F1EE"), inset2: mix(seed, 0.11, "#E6E6E2"),
      line: mix(seed, 0.09, "#E8E8E4"), line2: mix(seed, 0.14, "#D5D5D0"),
      heroA: mix(seed, 0.64, "#0A0A0A"), heroB: mix(seed, 0.42, "#0A0A0A"),
      nYours: seed, nEmi: mix(seed, 0.55, "#000000"), nFamily: mix(seed, 0.72, "#FFFFFF"), nSip: mix(seed, 0.5, "#FFFFFF"), nEf: mix(seed, 0.32, "#FFFFFF"), nCard: mix(seed, 0.18, "#C8C8C4"),
      drop: rgba(mix(seed, 0.12, "#FFFFFF"), 0.9),
    });
    else Object.assign(c, {
      accent: seedDk, accent2: mix(seedDk, 0.8, "#FFFFFF"), accentInk: "#121212", accentSoft: mix(seedDk, 0.18, "#161616"),
      ground: mix(seed, 0.08, "#0A0A0C"), tray: mix(seed, 0.09, "#131316"), surface: mix(seed, 0.08, "#1C1C20"), inset: mix(seed, 0.09, "#1D1D1D"), inset2: mix(seed, 0.12, "#262626"),
      line: mix(seed, 0.12, "#232323"), line2: mix(seed, 0.16, "#333333"),
      heroA: mix(seed, 0.46, "#0E0E0E"), heroB: mix(seed, 0.3, "#0E0E0E"),
      nYours: seedDk, nEmi: mix(seedDk, 0.92, "#FFFFFF"), nFamily: mix(seedDk, 0.72, "#000000"), nSip: mix(seedDk, 0.52, "#000000"), nEf: mix(seedDk, 0.36, "#000000"), nCard: mix(seedDk, 0.22, "#3A3A3A"),
      drop: rgba(mix(seedDk, 0.2, "#1A1A1A"), 0.9),
    });
    c.icTint = c.accent;
  }
  // the hero's chart and light: white on graphite (Minimal); in a colour theme, the accent's tint
  // the dock: a solid capsule a shade off the page (dark: lifted graphite; light: white)
  c.dock = dark ? mix(c.accent, 0.05, "#1E1F24") : "#FFFFFF";
  c.dockEdge = dark ? "rgba(255,255,255,0.07)" : "rgba(20,20,22,0.07)";
  c.heroChart = "#EDEDEB";
  c.heroGlow = c.palette === "minimal" ? "#FFFFFF" : mix(c.accent, 0.7, "#FFFFFF");
  return c;
}
/** The tokens inside a dark card (app.css .panel.d): the same names, turned over, so anything drawn on it just works. */
export function darkCard(C) {
  return { ...C, onDark: true, ink: "#F5F5F3", ink2: "rgba(245,245,243,0.7)", ink3: "rgba(245,245,243,0.5)", line: "rgba(255,255,255,0.12)", line2: "rgba(255,255,255,0.2)",
    surface: "rgba(255,255,255,0.07)", inset: "rgba(255,255,255,0.07)", inset2: "rgba(255,255,255,0.16)",
    accent: C.palette === "minimal" ? "#F2F2F0" : mix(C.dark ? C.accent : C.accent, 0.6, "#FFFFFF"), accentSoft: "rgba(143,166,255,0.16)",
    pos: "#7FD0A6", warn: "#E2BE6E", alert: "#FF9F92", card: undefined };
}

/** The swatch for a colour choice in Settings. */
export function swatch(choice, dark) {
  if (choice === "system") { const s = systemSeeds(); return s ? (dark ? s.dark : s.light) : null; }
  if (choice === "minimal") return dark ? "#F2F2F0" : "#141414";
  const s = PALETTES.find((p) => p[0] === choice);
  return s ? s[2] : "#888888";
}

export const ThemeCtx = React.createContext(tokens("signal", false));
export const useC = () => useContext(ThemeCtx);

/* Type: Inter, cut at the weights the screens use, with tabular and open digits and the single-storey a swapped in
   (rn/assets/fonts, made by tools/fonts_inter.py). TRACK: Inter wants a little negative tracking, more as it grows. */
export const F = {
  body: "Inter-Body", book: "Inter-Book", medium: "Inter-Medium", semi: "Inter-Semi", bold: "Inter-Bold",
  head: "Inter-Head", title: "Inter-Title", day: "Inter-Day", tile: "Inter-Tile", hero: "Inter-Hero", fig: "Inter-Fig",
};
export const track = (size) => -size * (size >= 40 ? 0.05 : size >= 24 ? 0.04 : size >= 17 ? 0.028 : 0.012);
export const FONT_FILES = {
  "Inter-Body": require("../assets/fonts/Inter-Body.ttf"), "Inter-Book": require("../assets/fonts/Inter-Book.ttf"),
  "Inter-Medium": require("../assets/fonts/Inter-Medium.ttf"), "Inter-Semi": require("../assets/fonts/Inter-Semi.ttf"),
  "Inter-Bold": require("../assets/fonts/Inter-Bold.ttf"), "Inter-Head": require("../assets/fonts/Inter-Head.ttf"),
  "Inter-Title": require("../assets/fonts/Inter-Title.ttf"), "Inter-Day": require("../assets/fonts/Inter-Day.ttf"),
  "Inter-Tile": require("../assets/fonts/Inter-Tile.ttf"), "Inter-Hero": require("../assets/fonts/Inter-Hero.ttf"),
  "Inter-Fig": require("../assets/fonts/Inter-Fig.ttf"),
};
