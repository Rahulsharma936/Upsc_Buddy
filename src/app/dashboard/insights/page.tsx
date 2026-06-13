import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/PageHeader";
import { InsightsDashboard } from "@/components/features/insights/InsightsDashboard";

export const metadata: Metadata = {
  title: "Insights — UPSC Prep",
  description: "Adaptive intelligence, syllabus coverage, concept gaps, and study analytics",
};

export default function InsightsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Insights"
        description="Adaptive intelligence about your UPSC preparation — strengths, gaps, coverage, and balance."
      />
      <InsightsDashboard />
    </div>
  );
}
