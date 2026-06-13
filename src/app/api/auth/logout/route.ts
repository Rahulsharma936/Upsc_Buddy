/**
 * POST /api/auth/logout
 */

import { authService } from "@/lib/services/auth.service";
import { successResponse, serverErrorResponse } from "@/lib/utils/api-response";

export async function POST() {
  try {
    await authService.logout();
    return successResponse({ message: "Logged out successfully" });
  } catch (error) {
    console.error("[API] Logout error:", error);
    return serverErrorResponse();
  }
}
