// Money RN: the app, its home-screen widget and its background work (alerts, widget numbers).
import { Platform } from "react-native";
import { registerRootComponent } from "expo";
import App from "./src/App";
import "./src/native/background";

registerRootComponent(App);

// the web preview: no browser focus ring on fields (the app draws its own)
if (Platform.OS === "web" && typeof document !== "undefined") {
  const st = document.createElement("style");
  st.textContent = "input,textarea{outline:none!important}";
  document.head.appendChild(st);
}

if (Platform.OS === "android") {
  const { registerWidgetTaskHandler } = require("react-native-android-widget");
  registerWidgetTaskHandler(require("./src/native/widget").widgetTaskHandler);
}
