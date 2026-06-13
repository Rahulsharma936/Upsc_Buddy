/**
 * GET /api/auth/session
 */

import { authService } from "@/lib/services/auth.service";
import { successResponse, serverErrorResponse } from "@/lib/utils/api-response";

export async function GET() {
  try {
    const session = await authService.getSession();
    return successResponse(session);
  } catch (error) {
    console.error("[API] Session error:", error);
    return serverErrorResponse();
  }
}
