/**
 * POST /api/auth/signup
 */

import { NextRequest } from "next/server";
import { authService } from "@/lib/services/auth.service";
import { signupSchema } from "@/lib/validations/auth.schema";
import {
  successResponse,
  validationErrorResponse,
  serverErrorResponse,
  errorResponse,
} from "@/lib/utils/api-response";
import { AppError } from "@/lib/utils/errors";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = signupSchema.safeParse(body);

    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      parsed.error.issues.forEach((err) => {
        const key = err.path.join(".");
        if (!details[key]) details[key] = [];
        details[key].push(err.message);
      });
      return validationErrorResponse(details);
    }

    const result = await authService.signup(parsed.data);
    return successResponse(result, undefined, 201);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.code, error.message, error.statusCode);
    }
    console.error("[API] Signup error:", error);
    return serverErrorResponse();
  }
}
