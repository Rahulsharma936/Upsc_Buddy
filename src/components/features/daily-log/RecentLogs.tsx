"use client";

import { useEffect, useState } from "react";
import { useDailyLog } from "@/hooks/use-daily-log";
import { LogCard } from "./LogCard";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/EmptyState";
import { PenLine } from "lucide-react";
import type { DailyLogDisplay } from "@/types/daily-log.types";

export function RecentLogs() {
  const { fetchRecentLogs, isLoading } = useDailyLog();
  const [logs, setLogs] = useState<DailyLogDisplay[]>([]);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    const load = async () => {
      const result = await fetchRecentLogs();
      if (result) {
        setLogs(result.logs);
      }
      setHasFetched(true);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading && !hasFetched) {
    return <LoadingSpinner label="Loading recent logs..." />;
  }

  if (logs.length === 0) {
    return (
      <EmptyState
        icon={<PenLine className="h-5 w-5" />}
        title="No logs yet"
        description="Create your first study log to start tracking your progress"
      />
    );
  }

  return (
    <div className="space-y-3">
      {logs.map((log) => (
        <LogCard key={log.id} log={log} />
      ))}
    </div>
  );
}
