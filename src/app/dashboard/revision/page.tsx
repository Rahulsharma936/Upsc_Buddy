import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/PageHeader";
import { RevisionWorkspace } from "@/components/features/revision/RevisionWorkspace";
import { parseScope } from "@/lib/content-scope";

export const metadata: Metadata = {
  title: "Revision — UPSC Prep",
  description: "Spaced repetition and adaptive revision scheduling",
};

export default async function RevisionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = parseScope((await searchParams).scope);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Revision"
        description="Concepts due for review, prioritized by forgetting probability and importance."
      />
      {/* Question-based session + read-only due list. Evidence comes from
          answering, never from a "did you remember?" button after the reveal. */}
      <RevisionWorkspace initialScope={scope} />
    </div>
  );
}
