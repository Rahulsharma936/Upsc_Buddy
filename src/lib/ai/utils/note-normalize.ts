/**
 * Note content normalization utilities.
 * Cleans AI-generated note sections for consistent formatting.
 *
 * Phase 2C cognitive-compression model:
 * coreIdea, examTriggers, staticCurrentLink,
 * answerWritingAngles, memoryHooks.
 */

import { createHash } from "crypto";
import type { GeneratedNote } from "../types";

// ─── Section Normalizers ────────────────────────────────────

/** Clean a text section (coreIdea). */
export function normalizeTextSection(raw: string): string {
  return raw
    .trim()
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

/** Clean and deduplicate array sections. */
export function normalizeArraySection(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const cleaned = item
      .trim()
      .replace(/^[-•*▪▸→]+\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length === 0) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    result.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
  }

  return result;
}

// ─── Full Note Normalizer ───────────────────────────────────

/** Normalize all sections of a generated note. */
export function normalizeNote(raw: GeneratedNote): GeneratedNote {
  return {
    coreIdea: normalizeTextSection(raw.coreIdea),
    examTriggers: normalizeArraySection(raw.examTriggers),
    staticCurrentLink: normalizeArraySection(raw.staticCurrentLink),
    answerWritingAngles: normalizeArraySection(raw.answerWritingAngles),
    memoryHooks: normalizeArraySection(raw.memoryHooks),
  };
}

// ─── Content Hashing ────────────────────────────────────────

/**
 * Deterministic hash of note content for deduplication.
 */
export function hashNoteContent(note: GeneratedNote): string {
  const canonical = JSON.stringify({
    coreIdea: note.coreIdea.toLowerCase().trim(),
    examTriggers: note.examTriggers.map((t) => t.toLowerCase().trim()).sort(),
    staticCurrentLink: note.staticCurrentLink.map((l) => l.toLowerCase().trim()).sort(),
    answerWritingAngles: note.answerWritingAngles.map((a) => a.toLowerCase().trim()).sort(),
    memoryHooks: note.memoryHooks.map((h) => h.toLowerCase().trim()).sort(),
  });

  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

// ─── Content Renderer ───────────────────────────────────────

/**
 * Render a structured note into a single markdown string.
 * Stored in the `content` column for full-text display.
 */
export function renderNoteToMarkdown(
  conceptName: string,
  note: GeneratedNote
): string {
  const sections: string[] = [];

  sections.push(`## ${conceptName}\n`);

  if (note.coreIdea) {
    sections.push(`### Core Idea\n${note.coreIdea}\n`);
  }

  if (note.examTriggers.length > 0) {
    const bullets = note.examTriggers.map((t) => `- ${t}`).join("\n");
    sections.push(`### Exam Triggers\n${bullets}\n`);
  }

  if (note.staticCurrentLink.length > 0) {
    const bullets = note.staticCurrentLink.map((l) => `- ${l}`).join("\n");
    sections.push(`### Static ↔ Current Link\n${bullets}\n`);
  }

  if (note.answerWritingAngles.length > 0) {
    const bullets = note.answerWritingAngles.map((a) => `- ${a}`).join("\n");
    sections.push(`### Answer-Writing Angles\n${bullets}\n`);
  }

  if (note.memoryHooks.length > 0) {
    const hooks = note.memoryHooks.map((h) => `- ${h}`).join("\n");
    sections.push(`### Memory Hooks\n${hooks}\n`);
  }

  return sections.join("\n");
}
