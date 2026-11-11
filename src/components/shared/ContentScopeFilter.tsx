"use client";

/** Segmented control: All / Static syllabus / Current affairs. */

import { cn } from "@/lib/utils";
import { CONTENT_SCOPES, CONTENT_SCOPE_LABEL, type ContentScope } from "@/lib/content-scope";

export function ContentScopeFilter({
  value,
  onChange,
  counts,
  disabled,
  idPrefix = "scope",
}: {
  value: ContentScope;
  onChange: (scope: ContentScope) => void;
  counts?: Partial<Record<ContentScope, number>>;
  disabled?: boolean;
  idPrefix?: string;
}) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5 text-xs" role="tablist" aria-label="Filter by source">
      {CONTENT_SCOPES.map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          id={`${idPrefix}-${s}`}
          aria-selected={value === s}
          disabled={disabled}
          onClick={() => onChange(s)}
          className={cn(
            "rounded px-2.5 py-1 disabled:opacity-50",
            value === s ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {CONTENT_SCOPE_LABEL[s]}
          {typeof counts?.[s] === "number" && <span className="ml-1 tabular-nums text-muted-foreground">{counts[s]}</span>}
        </button>
      ))}
    </div>
  );
}
