import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/PageHeader";
import { DiagnosticView } from "@/components/features/diagnostic/DiagnosticView";

export const metadata: Metadata = {
  title: "Diagnostic — UPSC Prep",
  description: "Understand your learning gaps and know what to repair first.",
};

export default function DiagnosticPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Learning Diagnostic"
        description="Your learning gaps at a glance — understand what needs attention and why."
      />
      <DiagnosticView />
    </div>
  );
}
