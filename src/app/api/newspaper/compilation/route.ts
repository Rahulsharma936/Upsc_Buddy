/**
 * Current-affairs compilation.
 *
 * GET /api/newspaper/compilation?period=week|month&date=YYYY-MM-DD
 *   → the student's Newspaper Notes for the week (Monday to Sunday) or calendar
 *     month containing `date` (default: today), stories folded together and
 *     grouped by GS paper.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import { isIsoDate } from "@/lib/newspaper/newspaper";
import { localIsoDate } from "@/lib/newspaper/page-text";
import { newspaperService } from "@/lib/newspaper/newspaper.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });

    const params = request.nextUrl.searchParams;
    const period = params.get("period") === "month" ? "month" : "week";
    const date = params.get("date") ?? "";
    const anchor = isIsoDate(date) ? date : localIsoDate();

    const data = await newspaperService.compile(user.id, period, anchor);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[API] GET /api/newspaper/compilation error:", error);
    return NextResponse.json({ success: false, error: { message: "Internal server error" } }, { status: 500 });
  }
}
