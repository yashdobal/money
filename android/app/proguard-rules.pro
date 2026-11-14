# The web page calls these by name through window.AndroidBridge.
-keepattributes JavascriptInterface
-keepclassmembers class com.yashdobal.money.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
