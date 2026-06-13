/**
 * Standardized API response helpers.
 * All route handlers should use these for consistent response shapes.
 */

import { NextResponse } from "next/server";
import type { ApiSuccessResponse, ApiErrorResponse, ApiMeta } from "@/types/api.types";

export function successResponse<T>(
  data: T,
  meta?: ApiMeta,
  status = 200
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({ success: true, data, meta }, { status });
}

export function errorResponse(
  code: string,
  message: string,
  status = 400,
  details?: Record<string, string[]>
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status }
  );
}

export function unauthorizedResponse(
  message = "Authentication required"
): NextResponse<ApiErrorResponse> {
  return errorResponse("UNAUTHORIZED", message, 401);
}

export function notFoundResponse(
  message = "Resource not found"
): NextResponse<ApiErrorResponse> {
  return errorResponse("NOT_FOUND", message, 404);
}

export function validationErrorResponse(
  details: Record<string, string[]>
): NextResponse<ApiErrorResponse> {
  return errorResponse("VALIDATION_ERROR", "Validation failed", 422, details);
}

export function serverErrorResponse(
  message = "Internal server error"
): NextResponse<ApiErrorResponse> {
  return errorResponse("INTERNAL_ERROR", message, 500);
}
