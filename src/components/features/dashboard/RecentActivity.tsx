import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatRelativeDate } from "@/lib/utils/date";
import { SUBJECT_MAP } from "@/lib/constants/subjects";
import type { DailyLogDisplay } from "@/types/daily-log.types";
import { Activity } from "lucide-react";

interface RecentActivityProps {
  logs: DailyLogDisplay[];
}

export function RecentActivity({ logs }: RecentActivityProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-5 w-5" />}
            title="No activity yet"
            description="Start logging your study sessions to track your progress"
          />
        ) : (
          <div className="space-y-4">
            {logs.slice(0, 5).map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 border-b border-border/50 pb-3 last:border-0 last:pb-0"
              >
                <div className="mt-0.5 h-2 w-2 rounded-full bg-primary" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium leading-none">
                      {formatRelativeDate(log.date)}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-1">
                    {log.rawInput}
                  </p>
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {(log.subjects as string[]).slice(0, 3).map((subject) => (
                      <Badge
                        key={subject}
                        variant="secondary"
                        className="text-[10px] font-normal"
                      >
                        {SUBJECT_MAP[subject]?.label ?? subject}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
