/**
 * Answer evidence for the Insights page — live, read-only.
 *
 * GET /api/insights/evidence?scope=all|static|current
 *
 * Accuracy, tested coverage, concepts that need work and misses by cause,
 * computed from recorded answers (MCQs, repair checks, written and recall
 * answers). Not cached, so it reflects answers given a moment ago.
 * SM-2 and the stored mastery state are not touched.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import { conceptRepository } from "@/lib/repositories/concept.repository";
import { revisionRepository } from "@/lib/repositories/revision.repository";
import { buildAnswerEvidence, ANSWER_EVENT_TYPES } from "@/lib/insights/answer-evidence";
import { matchesScope, parseScope } from "@/lib/content-scope";
import { UPSC_SUBJECTS } from "@/lib/ai/subjects";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });

    const scope = parseScope(request.nextUrl.searchParams.get("scope"));
    const [concepts, events] = await Promise.all([
      conceptRepository.findAllByUser(user.id),
      revisionRepository.getEventsByTypes(user.id, ANSWER_EVENT_TYPES),
    ]);

    const data = buildAnswerEvidence(
      concepts
        .filter((c) => matchesScope(c.extractionMetadata, scope))
        .map((c) => ({ id: c.id, name: c.displayName, subject: c.subject })),
      events.map((e) => ({ ...e, eventMetadata: (e.eventMetadata ?? {}) as Record<string, unknown> })),
      UPSC_SUBJECTS,
    );
    return NextResponse.json({ success: true, data: { scope, ...data } });
  } catch (error) {
    console.error("[API] GET /api/insights/evidence error:", error);
    return NextResponse.json({ success: false, error: { message: "Internal server error" } }, { status: 500 });
  }
}
