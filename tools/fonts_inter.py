"""Money's type: Inter (rsms.me/inter, SIL Open Font License), cut down to what the app shows.

  app/fonts/inter.woff2        the website's font: one variable file (weight and optical size), Latin, the rupee sign
                               and the few symbols the screens use. The stylesheet turns on tabular digits (tnum),
                               open digits (ss01) and the single-storey a (cv11).
  rn/assets/fonts/Inter-*.ttf  Money RN's fonts: Android can't pick a weight from a variable font or switch font
                               features reliably, so each weight the screens use is its own file, with tnum, ss01
                               and cv11 already swapped in.

The source isn't kept in the repository. To make the fonts again:
  npm pack inter-ui@4.1.1 && tar -xzf inter-ui-4.1.1.tgz
  python3 tools/fonts_inter.py package/variable/InterVariable.woff2
"""
import pathlib, sys, io
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path("package/variable/InterVariable.woff2")

# what the screens show: Latin-1, general punctuation, the rupee and euro, arrows, minus, ticks and triangles
UNI = (list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + [0x131, 0x152, 0x153, 0x2C6, 0x2DA, 0x2DC] + list(range(0x2000, 0x2070)) +
       [0x20AC, 0x20B9, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x2215, 0x2022, 0x232B, 0x24D8, 0x25B2, 0x25BC, 0x2713])
KEEP = ["kern", "calt", "ccmp", "locl", "mark", "mkmk", "tnum", "ss01", "cv11", "case"]

# Money RN's cuts: name -> (weight, optical size). The names say where each is used (rn/src/theme.js).
CUTS = {
    "Inter-Body": (420, 14),     # body text
    "Inter-Book": (470, 14),     # small print with a little weight
    "Inter-Medium": (540, 14),   # row titles, labels, buttons
    "Inter-Semi": (610, 14),     # amounts, sub-heads
    "Inter-Bold": (680, 14),     # totals, the chosen tab
    "Inter-Head": (640, 20),     # panel and sheet titles
    "Inter-Title": (660, 24),    # the screen title, the sign-in heading
    "Inter-Day": (640, 14),      # day headings
    "Inter-Tile": (620, 20),     # tile figures
    "Inter-Hero": (600, 32),     # the Safe to spend figure, Spending's total
    "Inter-Fig": (580, 32),      # big figures: bank balance, card due, planner result
}


def cut(font, keep_features):
    o = subset.Options()
    o.layout_features = keep_features
    o.name_IDs = [1, 2, 3, 4, 6, 16, 17]
    o.notdef_outline = True
    o.glyph_names = False
    o.hinting = False
    s = subset.Subsetter(o)
    s.populate(unicodes=UNI)
    s.subset(font)
    return font


def bake(font, tags):
    """Make some features' one-for-one swaps the font's default: every character points at the swapped glyph.
    The swaps run in the font's own lookup order (tabular first, then the alternates of the tabular digits)."""
    gsub = font["GSUB"].table
    idx = sorted({i for f in gsub.FeatureList.FeatureRecord if f.FeatureTag in tags for i in f.Feature.LookupListIndex})
    maps = []
    for i in idx:
        m = {}
        for st in gsub.LookupList.Lookup[i].SubTable:
            if hasattr(st, "ExtSubTable"): st = st.ExtSubTable
            if hasattr(st, "mapping"): m.update(st.mapping)
        maps.append(m)
    for t in font["cmap"].tables:
        for code, g in list(t.cmap.items()):
            for m in maps: g = m.get(g, g)
            t.cmap[code] = g


def load():
    f = TTFont(SRC); f.flavor = None
    b = io.BytesIO(); f.save(b); b.seek(0)
    return TTFont(b)


# the website: one variable file
web = cut(load(), KEEP)
web.flavor = "woff2"
web.save(ROOT / "app/fonts/inter.woff2")
print("app/fonts/inter.woff2", (ROOT / "app/fonts/inter.woff2").stat().st_size)

# Money RN: fixed cuts with the features baked in
OUT = ROOT / "rn/assets/fonts"
OUT.mkdir(parents=True, exist_ok=True)
for name, (w, o) in CUTS.items():
    f = instantiateVariableFont(load(), {"wght": w, "opsz": o}, updateFontNames=False)
    bake(f, ["ss01", "cv11", "tnum"])
    cut(f, ["kern", "calt", "ccmp", "locl", "mark", "mkmk", "case"])
    for rec in f["name"].names:
        if rec.nameID in (1, 4, 6, 16): rec.string = name
        if rec.nameID in (2, 17): rec.string = "Regular"
    f["OS/2"].usWeightClass = 400
    f.save(OUT / (name + ".ttf"))
    print(name, (OUT / (name + ".ttf")).stat().st_size)
(OUT / "OFL.txt").write_text((ROOT / "app/fonts/OFL.txt").read_text())
