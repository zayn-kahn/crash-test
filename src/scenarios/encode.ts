/** Ways an attack hides its instruction: Morse (the Grok/Bankrbot reply), Base64, zero-width characters. */
export type Scheme = "morse" | "base64" | "zero-width";

const MORSE: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---",
  K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-",
  U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....",
  "7": "--...", "8": "---..", "9": "----.",
};

export function encode(scheme: Scheme, plain: string): string {
  if (scheme === "morse")
    return plain
      .toUpperCase()
      .split(" ")
      .map((word) => [...word].map((c) => MORSE[c] ?? "").filter(Boolean).join(" "))
      .join(" / ");
  if (scheme === "base64") return Buffer.from(plain, "utf8").toString("base64");
  // zero-width: each bit of each byte as U+200B (0) / U+200C (1), between two visible words
  const bits = [...Buffer.from(plain, "utf8")].map((b) => b.toString(2).padStart(8, "0")).join("");
  return `ok${[...bits].map((b) => (b === "0" ? "\u200b" : "\u200c")).join("")}thanks`;
}

/** Morse back to text (tests use it to prove the encoded line carries the instruction). */
export function decodeMorse(code: string): string {
  const back = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
  return code
    .split(" / ")
    .map((w) => w.split(" ").map((s) => back[s] ?? "?").join(""))
    .join(" ");
}
