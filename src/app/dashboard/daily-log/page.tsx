import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/PageHeader";
import { DailyLogForm } from "@/components/features/daily-log/DailyLogForm";
import { RecentLogs } from "@/components/features/daily-log/RecentLogs";

export const metadata: Metadata = {
  title: "Daily Log — UPSC Prep",
};

export default function DailyLogPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily Study Log"
        description="Record and track your daily study sessions"
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <DailyLogForm />
        </div>
        <div className="lg:col-span-2">
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Recent Logs
            </h3>
            <RecentLogs />
          </div>
        </div>
      </div>
    </div>
  );
}
