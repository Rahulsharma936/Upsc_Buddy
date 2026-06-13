/**
 * Drizzle database client.
 * Uses direct PostgreSQL connection via the postgres driver.
 * Lazy-initialized to avoid build-time failures when DATABASE_URL is not set.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let _db: PostgresJsDatabase<typeof schema> | null = null;

function getDb(): PostgresJsDatabase<typeof schema> {
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 30,
    prepare: false,
    ssl: { rejectUnauthorized: false },
  });

  _db = drizzle(client, { schema });
  return _db;
}

/**
 * Proxy that lazily initializes the database connection on first use.
 * This prevents build-time errors when DATABASE_URL is not available.
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop: string | symbol) {
    const instance = getDb();
    const value = instance[prop as keyof typeof instance];
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
});
