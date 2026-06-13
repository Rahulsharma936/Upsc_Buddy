/**
 * Daily log service.
 * Business logic for study log operations.
 */

import { dailyLogRepository } from "@/lib/repositories/daily-log.repository";
import { ConflictError, NotFoundError } from "@/lib/utils/errors";
import type { CreateDailyLogInput } from "@/lib/validations/daily-log.schema";
import { getStreakDays } from "@/lib/utils/date";

export const dailyLogService = {
  async createLog(userId: string, input: CreateDailyLogInput) {
    // Check for existing log on the same date
    const existing = await dailyLogRepository.findByUserAndDate(userId, input.date);
    if (existing) {
      throw new ConflictError("A log entry already exists for this date");
    }

    return dailyLogRepository.create({
      userId,
      date: input.date,
      rawInput: input.rawInput,
      subjects: input.subjects,
      concepts: input.concepts ?? [],
    });
  },

  async getLogByDate(userId: string, date: string) {
    return dailyLogRepository.findByUserAndDate(userId, date);
  },

  async getRecentLogs(userId: string, limit = 10) {
    return dailyLogRepository.findRecentByUser(userId, limit);
  },

  async updateLog(
    logId: string,
    userId: string,
    data: Partial<Pick<CreateDailyLogInput, "rawInput" | "subjects" | "concepts">>
  ) {
    const updated = await dailyLogRepository.update(logId, userId, data);
    if (!updated) {
      throw new NotFoundError("Daily log");
    }
    return updated;
  },

  async deleteLog(logId: string, userId: string) {
    const deleted = await dailyLogRepository.delete(logId, userId);
    if (!deleted) {
      throw new NotFoundError("Daily log");
    }
  },

  async getStudyStreak(userId: string): Promise<number> {
    const dates = await dailyLogRepository.getLogDates(userId);
    return getStreakDays(dates);
  },

  async getQuickStats(userId: string) {
    const recentLogs = await dailyLogRepository.findRecentByUser(userId, 30);
    const dates = await dailyLogRepository.getLogDates(userId);
    const streak = getStreakDays(dates);

    // Count unique subjects studied this month
    const subjectsThisMonth = new Set<string>();
    recentLogs.forEach((log) => {
      (log.subjects as string[]).forEach((s) => subjectsThisMonth.add(s));
    });

    return {
      totalLogs: dates.length,
      streak,
      logsThisMonth: recentLogs.length,
      subjectsStudied: subjectsThisMonth.size,
    };
  },
};
