"use client";

import { cn } from "@/lib/utils";
import { UPSC_SUBJECTS } from "@/lib/constants/subjects";

interface SubjectSelectorProps {
  selected: string[];
  onChange: (subjects: string[]) => void;
}

export function SubjectSelector({ selected, onChange }: SubjectSelectorProps) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {UPSC_SUBJECTS.map((subject) => {
        const isActive = selected.includes(subject.id);
        return (
          <button
            key={subject.id}
            type="button"
            onClick={() => toggle(subject.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              isActive
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
            )}
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: subject.color }}
            />
            {subject.label}
          </button>
        );
      })}
    </div>
  );
}
