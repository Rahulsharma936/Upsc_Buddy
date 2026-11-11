/**
 * Newspaper page chat.
 *
 * POST /api/newspaper/chat
 *   Body: { newspaper?, editionDate, pageNumber, text, image?, question, history? }
 *
 * Answers a question about one page, grounded in that page's text (sent from
 * the browser; the PDF is never uploaded), the student's notes, the syllabus
 * and the verified PYQ bank. Nothing is stored.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import { chatRequestSchema } from "@/lib/newspaper/page-chat";
import { pageChatService } from "@/lib/newspaper/page-chat.service";
import { NewspaperError } from "@/lib/newspaper/newspaper.service";
import { GroqDirectError } from "@/lib/ai/groq-direct";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: { message } }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return errorResponse("Unauthorized", 401);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Request body must be valid JSON");
    }

    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      return errorResponse(`Invalid request — ${detail}`);
    }

    const reply = await pageChatService.ask(user.id, parsed.data);
    return NextResponse.json({ success: true, data: reply });
  } catch (error) {
    if (error instanceof NewspaperError || error instanceof GroqDirectError) {
      return errorResponse(error.message, error.status);
    }
    console.error("[API] POST /api/newspaper/chat error:", error);
    return errorResponse("Internal server error", 500);
  }
}
