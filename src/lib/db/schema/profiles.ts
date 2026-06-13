/**
 * Drizzle schema: profiles table.
 * Extends Supabase auth.users with application-specific data.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // References auth.users(id)
  email: text("email").notNull(),
  fullName: text("full_name").notNull().default(""),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  preferences: jsonb("preferences").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
