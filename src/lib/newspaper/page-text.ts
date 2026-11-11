/**
 * Newspaper page text helpers (pure, browser-safe: no zod, no server imports).
 * Used by the reader to turn a PDF page into plain text before analysis.
 */

export const MIN_TEXT_LAYER_CHARS = 200;

export interface PdfTextItem {
  str: string;
  /** pdf.js transform: [a, b, c, d, x, y] */
  transform?: number[];
  hasEOL?: boolean;
}

/**
 * Join pdf.js text items in content-stream order. Publishing systems write
 * each article's text frame contiguously, so stream order keeps articles
 * together better than re-sorting by position on multi-column pages.
 * Breaks a line on explicit EOL or a vertical jump.
 */
export function assemblePageText(items: PdfTextItem[]): string {
  let out = "";
  let lastY: number | null = null;
  for (const it of items) {
    const y = it.transform?.[5];
    if (lastY !== null && typeof y === "number" && Math.abs(y - lastY) > 2 && !out.endsWith("\n")) {
      out += "\n";
    }
    out += it.str;
    if (it.hasEOL) out += "\n";
    else if (it.str && !it.str.endsWith(" ") && !it.str.endsWith("-")) out += " ";
    if (typeof y === "number") lastY = y;
  }
  return out
    .replace(/-\n(?=[a-z])/g, "") // re-join hyphenated line breaks
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when the extracted text is too thin to be a real text layer (scanned page). */
export function needsOcr(text: string): boolean {
  return text.replace(/\s+/g, "").length < MIN_TEXT_LAYER_CHARS;
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Best-effort edition date from an e-paper file name (YYYY-MM-DD, DD-MM-YYYY, DDMMYYYY). */
export function guessEditionDate(fileName: string): string | null {
  const f = fileName.replace(/\.[a-z0-9]+$/i, "");
  let m = f.match(/(20\d{2})[-_. ]?(\d{2})[-_. ]?(\d{2})(?!\d)/);
  if (m) {
    const r = iso(+m[1], +m[2], +m[3]);
    if (r) return r;
  }
  m = f.match(/(?<!\d)(\d{2})[-_. ]?(\d{2})[-_. ]?(20\d{2})/);
  if (m) {
    const r = iso(+m[3], +m[2], +m[1]);
    if (r) return r;
  }
  return null;
}

/** Local calendar date (not UTC) as YYYY-MM-DD. */
export function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
