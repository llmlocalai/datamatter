#!/usr/bin/env python3
"""Generate the site's icon set from one geometric construction.

    python3 scripts/make_icons.py

Writes app/icon.svg, app/favicon.ico, app/apple-icon.png and
app/opengraph-image.png. Next.js picks all four up from app/ by filename and
emits the <link> and <meta> tags itself; nothing in layout.tsx names them.

Why the mark is drawn rather than set
-------------------------------------
The nav shows 'dm' in a gold tile. A favicon is drawn by the browser chrome and
cannot use a webfont, and this site declares Inter but ships no font file, so
type set here would render differently on every machine and would never match
the icon. The letterforms below are therefore constructed as paths on a 64-unit
grid, and components/Nav.tsx inlines the same paths — the header and the tab
icon are one mark, not two things that resemble each other.

Two cuts, one construction
--------------------------
DISPLAY is the nav cut. SMALL is for the 16px slot, where the display cut's
counters fall below one device pixel and 'dm' reads as a single blob. The small
cut opens the counters and widens the tracking rather than simply thickening,
because at 16px it is the white space inside a letter that carries its identity.
Five candidates were rendered at 16px and compared before this one was chosen.

Strokes overlap rather than abut. Two butt caps meeting at a point leave an
antialiasing seam, invisible at 16px and obvious at the 512px the home-screen
icon is rendered from.
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")

GOLD_HI, GOLD_LO, INK = "#e8b54a", "#c08a10", "#0a1929"   # accent-400/600, navy-950
GROUND, CARD, RULE = (0x0A, 0x19, 0x29), (0x10, 0x2A, 0x43), (0x24, 0x3B, 0x53)
WHITE, BODY, DIM = (0xFF, 0xFF, 0xFF), (0xC4, 0xD4, 0xE6), (0x48, 0x65, 0x81)
GOLD = (0xE8, 0xB5, 0x4A)

K = 0.5523          # the cubic constant that makes a control polygon circular


def _n(v: float) -> str:
    return f"{v:.3f}".rstrip("0").rstrip(".")


def mark(w, dx_bowl, dx_dstem, m_stems, r_bowl, radius=13,
         baseline=46.5, asc=15.0, bowl_cy=36.0) -> str:
    """One cut of the mark, as a standalone SVG document.

    w is the stroke weight; everything else is a position on the 64-unit grid.
    The m's shoulders are circular arches whose apex is taken from the bowl, so
    the two letters share one *optical* x-height — a round letter has to
    overshoot a flat one to look level with it.
    """
    x1, x2, x3 = m_stems
    half = (x2 - x1) / 2
    apex = bowl_cy - r_bowl                  # centreline apex of the shoulders
    spring = apex + half                     # where the stem stops curving up

    def arch(a: float) -> str:
        """Stem up from the baseline, a circular arch over, stem back down.

        Each arch redraws the stem it springs from, so consecutive strokes
        always overlap and no join is ever left to antialiasing.
        """
        b = a + 2 * half
        return (f"M{_n(a)},{_n(baseline)} V{_n(spring)} "
                f"C{_n(a)},{_n(spring - K * half)} "
                f"{_n(a + half - K * half)},{_n(apex)} {_n(a + half)},{_n(apex)} "
                f"C{_n(a + half + K * half)},{_n(apex)} "
                f"{_n(b)},{_n(spring - K * half)} {_n(b)},{_n(spring)} "
                f"V{_n(baseline)}")

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="datamatter">
  <defs>
    <linearGradient id="dm-g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{GOLD_HI}"/>
      <stop offset="1" stop-color="{GOLD_LO}"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="{_n(radius)}" fill="url(#dm-g)"/>
  <g fill="none" stroke="{INK}" stroke-width="{_n(w)}" stroke-linecap="butt" stroke-linejoin="round">
    <circle cx="{_n(dx_bowl)}" cy="{_n(bowl_cy)}" r="{_n(r_bowl)}"/>
    <path d="M{_n(dx_dstem)},{_n(asc)} V{_n(baseline)}"/>
    <path d="{arch(x1)}"/>
    <path d="{arch(x2)}"/>
  </g>
</svg>'''


# The nav cut. 7-unit margins; bowl and m of equal optical weight.
# components/Nav.tsx inlines these exact paths — change one, change both.
DISPLAY = dict(w=5.5, dx_bowl=17.5, dx_dstem=25.0, m_stems=(35.0, 44.5, 54.0),
               r_bowl=7.6, radius=13)

# The 16px cut. Larger on the tile, wider m, rounder bowl.
SMALL = dict(w=6.0, dx_bowl=15.5, dx_dstem=24.0, m_stems=(34.5, 45.0, 55.5),
             r_bowl=8.5, radius=11, asc=13.0, baseline=47.5)


# ------------------------------------------------------------- rasterising ---
# Rendered through whichever SVG rasteriser the machine has. librsvg (either
# directly or behind sharp) is the one to prefer: ImageMagick without a
# delegate falls back to its own SVG renderer, which does not draw the
# gradient or the round joins correctly.
_SHARP = """
const [mod, svg, png, size] = process.argv.slice(1);
const sharp = require(mod);
sharp(svg, { density: 1200 })
  .resize(Number(size), Number(size))
  .png({ compressionLevel: 9 })
  .toFile(png)
  .catch((e) => { console.error(e.message); process.exit(1); });
