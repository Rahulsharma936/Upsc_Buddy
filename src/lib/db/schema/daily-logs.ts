/**
 * Drizzle schema: daily_logs table.
 * Core study logging table with future AI extension points.
 */

import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { profiles } from "./profiles";

export const dailyLogs = pgTable(
  "daily_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    rawInput: text("raw_input").notNull().default(""),
    subjects: text("subjects").array().notNull().default([]),
    concepts: text("concepts").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("daily_logs_user_date_unique").on(table.userId, table.date),
    index("daily_logs_user_id_idx").on(table.userId),
    index("daily_logs_date_idx").on(table.date),
  ]
);
