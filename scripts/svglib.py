"""Shared SVG helpers for the crash-test diagrams (flow only). Every label is checked against its box."""
from xml.sax.saxutils import escape

FONT = "Helvetica, Arial, sans-serif"
CW = 0.58  # approx char width as a fraction of font size (sans, conservative)

STYLE = {
    "input": ("#e7f0ff", "#3b6fd8"),
    "agent": ("#f1e8ff", "#7a4fd1"),
    "chain": ("#e6f6ea", "#2f8a4c"),
    "truth": ("#fff4e0", "#c98a1b"),
    "out": ("#f2f2f2", "#666666"),
    "bad": ("#fde7e7", "#c43c3c"),
    "good": ("#e3f7ec", "#1f8a50"),
    "quiet": ("#fafafa", "#cccccc"),
}


class Svg:
    def __init__(self, w, h, title):
        self.w, self.h = w, h
        self.parts = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{FONT}">',
            '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            '<path d="M0,0 L10,5 L0,10 z" fill="#444"/></marker></defs>',
            f'<rect x="0" y="0" width="{w}" height="{h}" fill="#ffffff"/>',
            f'<text x="24" y="34" font-size="20" font-weight="bold" fill="#222">{escape(title)}</text>',
        ]

    def fit(self, text, size, width, bold=False):
        need = len(text) * size * CW * (1.08 if bold else 1.0)
        assert need <= width - 16, f"label too wide ({need:.0f} > {width - 16}): {text!r}"

    def box(self, x, y, w, h, title, lines=(), kind="out", size=15, line_size=12.5, gap=17):
        fill, stroke = STYLE[kind]
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')
        n = 1 + len(lines)
        total = size + 5 + gap * (n - 1)
        ty = y + (h - total) / 2 + size
        assert total <= h - 8, f"box too short for {title!r}"
        self.fit(title, size, w, bold=True)
        self.parts.append(f'<text x="{x + w / 2}" y="{ty}" font-size="{size}" font-weight="bold" fill="#111" text-anchor="middle">{escape(title)}</text>')
        for i, line in enumerate(lines):
            self.fit(line, line_size, w)
            self.parts.append(f'<text x="{x + w / 2}" y="{ty + gap + 3 + gap * i}" font-size="{line_size}" fill="#333" text-anchor="middle">{escape(line)}</text>')

    def arrow(self, pts, label=None, at=None, dash=False):
        d = "M" + " L".join(f"{px},{py}" for px, py in pts)
        extra = ' stroke-dasharray="6,5"' if dash else ""
        self.parts.append(f'<path d="{d}" fill="none" stroke="#444" stroke-width="2"{extra} marker-end="url(#a)"/>')
        if label:
            lx, ly = at
            wpx = len(label) * 12 * CW + 10
            self.parts.append(f'<rect x="{lx - wpx / 2}" y="{ly - 13}" width="{wpx}" height="18" fill="#ffffff"/>')
            self.parts.append(f'<text x="{lx}" y="{ly}" font-size="12" fill="#444" text-anchor="middle" font-style="italic">{escape(label)}</text>')

    def text(self, x, y, s, size=13, color="#555", anchor="start", bold=False):
        b = ' font-weight="bold"' if bold else ""
        self.parts.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" text-anchor="{anchor}"{b}>{escape(s)}</text>')

    def save(self, path):
        with open(path, "w") as f:
            f.write("\n".join(self.parts + ["</svg>"]) + "\n")
