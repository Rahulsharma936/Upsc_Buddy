/**
 * GET /api/ai/jobs/[id]
 * Retrieve an AI processing job status by ID.
 */

import { NextRequest } from "next/server";
import { aiProcessingService } from "@/lib/ai/services/ai-processing.service";
import { getAuthenticatedUser } from "@/lib/utils/auth-helper";
import {
  successResponse,
  unauthorizedResponse,
  notFoundResponse,
  serverErrorResponse,
} from "@/lib/utils/api-response";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return unauthorizedResponse();
    }

    const { id } = await params;

    const job = await aiProcessingService.getJob(id, user.id);

    if (!job) {
      return notFoundResponse("Processing job not found");
    }

    return successResponse(job);
  } catch (error) {
    console.error("[API] Get AI job error:", error);
    return serverErrorResponse();
  }
}
