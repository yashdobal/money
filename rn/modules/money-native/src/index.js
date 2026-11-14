// Money RN's own Android bits (modules/money-native): Material You colours, the Quick Settings tile, bank SMS.
// Everything is a no-op (null) on older phones and in the web preview.
import { Platform } from "react-native";

let mod = null;
if (Platform.OS === "android") {
  try { mod = require("expo").requireOptionalNativeModule("MoneyNative"); } catch (e) { mod = null; }
}
const call = (name, ...a) => { try { return mod && mod[name] ? mod[name](...a) : null; } catch (e) { return null; } };

export const systemPalettes = () => call("systemPalettes");
export const setTile = (label, sub) => call("setTile", label, sub);
export const canReadSms = () => !!call("canReadSms");
export const readSms = (since, limit) => call("readSms", since, limit);
