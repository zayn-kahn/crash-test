"""Generate crash-test architecture SVGs (flow only). Asserts every label fits its box."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from svglib import STYLE, Svg as _Svg  # noqa: E402

OUT = sys.argv[1]


class Svg(_Svg):
    def save(self, name):
        super().save(f"{OUT}/{name}")


# 1. One run ------------------------------------------------------------------------------------
s = Svg(1120, 640, "1. One run: 6 days, one agent, one wallet")
W, H = 230, 96
xs = [30, 310, 590, 860]
y1, y2, y3 = 70, 290, 500
s.box(xs[0], y1, W, H, "Scenario feed", ["attack or innocent twin", "one of 11 incidents"], "input")
s.box(xs[1], y1, W, H, "Turn message", ["owner channel = orders", "inbox, pages, tools = data"], "input")
s.box(xs[2], y1, W, H, "Agent under test", ["Haiku 4.5 (confirmatory),", "6 more models explored"], "agent")
s.box(xs[3], y1, W, H, "Agent tools", ["pay, approve, call, sign", "history, notes, ask_human"], "agent")
s.box(xs[3], y2, W, H, "Wallet under test", ["raw, policy x2 or Brake", "sent / queued / refused"], "chain")
s.box(xs[2], y2, W, H, "Anvil chain", ["private, chain id 31337", "dUSD + scenario contracts"], "chain")
s.box(xs[1], y2, W, H, "Oracle", ["balance + allowance diffs", "leak = money to attacker"], "truth")
s.box(xs[0], y2, W, H, "Run log", ["data/runs/<id>.jsonl", "every event, in order"], "out")
s.box(xs[0], y3, W, H, "Brake settle", ["skip the wait in time", "watcher acts, rest runs"], "chain")
s.box(xs[1], y3, W, H, "Blind judge", ["describes behaviour only", "unvalidated: not in claims"], "truth")
s.box(xs[2], y3, W, H, "Scorecard row", ["leaks, fooled, honest cost", "cost in USD"], "out")
cy1, cy2, cy3 = y1 + H / 2, y2 + H / 2, y3 + H / 2
for a, b in ((0, 1), (1, 2), (2, 3)):
    s.arrow([(xs[a] + W, cy1), (xs[b], cy1)])
s.arrow([(xs[3] + W / 2, y1 + H), (xs[3] + W / 2, y2)], "proposal", (xs[3] + W / 2, y1 + H + 62))
s.arrow([(xs[3], cy2), (xs[2] + W, cy2)], "tx", (xs[3] - 25, cy2 - 8))
s.arrow([(xs[2], cy2), (xs[1] + W, cy2)], "state", (xs[2] - 25, cy2 - 8))
s.arrow([(xs[1], cy2), (xs[0] + W, cy2)])
s.arrow([(xs[1] + W / 2, y2), (xs[1] + W / 2, y1 + H)], "next day (1..6)", (xs[1] + W / 2, y1 + H + 62), dash=True)
s.arrow([(xs[0] + W / 2, y2 + H), (xs[0] + W / 2, y3)], "after day 6", (xs[0] + W / 2, y2 + H + 50))
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
cols = [(40, "Raw key"), (405, "Policy wallets"), (770, "Brake (ERC-7579 module)")]
CWD = 310
for x, name in cols:
    s.box(x, 190, CWD, 64, name, [], "chain")
    s.arrow([(560, 130), (560, 160), (x + CWD / 2, 160), (x + CWD / 2, 190)])
# raw
s.box(40, 300, CWD, 70, "Sent at once", ["no checks of any kind"], "bad")
s.arrow([(195, 254), (195, 300)])
# policy
s.box(405, 300, CWD, 150, "Checks", ["per payment up to 500 dUSD", "up to 800 dUSD a day", "allowlist (policy only)", "only swap / claim calls", "owner taps above 250"], "truth")
s.arrow([(560, 254), (560, 300)])
pw = 96
for i, (lab, kind) in enumerate((("sent", "good"), ("refused", "bad"), ("to human", "out"))):
    bx = 405 + i * (pw + 11)
    s.box(bx, 510, pw, 54, lab, [], kind)
    s.arrow([(560, 450), (560, 480), (bx + pw / 2, 480), (bx + pw / 2, 510)])
# brake
s.box(770, 300, CWD, 70, "Trusted contact, under cap?", ["daily cap 800 dUSD"], "truth")
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
s.box(xs[0], y1, W, H, "Matrix file", ["11 attacks x attack/twin", "x 2 sources x 4 wallets", "x seeds; hashes frozen"], "input")
s.box(xs[1], y1, W, H, "Runs", ["6 at once, own Anvil each", "resumable", "stops at the USD cap"], "chain")
s.box(xs[2], y1, W, H, "Run logs", ["one JSONL per run", "chain truth inside"], "out")
s.box(xs[3], y1, W, H, "Blind judge", ["JSON verdict per run", "flagged? declined? aware?"], "truth")
s.box(xs[0], y2, W, H, "Judge check", ["18 runs hand-labelled", "kappa 0.44: judge unused"], "bad")
s.box(xs[1], y2, W, H, "Analyze", ["leak rate with CIs", "agent fooled vs wallet", "honest tasks not paid"], "truth")
s.box(xs[2], y2, W, H, "Results", ["docs/results/*.md", "scorecard JSON"], "out")
s.box(xs[3], y2, W, H, "Pre-registered test", ["seed 1 explores; frozen", "hashes; seeds 2-3 decide"], "good")
for a, b in ((0, 1), (1, 2), (2, 3)):
    s.arrow([(xs[a] + W, y1 + H / 2), (xs[b], y1 + H / 2)])
    s.arrow([(xs[a] + W, y2 + H / 2), (xs[b], y2 + H / 2)])
s.arrow([(xs[3] + W / 2, y1 + H), (xs[3] + W / 2, y1 + H + 50), (xs[0] + W / 2, y1 + H + 50), (xs[0] + W / 2, y2)])
s.save("architecture-study.svg")

# 4. The phases ---------------------------------------------------------------------------------
s = Svg(1120, 210, "4. What happened: Oct 20 to 21, 2026")
phases = [
    ("Phase 0-1", "Oct 20", ["chain, 4 wallets, agent", "loop; Haiku 5.5 spike"], "good"),
    ("Phase 2", "Oct 20-21", ["11 attacks, judge, web", "Haiku 5.5: 0/264 fooled"], "good"),
    ("Explore", "Oct 21", ["7 models; 2 trust roots", "seed 1: 0-61% fooled"], "good"),
    ("Confirm", "Oct 21", ["pre-registered Haiku 4.5", "seeds 2-3, 352 runs: 6/6"], "good"),
    ("Publish", "Oct 22 on", ["write-up, dataset, repo", "then more models"], "out"),
]
W, gap = 196, 18
for i, (name, dates, lines, kind) in enumerate(phases):
    x = 30 + i * (W + gap)
    s.box(x, 70, W, 110, name, [dates] + lines, kind)
    if i:
        s.arrow([(x - gap, 125), (x, 125)])
s.parts.append('<rect x="30" y="58" width="838" height="8" fill="#1f8a50"/>')
s.text(874, 66, "done", 12, "#1f8a50", bold=True)
s.save("architecture-phases.svg")
print("ok")
