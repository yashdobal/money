/* Money RN · the graphics engine, web preview version: the browser preview doesn't load Skia, so these are empty and
   the screens fall back to the SVG versions of the same effects (index.native.js has the real ones). */
export const GL = false;
export const HeroField = () => null;
export const CoinRain = () => null;
export const BurstLayer = () => null;
export const CardLight = () => null;
export function burst() {}
export function heroTouchGL() {}
export function heroLeaveGL() {}
