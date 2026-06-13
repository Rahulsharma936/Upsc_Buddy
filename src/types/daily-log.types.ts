/**
 * Daily log feature types.
 */

export interface DailyLogFormData {
  date: string;
  subjects: string[];
  rawInput: string;
  concepts?: string[];
}

export interface DailyLogDisplay {
  id: string;
  date: string;
  subjects: string[];
  rawInput: string;
  concepts: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DailyLogFilters {
  date?: string;
  startDate?: string;
  endDate?: string;
}
