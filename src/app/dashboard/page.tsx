import { createClient } from "@/lib/supabase/server";
import { profileRepository } from "@/lib/repositories/profile.repository";
import { dailyLogService } from "@/lib/services/daily-log.service";
import { WelcomeSection } from "@/components/features/dashboard/WelcomeSection";
import { QuickStats } from "@/components/features/dashboard/QuickStats";
import { RecentActivity } from "@/components/features/dashboard/RecentActivity";
import { NavigationCards } from "@/components/features/dashboard/NavigationCards";
import type { DailyLogDisplay } from "@/types/daily-log.types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [profile, recentLogs, stats] = await Promise.all([
    profileRepository.findById(user.id),
    dailyLogService.getRecentLogs(user.id, 5),
    dailyLogService.getQuickStats(user.id),
  ]);

  const fullName = profile?.fullName ?? "User";
  const logsForDisplay = recentLogs.map((log) => ({
    id: log.id,
    date: log.date,
    subjects: log.subjects as string[],
    rawInput: log.rawInput,
    concepts: log.concepts as string[],
    createdAt: log.createdAt.toISOString(),
    updatedAt: log.updatedAt.toISOString(),
  })) satisfies DailyLogDisplay[];

  return (
    <div className="space-y-6">
      <WelcomeSection fullName={fullName} />
      <QuickStats stats={stats} />
      <NavigationCards />
      <RecentActivity logs={logsForDisplay} />
    </div>
  );
}
