/**
 * JSON repair utility.
 * Local models (Ollama, etc.) frequently produce malformed JSON.
 * This module attempts progressive repair before giving up.
 */

/** Result of a JSON repair attempt. */
interface RepairResult {
  success: boolean;
  data: unknown;
  repairApplied: string | null;
  rawInput: string;
}

/**
 * Attempt to parse potentially malformed JSON from an AI response.
 * Applies progressive repair strategies in order of least to most aggressive.
 */
export function repairAndParseJSON(raw: string): RepairResult {
  const strategies: { name: string; transform: (s: string) => string }[] = [
    { name: "raw", transform: (s) => s },
    { name: "trimmed", transform: (s) => s.trim() },
    { name: "extract_json_block", transform: extractJsonBlock },
    { name: "fix_trailing_commas", transform: fixTrailingCommas },
    { name: "fix_single_quotes", transform: fixSingleQuotes },
    { name: "strip_markdown_fences", transform: stripMarkdownFences },
    { name: "aggressive_extract", transform: aggressiveExtract },
  ];

  for (const strategy of strategies) {
    try {
      const transformed = strategy.transform(raw);
      const data = JSON.parse(transformed);
      return {
        success: true,
        data,
        repairApplied: strategy.name === "raw" ? null : strategy.name,
        rawInput: raw,
      };
    } catch {
      // Try next strategy
    }
  }

  return {
    success: false,
    data: null,
    repairApplied: null,
    rawInput: raw,
  };
}

/** Extract the first JSON object or array from a string. */
function extractJsonBlock(s: string): string {
  // Find the first { or [
  const objectStart = s.indexOf("{");
  const arrayStart = s.indexOf("[");

  let start: number;
  let openChar: string;
  let closeChar: string;

  if (objectStart === -1 && arrayStart === -1) {
    return s;
  }

  if (objectStart === -1) {
    start = arrayStart;
    openChar = "[";
    closeChar = "]";
  } else if (arrayStart === -1) {
    start = objectStart;
    openChar = "{";
    closeChar = "}";
  } else {
    if (objectStart < arrayStart) {
      start = objectStart;
      openChar = "{";
      closeChar = "}";
    } else {
      start = arrayStart;
      openChar = "[";
      closeChar = "]";
    }
  }

  // Find matching close
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openChar) depth++;
    if (ch === closeChar) depth--;

    if (depth === 0) {
      return s.slice(start, i + 1);
    }
  }

  return s.slice(start);
}

/** Remove trailing commas before closing brackets/braces. */
function fixTrailingCommas(s: string): string {
  const extracted = extractJsonBlock(s);
  return extracted.replace(/,\s*([\]}])/g, "$1");
}

/** Replace single quotes with double quotes (common in Python-trained models). */
function fixSingleQuotes(s: string): string {
  const extracted = extractJsonBlock(s);
  // Simple replacement — only safe for well-structured outputs
  return extracted
    .replace(/'/g, '"')
    .replace(/,\s*([\]}])/g, "$1");
}

/** Strip markdown code fences (```json ... ```) */
function stripMarkdownFences(s: string): string {
  const fencePattern = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const match = s.match(fencePattern);
  if (match) {
    return extractJsonBlock(match[1]);
  }
  return extractJsonBlock(s);
}

/** Most aggressive: find anything that looks like JSON. */
function aggressiveExtract(s: string): string {
  let cleaned = s;

  // Strip markdown fences
  cleaned = cleaned.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");

  // Strip leading text before JSON
  cleaned = extractJsonBlock(cleaned);

  // Fix common issues
  cleaned = cleaned
    .replace(/,\s*([\]}])/g, "$1")     // trailing commas
    .replace(/\n/g, " ")               // newlines inside strings
    .replace(/\t/g, " ");              // tabs

  return cleaned;
}
