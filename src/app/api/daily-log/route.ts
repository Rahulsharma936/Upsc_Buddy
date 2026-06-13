/**
 * POST /api/daily-log — Create a new daily log
 * GET  /api/daily-log?date=YYYY-MM-DD — Get log by date
 */

import { NextRequest } from "next/server";
import { dailyLogService } from "@/lib/services/daily-log.service";
import { createDailyLogSchema, dailyLogQuerySchema } from "@/lib/validations/daily-log.schema";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import {
  successResponse,
  unauthorizedResponse,
  validationErrorResponse,
  serverErrorResponse,
  errorResponse,
} from "@/lib/utils/api-response";
import { AppError } from "@/lib/utils/errors";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const parsed = createDailyLogSchema.safeParse(body);

    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      parsed.error.issues.forEach((err) => {
        const key = err.path.join(".");
        if (!details[key]) details[key] = [];
        details[key].push(err.message);
      });
      return validationErrorResponse(details);
    }

    const log = await dailyLogService.createLog(user.id, parsed.data);
    return successResponse(log, undefined, 201);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.code, error.message, error.statusCode);
    }
    console.error("[API] Create daily log error:", error);
    return serverErrorResponse();
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    if (date) {
      const parsed = dailyLogQuerySchema.safeParse({ date });
      if (!parsed.success) {
        return validationErrorResponse({ date: ["Invalid date format"] });
      }

      const log = await dailyLogService.getLogByDate(user.id, date);
      return successResponse(log ?? null);
    }

    // Default: return recent logs
    const logs = await dailyLogService.getRecentLogs(user.id);
    return successResponse(logs);
  } catch (error) {
    console.error("[API] Get daily log error:", error);
    return serverErrorResponse();
  }
}
