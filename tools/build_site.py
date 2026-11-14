"""Build the website into dist/: Money RN's own code, compiled for a browser.

The website and the phone app are one app (rn/). `expo export --platform web` compiles it; this script turns that
into the site that is served at yash-money.pages.dev and carried inside the older Android app:
  index.html            the page: rn/web/head.html in its <head>, the app's script, and the service worker's start
  js/, assets/          the app's code and its fonts (the script moves out of _expo/, a folder name Android's
                        packager would leave out of the APK)
  sw.js, manifest, icons, .well-known, _headers, status.html, version.json
  demo.js               only with --demo (the emulator check): made-up data and a fixed clock, never released
It also refreshes the generated engine (tools/rn_engine.mjs: the app's and the server's copies).

Usage: python3 tools/build_site.py [--out dist] [--demo] [--skip-export]
       --skip-export  reuse rn/dist-web from an earlier `npx expo export --platform web --output-dir dist-web`
"""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RN = ROOT / "rn"


def must(cond, msg):
    if not cond:
        raise SystemExit("build_site: " + msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "dist"))
    ap.add_argument("--no-classic", action="store_true", help=argparse.SUPPRESS)   # the old website is gone; kept so old commands still run
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--skip-export", action="store_true")
    a = ap.parse_args()
    out = pathlib.Path(a.out).resolve()

    subprocess.run(["node", "tools/rn_engine.mjs"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    exp = RN / "dist-web"
    if not a.skip_export:
        if exp.exists():
            shutil.rmtree(exp)
        env = dict(os.environ, CI="1")
        env.pop("EXPO_PUBLIC_MONEY_DEMO", None)          # the demo here is made-up data behind the real code path
        subprocess.run(["npx", "expo", "export", "--platform", "web", "--output-dir", "dist-web"], cwd=RN, check=True, env=env)
    must((exp / "index.html").exists(), "no rn/dist-web/index.html: the export didn't run")

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    # the app's code and assets
    js = sorted((exp / "_expo/static/js/web").glob("*.js"))
    must(len(js) == 1, "expected one script in the export, found %d" % len(js))
    (out / "js").mkdir()
    app_js = "js/app-" + hashlib.sha256(js[0].read_bytes()).hexdigest()[:12] + ".js"
    shutil.copy(js[0], out / app_js)
    if (exp / "assets").exists():
        shutil.copytree(exp / "assets", out / "assets")
    must("_expo/" not in js[0].read_text(encoding="utf-8", errors="ignore").replace("/_expo/static/js/web/", ""), "the script points into _expo/")

    # the page
    cfg = json.loads((ROOT / "app/public-config.json").read_text(encoding="utf-8"))
    conf = lambda k: os.environ.get(k) or cfg[k]
    head = (RN / "web/head.html").read_text(encoding="utf-8")
    demo = '    <script src="/demo.js"></script>\n' if a.demo else ""
    html = ("<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n" + head + "  </head>\n  <body>\n"
            "    <noscript>Money needs JavaScript.</noscript>\n    <div id=\"root\"><div id=\"boot\"></div></div>\n" + demo +
            "    <script src=\"/" + app_js + "\" defer></script>\n"
            "    <script>\n"
            "      // offline and installable: the service worker (inside the Android app the app serves the files itself)\n"
            "      if ('serviceWorker' in navigator && !window.AndroidBridge) addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });\n"
            "    </script>\n  </body>\n</html>\n")
    (out / "index.html").write_text(html, encoding="utf-8")

    for f in ["manifest.webmanifest", "_headers"]:
        shutil.copy(ROOT / "app" / f, out / f)
    man = json.loads((out / "manifest.webmanifest").read_text(encoding="utf-8"))
    man.update({"start_url": "/", "scope": "/", "background_color": "#F7F7F5", "theme_color": "#F7F7F5", "orientation": "any"})
    man["icons"] = [dict(i, src="/" + i["src"].lstrip("/")) for i in man["icons"]]
    (out / "manifest.webmanifest").write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")
    for d in ["icons", ".well-known"]:
        if (ROOT / "app" / d).exists():
            shutil.copytree(ROOT / "app" / d, out / d)
    status = (ROOT / "app/status.html").read_text(encoding="utf-8")
    must(status.count("%SUPABASE_PUBLISHABLE_KEY%") == 1, "status.html: the key's place moved")
    (out / "status.html").write_text(status.replace("%SUPABASE_PUBLISHABLE_KEY%", conf("SUPABASE_PUBLISHABLE_KEY")), encoding="utf-8")

    if a.demo:
        subprocess.run(["node", "tools/demo/android_demo.mjs", str(out)], cwd=ROOT, check=True)

    # the service worker keeps a copy of everything the app itself needs; its name changes whenever any file does
    files = sorted(p for p in out.rglob("*") if p.is_file())
    digest = hashlib.sha256(b"".join(p.read_bytes() for p in files)).hexdigest()[:10]
    shell = ["/"] + ["/" + p.relative_to(out).as_posix() for p in files
                     if p.suffix in (".js", ".ttf", ".png", ".svg", ".html", ".webmanifest") and p.name not in ("status.html", "demo.js")]
    sw = (RN / "web/sw.js").read_text(encoding="utf-8")
    must(sw.count("%SHELL%") == 1, "sw.js: no %SHELL%")
    (out / "sw.js").write_text(sw.replace("%BUILD%", digest).replace("%SHELL%", json.dumps(shell)), encoding="utf-8")
    (out / "version.json").write_text('{"build":"%s"}\n' % digest, encoding="utf-8")

    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print("built %s · build %s · %s · %.1f MB" % (out, digest, app_js, size / 1e6))


if __name__ == "__main__":
    main()
