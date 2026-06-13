import { Card, CardContent } from "@/components/ui/card";
import { BookOpen, Flame, Calendar, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickStatsProps {
  stats: {
    totalLogs: number;
    streak: number;
    logsThisMonth: number;
    subjectsStudied: number;
  };
}

const statCards = [
  {
    key: "streak" as const,
    label: "Study Streak",
    icon: Flame,
    suffix: " days",
    color: "text-orange-500",
  },
  {
    key: "totalLogs" as const,
    label: "Total Sessions",
    icon: BookOpen,
    suffix: "",
    color: "text-blue-500",
  },
  {
    key: "logsThisMonth" as const,
    label: "This Month",
    icon: Calendar,
    suffix: " logs",
    color: "text-green-500",
  },
  {
    key: "subjectsStudied" as const,
    label: "Subjects Covered",
    icon: BarChart3,
    suffix: "",
    color: "text-purple-500",
  },
] as const;

export function QuickStats({ stats }: QuickStatsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {statCards.map(({ key, label, icon: Icon, suffix, color }) => (
        <Card key={key}>
          <CardContent className="flex items-center gap-4 py-4">
            <div className={cn("rounded-lg bg-muted p-2.5", color)}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {stats[key]}
                {suffix}
              </p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
