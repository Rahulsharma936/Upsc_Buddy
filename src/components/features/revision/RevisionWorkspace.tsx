"use client";

/**
 * RevisionWorkspace — the session on top, the read-only due list below.
 * When a session ends the list refetches, so it never shows stale due items.
 *
 * The source filter (all / static syllabus / current affairs) applies to both.
 * Changing it starts a fresh session for that scope; answers already given were
 * saved as they were made, and the session resumes past concepts done today.
 */

import { useState } from "react";
import { RevisionSession } from "./RevisionSession";
import { DueConceptsList } from "./DueConceptsList";
import { ContentScopeFilter } from "@/components/shared/ContentScopeFilter";
import { scopeQuery, type ContentScope } from "@/lib/content-scope";

export function RevisionWorkspace({ initialScope = "all" }: { initialScope?: ContentScope } = {}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [scope, setScope] = useState<ContentScope>(initialScope);

  const changeScope = (next: ContentScope) => {
    setScope(next);
    window.history.replaceState(null, "", `${window.location.pathname}${scopeQuery(next)}`);
  };

  return (
    <div className="space-y-6">
      <ContentScopeFilter value={scope} onChange={changeScope} idPrefix="revision-scope" />
      <RevisionSession key={scope} scope={scope} onSessionEnd={() => setRefreshKey((k) => k + 1)} />
      <DueConceptsList refreshKey={refreshKey} scope={scope} />
    </div>
  );
}
