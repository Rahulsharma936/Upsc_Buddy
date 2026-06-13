import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/PageHeader";
import { PracticeList } from "@/components/features/practice/PracticeList";

export const metadata: Metadata = {
  title: "Practice — UPSC Prep",
  description: "UPSC-authentic prelims MCQs, mains questions, and interview prompts",
};

export default function PracticePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Practice"
        description="UPSC-authentic questions generated from your studied concepts. Focused, intentional preparation."
      />
      <PracticeList />
    </div>
  );
}
