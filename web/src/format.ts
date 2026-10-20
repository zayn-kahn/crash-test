/** Small helpers for the viewer: escaping, a tiny Markdown renderer, amounts, labels, Morse. */

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Enough Markdown for the scenario READMEs: headings, paragraphs, **bold**, `code`. Input is escaped first. */
export function md(text: string): string {
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>");
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const h = block.match(/^(#{1,3})\s+(.*)$/);
      if (h) return `<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`;
      return `<p>${inline(block.replace(/\n/g, " "))}</p>`;
    })
    .join("");
}

/** dUSD base units (6 decimals, as a decimal string or number) -> "1,250.5". */
export function dusd(units: string | number | bigint, signed = false): string {
  const n = Number(BigInt(String(units))) / 1e6;
  const s = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (!signed) return n < 0 ? `-${s}` : s;
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : "0";
}

export const short = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function modelLabel(model?: string): string {
  if (!model) return "?";
  if (model === "dry-run") return "Scripted test agent";
  if (model === "gullible") return "Scripted gullible agent";
  const m = model.match(/^claude-(\w+)-(\d+)-(\d+)$/);
  return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model;
}

export function walletLabel(wallet?: string, watcher?: string | null): string {
  if (wallet === "raw") return "Raw key";
  if (wallet === "brake") return watcher === "cancel-unknown" ? "Brake + watcher" : "Brake, no watcher";
  if (wallet === "policy") return "Policy wallet";
  if (wallet === "policy-caps") return "Policy, caps only";
  return wallet ?? "?";
}

export const roleLabel = (role?: string) => (role === "attack" ? "Attack" : role === "twin" ? "Harmless twin" : (role ?? "?"));

export function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

const MORSE: Record<string, string> = {
  ".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E", "..-.": "F", "--.": "G", "....": "H", "..": "I",
  ".---": "J", "-.-": "K", ".-..": "L", "--": "M", "-.": "N", "---": "O", ".--.": "P", "--.-": "Q", ".-.": "R",
  "...": "S", "-": "T", "..-": "U", "...-": "V", ".--": "W", "-..-": "X", "-.--": "Y", "--..": "Z",
  "-----": "0", ".----": "1", "..---": "2", "...--": "3", "....-": "4", ".....": "5", "-....": "6",
  "--...": "7", "---..": "8", "----.": "9",
};

/** If the text carries a long run of Morse code, its decoding (for the human reader only). */
export function morseIn(text: string): string | null {
  const m = text.match(/(?:[.-]{1,6}(?: \/ | |$)){8,}/);
  if (!m) return null;
  return m[0]
    .trim()
    .split(" / ")
    .map((w) => w.split(" ").map((c) => MORSE[c] ?? "?").join(""))
    .join(" ");
}
