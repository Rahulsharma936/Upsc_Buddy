import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/PageHeader";
import { PracticeList } from "@/components/features/practice/PracticeList";
import { parseScope } from "@/lib/content-scope";

export const metadata: Metadata = {
  title: "Practice — UPSC Prep",
  description: "UPSC-authentic prelims MCQs, mains questions, and interview prompts",
};

export default async function PracticePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = parseScope((await searchParams).scope);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Practice"
        description="UPSC-authentic questions generated from your studied concepts. Focused, intentional preparation."
      />
      <PracticeList initialScope={scope} />
    </div>
  );
}
