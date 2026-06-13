/**
 * AI response validation utility.
 * Combines JSON repair + Zod validation into a single pipeline.
 * Provides structured error information for observability.
 */

import type { z } from "zod";
import { repairAndParseJSON } from "./json-repair";

/** Result of validating an AI response against a Zod schema. */
export interface ValidationResult<T> {
  success: boolean;
  data: T | null;
  errors: string[];
  rawResponse: string;
  jsonRepairApplied: string | null;
}

/**
 * Validate a raw AI response string against a Zod schema.
 * Pipeline: raw string → JSON repair → Zod validation → typed output.
 */
export function validateAIResponse<T>(
  rawResponse: string,
  schema: z.ZodType<T>
): ValidationResult<T> {
  // Step 1: Attempt JSON parsing with repair
  const parseResult = repairAndParseJSON(rawResponse);

  if (!parseResult.success) {
    return {
      success: false,
      data: null,
      errors: [
        "Failed to parse JSON from AI response after all repair strategies",
        `Raw response (first 500 chars): ${rawResponse.slice(0, 500)}`,
      ],
      rawResponse,
      jsonRepairApplied: null,
    };
  }

  // Step 2: Validate against Zod schema
  const zodResult = schema.safeParse(parseResult.data);

  if (!zodResult.success) {
    const zodErrors = zodResult.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`
    );

    return {
      success: false,
      data: null,
      errors: [
        "AI response failed schema validation",
        ...zodErrors,
      ],
      rawResponse,
      jsonRepairApplied: parseResult.repairApplied,
    };
  }

  return {
    success: true,
    data: zodResult.data,
    errors: [],
    rawResponse,
    jsonRepairApplied: parseResult.repairApplied,
  };
}
