/**
 * Health Check API Route
 *
 * Pings the Supabase PostgreSQL database to keep it active and prevent
 * Supabase from pausing the project due to inactivity on the free tier.
 *
 * Usage: Set up a cron service (e.g., UptimeRobot, cron-job.org, or
 * GitHub Actions) to hit this endpoint every ~5 minutes.
 *
 * GET /api/health
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic"; // never cache this route
export const revalidate = 0;

export async function GET() {
  const start = Date.now();

  try {
    // Run a lightweight query to keep the DB connection alive
    const result = await db.execute(sql`SELECT 1 AS ping`);

    const latencyMs = Date.now() - start;

    return NextResponse.json(
      {
        status: "healthy",
        database: "connected",
        latency_ms: latencyMs,
        timestamp: new Date().toISOString(),
        message: "Supabase database is active and responding",
      },
      { status: 200 }
    );
  } catch (error) {
    const latencyMs = Date.now() - start;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    console.error("[Health Check] Database ping failed:", errorMessage);

    return NextResponse.json(
      {
        status: "unhealthy",
        database: "disconnected",
        latency_ms: latencyMs,
        timestamp: new Date().toISOString(),
        error: errorMessage,
      },
      { status: 503 }
    );
  }
}
