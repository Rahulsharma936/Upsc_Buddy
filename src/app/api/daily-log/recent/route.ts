/**
 * GET /api/daily-log/recent — Get recent logs with stats
 */

import { dailyLogService } from "@/lib/services/daily-log.service";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import {
  successResponse,
  unauthorizedResponse,
  serverErrorResponse,
} from "@/lib/utils/api-response";

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return unauthorizedResponse();

    const [logs, stats] = await Promise.all([
      dailyLogService.getRecentLogs(user.id, 10),
      dailyLogService.getQuickStats(user.id),
    ]);

    return successResponse({ logs, stats });
  } catch (error) {
    console.error("[API] Recent logs error:", error);
    return serverErrorResponse();
  }
}
