/**
 * Date utility functions.
 */

import { format, parseISO, isToday, isYesterday, differenceInDays } from "date-fns";

export function formatDate(date: string | Date, pattern = "MMM dd, yyyy"): string {
  const parsed = typeof date === "string" ? parseISO(date) : date;
  return format(parsed, pattern);
}

export function formatRelativeDate(date: string | Date): string {
  const parsed = typeof date === "string" ? parseISO(date) : date;

  if (isToday(parsed)) return "Today";
  if (isYesterday(parsed)) return "Yesterday";

  const daysAgo = differenceInDays(new Date(), parsed);
  if (daysAgo <= 7) return `${daysAgo} days ago`;

  return format(parsed, "MMM dd, yyyy");
}

export function toISODateString(date: Date = new Date()): string {
  return format(date, "yyyy-MM-dd");
}

export function getStreakDays(dates: string[]): number {
  if (dates.length === 0) return 0;

  const sorted = [...dates].sort().reverse();
  const today = toISODateString();

  if (sorted[0] !== today && sorted[0] !== toISODateString(new Date(Date.now() - 86400000))) {
    return 0;
  }

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = differenceInDays(parseISO(sorted[i - 1]), parseISO(sorted[i]));
    if (diff === 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}
