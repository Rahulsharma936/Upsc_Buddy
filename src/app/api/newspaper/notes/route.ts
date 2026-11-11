/**
 * Newspaper Notes.
 *
 * GET /api/newspaper/notes                                   → all editions, newest first
 * GET /api/newspaper/notes?newspaper=&editionDate=&page=     → one analysed page (or null)
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import { isIsoDate, DEFAULT_NEWSPAPER } from "@/lib/newspaper/newspaper";
import { newspaperService } from "@/lib/newspaper/newspaper.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });

    const params = request.nextUrl.searchParams;
    const editionDate = params.get("editionDate");
    const page = Number(params.get("page"));
    if (editionDate && isIsoDate(editionDate) && Number.isInteger(page) && page > 0) {
      const newspaper = params.get("newspaper")?.trim() || DEFAULT_NEWSPAPER;
      const data = await newspaperService.getPage(user.id, newspaper, editionDate, page);
      return NextResponse.json({ success: true, data });
    }

    const editions = await newspaperService.listNotes(user.id);
    return NextResponse.json({ success: true, data: { editions } });
  } catch (error) {
    console.error("[API] GET /api/newspaper/notes error:", error);
    return NextResponse.json({ success: false, error: { message: "Internal server error" } }, { status: 500 });
  }
}
