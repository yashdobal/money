/**
 * A Date class that reads and writes local time as India Standard Time, whatever time zone the computer runs in.
 *
 * The app's engine (app/engine.js) works in the phone's local time: "today", a statement date, the 30th. The server
 * runs in UTC. India has one fixed offset (UTC+5:30, no daylight saving), so shifting by 330 minutes is exact.
 * tools/engine/ist.test.mjs checks that the engine gives identical figures on a UTC computer with this class as on a
 * computer set to Asia/Kolkata with the normal Date.
 *
 *   istDate(now?)   now: () => ms since 1970, to pretend it's another moment (tests); defaults to the real clock
 *   frozenDate(now) the normal Date with only the clock replaced (the reference side of that test)
 */
const OFF = 330 * 60000, TZ = "Asia/Kolkata";
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;   // no zone given = local time

export function istDate(now = () => Date.now()) {
  const R = Date;
  const local = (s) => {
    const m = typeof s === "string" ? LOCAL.exec(s.trim()) : null;
    if (!m) return null;
    return R.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), +String(m[7] || "0").padEnd(3, "0").slice(0, 3)) - OFF;
  };
  const shifted = (d) => new R(d.getTime() + OFF);        // read with getUTC* = IST wall clock
  class IST extends R {
    constructor(...a) {
      if (a.length === 0) super(now());
      else if (a.length === 1) {
        const v = a[0];
        if (v instanceof R) super(v.getTime());
        else if (typeof v === "string") { const t = local(v); super(t === null ? R.parse(v) : t); }
        else super(v);
      } else {
        const [y, mo, d = 1, h = 0, mi = 0, s = 0, ms = 0] = a;
        super(R.UTC(y, mo, d, h, mi, s, ms) - OFF);
      }
    }
    static now() { return now(); }
    static parse(s) { const t = local(s); return t === null ? R.parse(s) : t; }
    getFullYear() { return shifted(this).getUTCFullYear(); }
    getMonth() { return shifted(this).getUTCMonth(); }
    getDate() { return shifted(this).getUTCDate(); }
    getDay() { return shifted(this).getUTCDay(); }
    getHours() { return shifted(this).getUTCHours(); }
    getMinutes() { return shifted(this).getUTCMinutes(); }
    getSeconds() { return shifted(this).getUTCSeconds(); }
    getMilliseconds() { return shifted(this).getUTCMilliseconds(); }
    getTimezoneOffset() { return -330; }
    #set(fn) { const l = shifted(this); fn(l); return this.setTime(l.getTime() - OFF); }
    setFullYear(...a) { return this.#set((l) => l.setUTCFullYear(...a)); }
    setMonth(...a) { return this.#set((l) => l.setUTCMonth(...a)); }
    setDate(...a) { return this.#set((l) => l.setUTCDate(...a)); }
    setHours(...a) { return this.#set((l) => l.setUTCHours(...a)); }
    setMinutes(...a) { return this.#set((l) => l.setUTCMinutes(...a)); }
    setSeconds(...a) { return this.#set((l) => l.setUTCSeconds(...a)); }
    setMilliseconds(...a) { return this.#set((l) => l.setUTCMilliseconds(...a)); }
    toLocaleString(loc, o) { return R.prototype.toLocaleString.call(this, loc, { timeZone: TZ, ...o }); }
    toLocaleDateString(loc, o) { return R.prototype.toLocaleDateString.call(this, loc, { timeZone: TZ, ...o }); }
    toLocaleTimeString(loc, o) { return R.prototype.toLocaleTimeString.call(this, loc, { timeZone: TZ, ...o }); }
    toString() { return shifted(this).toISOString().replace("Z", "+05:30"); }
    toDateString() { return shifted(this).toUTCString().slice(0, 16); }
  }
  return IST;
}

export function frozenDate(now) {
  const R = Date;
  class Frozen extends R {
    constructor(...a) { if (a.length === 0) super(now()); else super(...a); }
    static now() { return now(); }
  }
  return Frozen;
}
