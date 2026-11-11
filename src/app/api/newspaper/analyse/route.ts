/**
 * Newspaper page analysis.
 *
 * POST /api/newspaper/analyse
 *   Body: { newspaper?, editionDate, readDate, pageNumber, text, image? }
 *
 * Takes one page's text (extracted in the browser; the PDF itself is never
 * uploaded) and saves its UPSC-relevant articles as Newspaper Notes. When the
 * page has no text layer, a rendered image of the page is read instead.
 * A page that was analysed before returns its saved result.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import { analyseRequestSchema, needsOcr } from "@/lib/newspaper/newspaper";
import { newspaperService, NewspaperError } from "@/lib/newspaper/newspaper.service";
import { GroqDirectError } from "@/lib/ai/groq-direct";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

    const parsed = analyseRequestSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      return errorResponse(`Invalid request — ${detail}`);
    }
    const req = parsed.data;

    const cached = await newspaperService.getPage(user.id, req.newspaper, req.editionDate, req.pageNumber);
    if (cached) return NextResponse.json({ success: true, data: cached });

    let text = req.text;
    let ocr = false;
    if (needsOcr(text)) {
      if (!req.image) return errorResponse("This page has no readable text. Its image is needed to read it.");
      text = await newspaperService.pageTextFromImage(req.image);
      ocr = true;
      if (needsOcr(text)) return errorResponse("Could not read text on this page.", 422);
    }

    const result = await newspaperService.analysePage({
      userId: user.id,
      newspaper: req.newspaper,
      editionDate: req.editionDate,
      readDate: req.readDate,
      pageNumber: req.pageNumber,
      text,
    });
    return NextResponse.json({ success: true, data: { ...result, ocr } });
  } catch (error) {
    if (error instanceof NewspaperError || error instanceof GroqDirectError) {
      return errorResponse(error.message, error.status);
    }
    console.error("[API] POST /api/newspaper/analyse error:", error);
    return errorResponse("Internal server error", 500);
  }
}
