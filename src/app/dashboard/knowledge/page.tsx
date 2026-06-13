import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/PageHeader";
import { NotesList } from "@/components/features/notes/NotesList";

export const metadata: Metadata = {
  title: "Knowledge — UPSC Prep",
  description: "Concepts, AI revision notes, GS mappings, and contextual intelligence",
};

export default function KnowledgePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge"
        description="Your concepts, revision notes, GS mappings, and contextual intelligence — all in one place."
      />
      <NotesList />
    </div>
  );
}
