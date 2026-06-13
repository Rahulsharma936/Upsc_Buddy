/**
 * POST /api/onboarding — Complete onboarding
 */

import { NextRequest } from "next/server";
import { profileService } from "@/lib/services/profile.service";
import { onboardingSchema } from "@/lib/validations/onboarding.schema";
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
    const parsed = onboardingSchema.safeParse(body);

    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      parsed.error.issues.forEach((err) => {
        const key = err.path.join(".");
        if (!details[key]) details[key] = [];
        details[key].push(err.message);
      });
      return validationErrorResponse(details);
    }

    const profile = await profileService.completeOnboarding(user.id, parsed.data);
    return successResponse(profile);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.code, error.message, error.statusCode);
    }
    console.error("[API] Onboarding error:", error);
    return serverErrorResponse();
  }
}
