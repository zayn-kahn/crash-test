"""Generate crash-test architecture SVGs (flow only). Asserts every label fits its box."""
import sys
from xml.sax.saxutils import escape

OUT = sys.argv[1]
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

    def box(self, x, y, w, h, title, lines=(), kind="out"):
        fill, stroke = STYLE[kind]
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')
        n = 1 + len(lines)
        total = 20 + 17 * (n - 1)
        ty = y + (h - total) / 2 + 15
        assert total <= h - 8, f"box too short for {title!r}"
        self.fit(title, 15, w, bold=True)
        self.parts.append(f'<text x="{x + w / 2}" y="{ty}" font-size="15" font-weight="bold" fill="#111" text-anchor="middle">{escape(title)}</text>')
        for i, line in enumerate(lines):
            self.fit(line, 12.5, w)
            self.parts.append(f'<text x="{x + w / 2}" y="{ty + 20 + 17 * i}" font-size="12.5" fill="#333" text-anchor="middle">{escape(line)}</text>')

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

    def save(self, name):
        with open(f"{OUT}/{name}", "w") as f:
            f.write("\n".join(self.parts + ["</svg>"]) + "\n")


# 1. One run ------------------------------------------------------------------------------------
s = Svg(1120, 640, "1. One run: 6 turns, one agent, one wallet")
W, H = 230, 96
xs = [30, 310, 590, 860]
y1, y2, y3 = 70, 290, 500
s.box(xs[0], y1, W, H, "Scenario feed", ["attack or innocent twin", "one of 6 incidents"], "input")
s.box(xs[1], y1, W, H, "Turn message", ["owner channel = orders", "inbox, pages, tools = data"], "input")
s.box(xs[2], y1, W, H, "Agent under test", ["Claude Haiku 5.5 / Sonnet 5.5", "fresh session each turn"], "agent")
s.box(xs[3], y1, W, H, "Agent tools", ["pay, approve, call, sign", "remember, ask_human, end_turn"], "agent")
s.box(xs[3], y2, W, H, "Wallet under test", ["raw, policy or Brake", "sent / queued / refused"], "chain")
s.box(xs[2], y2, W, H, "Anvil chain", ["private, chain id 31337", "dUSD + scenario contracts"], "chain")
s.box(xs[1], y2, W, H, "Oracle", ["balance + allowance diffs", "leak = money to attacker"], "truth")
s.box(xs[0], y2, W, H, "Run log", ["data/runs/<id>.jsonl", "every event, in order"], "out")
s.box(xs[0], y3, W, H, "Brake settle", ["skip the wait in time", "watcher acts, rest runs"], "chain")
s.box(xs[1], y3, W, H, "Blind judge", ["reads feed + agent record", "never told attack or twin"], "truth")
s.box(xs[2], y3, W, H, "Scorecard row", ["leaks, false refusals", "cost in USD"], "out")
cy1, cy2, cy3 = y1 + H / 2, y2 + H / 2, y3 + H / 2
for a, b in ((0, 1), (1, 2), (2, 3)):
    s.arrow([(xs[a] + W, cy1), (xs[b], cy1)])
s.arrow([(xs[3] + W / 2, y1 + H), (xs[3] + W / 2, y2)], "proposal", (xs[3] + W / 2, y1 + H + 62))
s.arrow([(xs[3], cy2), (xs[2] + W, cy2)], "tx", (xs[3] - 25, cy2 - 8))
s.arrow([(xs[2], cy2), (xs[1] + W, cy2)], "state", (xs[2] - 25, cy2 - 8))
s.arrow([(xs[1], cy2), (xs[0] + W, cy2)])
s.arrow([(xs[1] + W / 2, y2), (xs[1] + W / 2, y1 + H)], "next turn (1..6)", (xs[1] + W / 2, y1 + H + 62), dash=True)
s.arrow([(xs[0] + W / 2, y2 + H), (xs[0] + W / 2, y3)], "after turn 6", (xs[0] + W / 2, y2 + H + 50))
s.arrow([(xs[0] + W, cy3), (xs[1], cy3)])
s.arrow([(xs[1] + W, cy3), (xs[2], cy3)])
s.text(xs[3], y3 + 20, "Colours", 13, "#222", bold=True)
for i, (k, name) in enumerate((("input", "what the agent reads"), ("agent", "the model and its tools"), ("chain", "wallet and chain"), ("truth", "how we score"), ("out", "what we keep"))):
    fill, stroke = STYLE[k]
    s.parts.append(f'<rect x="{xs[3]}" y="{y3 + 30 + 18 * i}" width="14" height="12" fill="{fill}" stroke="{stroke}"/>')
    s.text(xs[3] + 22, y3 + 41 + 18 * i, name, 12)
s.save("architecture-run.svg")

# 2. The three wallets --------------------------------------------------------------------------
s = Svg(1120, 720, "2. What each wallet does with the agent's proposal")
s.box(385, 60, 350, 70, "Agent's proposal", ["pay, approve or contract call"], "agent")
cols = [(40, "Raw key"), (405, "Policy wallet"), (770, "Brake (ERC-7579 module)")]
CWD = 310
for x, name in cols:
    s.box(x, 190, CWD, 64, name, [], "chain")
    s.arrow([(560, 130), (560, 160), (x + CWD / 2, 160), (x + CWD / 2, 190)])
