/**
 * Daily log hook for client-side CRUD operations.
 */

"use client";

import { useState, useCallback } from "react";
import { ROUTES } from "@/lib/constants/routes";
import type { DailyLogFormData, DailyLogDisplay } from "@/types/daily-log.types";

export function useDailyLog() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createLog = useCallback(async (data: DailyLogFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(ROUTES.API.DAILY_LOG.BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await res.json();

      if (!result.success) {
        setError(result.error.message);
        return null;
      }

      return result.data as DailyLogDisplay;
    } catch {
      setError("Failed to create log");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchRecentLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(ROUTES.API.DAILY_LOG.RECENT);
      const result = await res.json();

      if (!result.success) {
        setError(result.error.message);
        return null;
      }

      return result.data as { logs: DailyLogDisplay[]; stats: Record<string, number> };
    } catch {
      setError("Failed to fetch logs");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchLogByDate = useCallback(async (date: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${ROUTES.API.DAILY_LOG.BASE}?date=${date}`);
      const result = await res.json();

      if (!result.success) {
        setError(result.error.message);
        return null;
      }

      return result.data as DailyLogDisplay | null;
    } catch {
      setError("Failed to fetch log");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { createLog, fetchRecentLogs, fetchLogByDate, isLoading, error, setError };
}
