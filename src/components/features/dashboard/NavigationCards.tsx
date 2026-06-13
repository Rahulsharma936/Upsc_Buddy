import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ROUTES } from "@/lib/constants/routes";
import { PenLine, BookOpen, Swords, RotateCcw, BarChart3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavCard {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: string;
}

const cards: NavCard[] = [
  {
    title: "Daily Log",
    description: "Record today's study session",
    href: ROUTES.DAILY_LOG,
    icon: PenLine,
    accent: "text-blue-500 bg-blue-500/10",
  },
  {
    title: "Knowledge",
    description: "Concepts, notes & GS mappings",
    href: ROUTES.KNOWLEDGE,
    icon: BookOpen,
    accent: "text-emerald-500 bg-emerald-500/10",
  },
  {
    title: "Practice",
    description: "MCQs, mains & interview prep",
    href: ROUTES.PRACTICE,
    icon: Swords,
    accent: "text-violet-500 bg-violet-500/10",
  },
  {
    title: "Revision",
    description: "Spaced repetition & weak areas",
    href: ROUTES.REVISION,
    icon: RotateCcw,
    accent: "text-amber-500 bg-amber-500/10",
  },
  {
    title: "Insights",
    description: "Coverage, gaps & study balance",
    href: ROUTES.INSIGHTS,
    icon: BarChart3,
    accent: "text-rose-500 bg-rose-500/10",
  },
];

export function NavigationCards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {cards.map((card) => (
        <Link key={card.title} href={card.href}>
          <Card className="group transition-all duration-200 hover:shadow-md hover:border-border/80">
            <CardContent className="flex items-center gap-3.5 py-4 px-4">
              <div className={cn("rounded-lg p-2", card.accent)}>
                <card.icon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{card.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {card.description}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