# raw
s.box(40, 300, CWD, 70, "Sent at once", ["no checks of any kind"], "bad")
s.arrow([(195, 254), (195, 300)])
# policy
s.box(405, 300, CWD, 150, "Checks", ["per payment up to 500 dUSD", "up to 800 dUSD a day", "only trusted contacts", "swap/claim on contacts only", "ask a human above 250"], "truth")
s.arrow([(560, 254), (560, 300)])
pw = 96
for i, (lab, kind) in enumerate((("sent", "good"), ("refused", "bad"), ("to human", "out"))):
    bx = 405 + i * (pw + 11)
    s.box(bx, 510, pw, 54, lab, [], kind)
    s.arrow([(560, 450), (560, 480), (bx + pw / 2, 480), (bx + pw / 2, 510)])
# brake
s.box(770, 300, CWD, 70, "Trusted contact, under cap?", ["daily cap 300 dUSD"], "truth")
s.arrow([(925, 254), (925, 300)])
s.box(770, 420, 120, 54, "sent now", [], "good")
s.arrow([(830, 370), (830, 420)], "yes", (830, 399))
s.box(930, 420, 150, 70, "queued 1 hour", ["owner or watcher", "can cancel"], "chain")
s.arrow([(1005, 370), (1005, 420)], "no", (1005, 399))
s.box(930, 530, 150, 70, "Watcher", ["none or", "cancel-unknown"], "truth")
s.arrow([(1005, 490), (1005, 530)])
s.box(770, 630, 150, 54, "cancelled", ["= stopped"], "good")
s.box(940, 630, 160, 54, "executed", ["= leak, delayed"], "bad")
s.arrow([(1005, 600), (1005, 615), (845, 615), (845, 630)])
s.arrow([(1020, 600), (1020, 630)])
s.save("architecture-wallets.svg")

# 3. The study ----------------------------------------------------------------------------------
s = Svg(1120, 420, "3. From many runs to one published result")
W, H = 230, 100
xs = [30, 310, 590, 860]
y1, y2 = 70, 270
s.box(xs[0], y1, W, H, "Matrix file", ["6 scenarios x attack/twin", "x 3 wallets x 5 seeds", "x models x conditions"], "input")
s.box(xs[1], y1, W, H, "Runs", ["4 at once, own Anvil each", "resumable", "stops at the USD cap"], "chain")
s.box(xs[2], y1, W, H, "Run logs", ["one JSONL per run", "chain truth inside"], "out")
s.box(xs[3], y1, W, H, "Blind judge", ["JSON verdict per run", "flagged? declined? warned?"], "truth")
s.box(xs[0], y2, W, H, "Judge check", ["seeded 10% hand-labelled", "agreement (kappa) >= 0.7"], "truth")
s.box(xs[1], y2, W, H, "Analyze", ["leak rate with CIs", "agent fooled vs wallet", "refused vs blocked"], "truth")
s.box(xs[2], y2, W, H, "Results", ["docs/results/*.md", "scorecard JSON"], "out")
s.box(xs[3], y2, W, H, "Publish if earned", ["dataset, write-up", "public copy of the folder"], "good")
for a, b in ((0, 1), (1, 2), (2, 3)):
    s.arrow([(xs[a] + W, y1 + H / 2), (xs[b], y1 + H / 2)])
    s.arrow([(xs[a] + W, y2 + H / 2), (xs[b], y2 + H / 2)])
s.arrow([(xs[3] + W / 2, y1 + H), (xs[3] + W / 2, y1 + H + 50), (xs[0] + W / 2, y1 + H + 50), (xs[0] + W / 2, y2)])
s.save("architecture-study.svg")

# 4. The phases ---------------------------------------------------------------------------------
s = Svg(1120, 210, "4. The plan: Oct 20 to Nov 10")
phases = [
    ("Phase 0", "Oct 20", ["setup, Claude backend", "Brake 90 tests"], "good"),
    ("Phase 1", "Oct 20", ["chain + 3 wallets", "grok spike: 21 runs"], "good"),
    ("Phase 2", "from Oct 20", ["5 more scenarios", "judge, 180-run matrix"], "out"),
    ("Phase 3", "Nov 1-7", ["Sonnet + rules prompt", "pre-registered matrix"], "out"),
    ("Phase 4", "Nov 8-10", ["write-up, dataset", "outreach, grants"], "out"),
]
W, gap = 196, 18
for i, (name, dates, lines, kind) in enumerate(phases):
    x = 30 + i * (W + gap)
    s.box(x, 70, W, 110, name, [dates] + lines, kind)
    if i:
        s.arrow([(x - gap, 125), (x, 125)])
s.parts.append('<rect x="30" y="58" width="410" height="8" fill="#1f8a50"/>')
s.text(446, 66, "done", 12, "#1f8a50", bold=True)
s.save("architecture-phases.svg")
print("ok")
