import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/PageHeader";
import { RevisionList } from "@/components/features/revision/RevisionList";

export const metadata: Metadata = {
  title: "Revision — UPSC Prep",
  description: "Spaced repetition and adaptive revision scheduling",
};

export default function RevisionPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Revision"
        description="Concepts due for review, prioritized by forgetting probability and importance."
      />
      <RevisionList />
    </div>
  );
}
