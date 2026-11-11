import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/PageHeader";
import { InsightsDashboard } from "@/components/features/insights/InsightsDashboard";

export const metadata: Metadata = {
  title: "Insights — UPSC Prep",
  description: "Answer accuracy by subject, concepts that need work, and study coverage",
};

export default function InsightsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Insights"
        description="How you are actually answering, subject by subject, and what you have studied so far."
      />
      <InsightsDashboard />
    </div>
  );
}