"""


def _sharp_module() -> str | None:
    """sharp, if it is installed anywhere node can reach it. It wraps librsvg."""
    if not shutil.which("node"):
        return None
    r = subprocess.run(["node", "-e", "process.stdout.write(require.resolve('sharp'))"],
                       capture_output=True, text=True, cwd=ROOT)
    if r.returncode == 0 and r.stdout.strip():
        return r.stdout.strip()
    for base in (os.path.expanduser("~/.npm-global/lib/node_modules"),
                 "/usr/local/lib/node_modules", "/usr/lib/node_modules"):
        p = os.path.join(base, "sharp", "lib", "index.js")
        if os.path.exists(p):
            return p
    return None


def _rasterise(svg_path: str, png_path: str, size: int) -> None:
    sharp = _sharp_module()
    if sharp:
        subprocess.run(["node", "-e", _SHARP, "--", sharp, svg_path, png_path, str(size)],
                       check=True)
        return
    if shutil.which("rsvg-convert"):
        subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size),
                        "-o", png_path, svg_path], check=True)
        return
    try:
        import cairosvg
        cairosvg.svg2png(url=svg_path, write_to=png_path,
                         output_width=size, output_height=size)
        return
    except ImportError:
        pass
    if shutil.which("magick") or shutil.which("convert"):
        exe = shutil.which("magick") or shutil.which("convert")
        subprocess.run([exe, "-background", "none", "-density", "1200",
                        svg_path, "-resize", f"{size}x{size}", png_path], check=True)
        return
    sys.exit("No SVG rasteriser found. Any one of these will do: `npm i -g sharp`, "
             "librsvg (`brew install librsvg` for rsvg-convert), or "
             "`pip install cairosvg`. Then run this again.")


def _opengraph(mark_png: str, out: str) -> None:
    """The link-preview card.

    Rendered here rather than per request with @vercel/og: the site is
    statically prerendered and its identity does not vary by page, so a flat
    PNG costs nothing at request time and cannot fail in production.
    """
    from PIL import Image, ImageDraw, ImageFont
    faces = [
        ("/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyreheros-bold.otf",
         "/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyreheros-regular.otf"),
        ("/System/Library/Fonts/HelveticaNeue.ttc",
         "/System/Library/Fonts/HelveticaNeue.ttc"),
        ("/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf",
         "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf"),
    ]
    bold, reg = next((b, r) for b, r in faces if os.path.exists(b) and os.path.exists(r))
    f = lambda path, sz: ImageFont.truetype(path, sz)

    im = Image.new("RGB", (1200, 630), GROUND)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 430, 1200, 630], fill=CARD)          # the site's card surface
    d.line([(0, 430), (1200, 430)], fill=RULE, width=2)

    tile = Image.open(mark_png).convert("RGBA").resize((132, 132), Image.LANCZOS)
    im.paste(tile, (88, 118), tile)

    d.text((248, 116), "datamatter", font=f(bold, 84), fill=WHITE)
    d.text((250, 214), "Department of War budget analytics", font=f(reg, 34), fill=BODY)
    d.text((88, 316), "Budget formulation, execution and audit, over the USAspending",
           font=f(reg, 31), fill=BODY)
    d.text((88, 360), "account and award warehouse.", font=f(reg, 31), fill=BODY)
    d.text((88, 486), "Every figure names its source and vintage.", font=f(bold, 36), fill=GOLD)
    d.text((88, 542), "datamatter.vercel.app", font=f(reg, 27), fill=DIM)
    im.save(out)


def main() -> None:
    from PIL import Image
    tmp = os.path.join(ROOT, ".icon-build")
    os.makedirs(tmp, exist_ok=True)

    small_svg = os.path.join(tmp, "small.svg")
    display_svg = os.path.join(tmp, "display.svg")
    open(small_svg, "w").write(mark(**SMALL))
    open(display_svg, "w").write(mark(**DISPLAY))

    # The tab icon is never drawn above 32 CSS px, so it carries the small cut.
    shutil.copy(small_svg, os.path.join(APP, "icon.svg"))

    # favicon.ico carries 16, 32 and 48. Each is rasterised from the vector at
    # its own size rather than downsampled from one big render, because the
    # 16px entry is the one that has to survive a crowded tab strip and a
    # Lanczos reduction of the 48 is measurably softer than drawing it small.
    pngs = []
    for s in (16, 32, 48):
        p = os.path.join(tmp, f"ico-{s}.png")
        _rasterise(small_svg, p, s)
        pngs.append(p)
    ico = os.path.join(APP, "favicon.ico")
    exe = shutil.which("magick") or shutil.which("convert")
    if exe:
        subprocess.run([exe, *pngs, ico], check=True)
    else:
        # Pillow's ICO writer downsamples from the base image and ignores
        # append_images, so this path gives up the per-size renders.
        Image.open(pngs[-1]).convert("RGBA").save(
            ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])

    # The home-screen icon is drawn at 180 and up, where the display cut belongs.
    _rasterise(display_svg, os.path.join(APP, "apple-icon.png"), 180)

    big = os.path.join(tmp, "display-512.png")
    _rasterise(display_svg, big, 512)
    _opengraph(big, os.path.join(APP, "opengraph-image.png"))

    shutil.rmtree(tmp)
    for f in ("icon.svg", "favicon.ico", "apple-icon.png", "opengraph-image.png"):
        p = os.path.join(APP, f)
        print(f"  app/{f:<22} {os.path.getsize(p):>7,} bytes")


if __name__ == "__main__":
    main()
