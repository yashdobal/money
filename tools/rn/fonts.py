"""Money RN's fonts: the web app's Anek (app/fonts, a variable font) cut into the fixed weight × width pairs the
web app's stylesheet uses, with the rupee sign merged in (the web app loads it as a second file by unicode-range).
Android can't pick a width from a variable font, so each pair is its own file. Usage: python3 tools/rn/fonts.py"""
import pathlib, tempfile
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.merge import Merger

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "rn/assets/fonts"
# name: (weight, width%) — matching app/app.css
CUTS = {
    "Anek-Body": (420, 100),     # body text, row titles (540 → Medium)
    "Anek-Book": (460, 100),     # small print with a little weight
    "Anek-Medium": (540, 100),   # row titles, labels, buttons
    "Anek-Semi": (600, 100),     # amounts, sub-heads
    "Anek-Bold": (660, 100),     # totals, chosen tab
    "Anek-Head": (580, 112),     # panel and sheet titles (h2)
    "Anek-Title": (620, 115),    # the screen title, sign-in heading
    "Anek-Day": (620, 106),      # day headings
    "Anek-Tile": (560, 110),     # tile figures
    "Anek-Hero": (300, 122),     # the Safe to spend figure, Spending's total
    "Anek-Fig": (360, 120),      # big figures: bank balance, card due, planner result
}
OUT.mkdir(parents=True, exist_ok=True)
for name, (w, d) in CUTS.items():
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for src in ["anek-latin.woff2", "anek-rupee.woff2"]:
            f = TTFont(ROOT / "app/fonts" / src)
            inst = instantiateVariableFont(f, {"wght": w, "wdth": d}, updateFontNames=False)
            inst.flavor = None
            p = pathlib.Path(tmp) / (src + ".ttf"); inst.save(p); parts.append(str(p))
        m = Merger().merge(parts)
        for rec in m["name"].names:
            if rec.nameID in (1, 4, 6, 16): rec.string = name
            if rec.nameID in (2, 17): rec.string = "Regular"
        m["OS/2"].usWeightClass = 400
        m.save(OUT / (name + ".ttf"))
    print(name, (OUT / (name + ".ttf")).stat().st_size)
(OUT / "OFL.txt").write_text((ROOT / "app/fonts/OFL.txt").read_text())
