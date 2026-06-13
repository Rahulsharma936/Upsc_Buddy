/**
 * Daily log repository.
 * Data access layer for the daily_logs table.
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyLogs } from "@/lib/db/schema";
import type { DailyLog, NewDailyLog } from "@/types/database.types";

export const dailyLogRepository = {
  async findByIdAndUser(
    id: string,
    userId: string
  ): Promise<DailyLog | undefined> {
    const result = await db
      .select()
      .from(dailyLogs)
      .where(and(eq(dailyLogs.id, id), eq(dailyLogs.userId, userId)))
      .limit(1);

    return result[0];
  },

  async findByUserAndDate(
    userId: string,
    date: string
  ): Promise<DailyLog | undefined> {
    const result = await db
      .select()
      .from(dailyLogs)
      .where(and(eq(dailyLogs.userId, userId), eq(dailyLogs.date, date)))
      .limit(1);

    return result[0];
  },

  async findRecentByUser(userId: string, limit = 10): Promise<DailyLog[]> {
    return db
      .select()
      .from(dailyLogs)
      .where(eq(dailyLogs.userId, userId))
      .orderBy(desc(dailyLogs.date))
      .limit(limit);
  },

  async create(data: NewDailyLog): Promise<DailyLog> {
    const result = await db
      .insert(dailyLogs)
      .values(data)
      .returning();

    return result[0];
  },

  async update(
    id: string,
    userId: string,
    data: Partial<Pick<DailyLog, "rawInput" | "subjects" | "concepts">>
  ): Promise<DailyLog | undefined> {
    const result = await db
      .update(dailyLogs)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(dailyLogs.id, id), eq(dailyLogs.userId, userId)))
      .returning();

    return result[0];
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(dailyLogs)
      .where(and(eq(dailyLogs.id, id), eq(dailyLogs.userId, userId)))
      .returning({ id: dailyLogs.id });

    return result.length > 0;
  },

  async getLogDates(userId: string): Promise<string[]> {
    const result = await db
      .select({ date: dailyLogs.date })
      .from(dailyLogs)
      .where(eq(dailyLogs.userId, userId))
      .orderBy(desc(dailyLogs.date));

    return result.map((r) => r.date);
  },
};
