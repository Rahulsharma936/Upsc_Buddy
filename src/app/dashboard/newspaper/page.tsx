import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/PageHeader";
import { NewspaperReader } from "@/components/features/newspaper/NewspaperReader";

export const metadata: Metadata = {
  title: "Newspaper — UPSC Prep",
  description: "Read the day's newspaper and turn UPSC-relevant articles into notes and questions",
};

export default function NewspaperPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Newspaper"
        description="Open the day's e-paper, read it page by page, and keep only what matters for the exam."
      />
      <NewspaperReader />
    </div>
  );
}
