"use client";

/**
 * DashboardSidebar — 4-surface cognitive navigation.
 *
 * Surfaces:
 * - Dashboard (home)
 * - Daily Log (input)
 * - Knowledge (understanding)
 * - Practice (application)
 * - Revision (retention)
 * - Insights (meta-cognition)
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useUIStore } from "@/stores/ui.store";
import { ROUTES } from "@/lib/constants/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  LayoutDashboard,
  PenLine,
  BookOpen,
  Swords,
  RotateCcw,
  BarChart3,
  Stethoscope,
  LogOut,
  Menu,
  X,
} from "lucide-react";

const navSections = [
  {
    label: "Core",
    items: [
      { label: "Dashboard", href: ROUTES.DASHBOARD, icon: LayoutDashboard },
      { label: "Daily Log", href: ROUTES.DAILY_LOG, icon: PenLine },
    ],
  },
  {
    label: "Cognitive",
    items: [
      { label: "Knowledge", href: ROUTES.KNOWLEDGE, icon: BookOpen },
      { label: "Practice", href: ROUTES.PRACTICE, icon: Swords },
      { label: "Revision", href: ROUTES.REVISION, icon: RotateCcw },
      { label: "Insights", href: ROUTES.INSIGHTS, icon: BarChart3 },
    ],
  },
  {
    label: "Repair",
    items: [
      { label: "Diagnostic", href: ROUTES.DIAGNOSTIC, icon: Stethoscope },
    ],
  },
];

export function DashboardSidebar() {
  const pathname = usePathname();
  const { logout } = useAuth();
  const { sidebarOpen, toggleSidebar, setSidebarOpen } = useUIStore();

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={toggleSidebar}
        className="fixed left-4 top-4 z-50 rounded-md border bg-background p-2 shadow-sm lg:hidden"
        aria-label="Toggle sidebar"
      >
        {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-background transition-transform duration-200 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand */}
        <div className="flex h-14 items-center px-6">
          <Link
            href={ROUTES.DASHBOARD}
            className="text-lg font-semibold tracking-tight"
            onClick={() => setSidebarOpen(false)}
          >
            UPSC Prep
          </Link>
        </div>

        <Separator />

        {/* Navigation sections */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {navSections.map((section, idx) => (
            <div key={section.label}>
              {idx > 0 && <div className="my-3 px-3"><Separator /></div>}
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== ROUTES.DASHBOARD &&
                      pathname.startsWith(item.href));

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-3 text-muted-foreground"
            onClick={logout}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>
    </>
  );
}
