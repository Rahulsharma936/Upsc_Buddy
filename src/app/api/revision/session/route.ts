/**
 * Revision Session API — read only.
 *
 * GET /api/revision/session?limit=10&since=<ISO>&scope=all|static|current
 *
 * Returns today's question-based revision session: due concepts in priority
 * order, each with an unseen MCQ from its existing inventory (or null → the
 * client falls back to recall-then-reveal), its note for the recall cue, and
 * whether it was already handled since `since` (the client's local midnight)
 * so a refresh resumes instead of repeating.
 *
 * Writes happen only through the existing POST /api/revision, /api/repair/*
 * routes. No LLM. No new tables. SM-2 untouched.
 */

import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import {
  successResponse,
  unauthorizedResponse,
  validationErrorResponse,
  serverErrorResponse,
} from "@/lib/utils/api-response";
import { revisionSessionService } from "@/lib/revision-session/revision-session.service";
import { parseScope } from "@/lib/content-scope";

export const dynamic = "force-dynamic";

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const limitRaw = searchParams.get("limit");
    const sinceRaw = searchParams.get("since");

    const errors: Record<string, string[]> = {};

    let limit: number | undefined;
    if (limitRaw !== null && limitRaw !== "") {
      const n = Number(limitRaw);
      if (Number.isInteger(n) && n > 0) limit = n;
      else errors.limit = ["Must be a positive integer"];
    }

    let since = new Date(Date.now() - DEFAULT_LOOKBACK_MS);
    if (sinceRaw) {
      const d = new Date(sinceRaw);
      if (Number.isNaN(d.getTime())) errors.since = ["Must be an ISO-8601 timestamp"];
      else since = d;
    }

    if (Object.keys(errors).length > 0) return validationErrorResponse(errors);

    const scope = parseScope(searchParams.get("scope"));
    const payload = await revisionSessionService.build({ userId: user.id, limit, since, scope });
    return successResponse(payload);
  } catch (error) {
    console.error("[ROUTE] revision/session GET:", error);
    return serverErrorResponse();
  }
}
