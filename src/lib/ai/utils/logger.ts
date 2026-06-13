/**
 * Structured AI logger.
 * Provides contextual logging for AI operations with metadata.
 * Production systems can later pipe these to observability platforms.
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface AILogEntry {
  level: LogLevel;
  component: string;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

function createLogEntry(
  level: LogLevel,
  component: string,
  message: string,
  metadata?: Record<string, unknown>
): AILogEntry {
  return {
    level,
    component,
    message,
    metadata,
    timestamp: new Date().toISOString(),
  };
}

function formatLog(entry: AILogEntry): string {
  const meta = entry.metadata
    ? ` | ${JSON.stringify(entry.metadata)}`
    : "";
  return `[${entry.timestamp}] [AI:${entry.component}] [${entry.level.toUpperCase()}] ${entry.message}${meta}`;
}

/**
 * Create a scoped logger for an AI component.
 * Usage: const log = createAILogger("concept-extraction");
 */
export function createAILogger(component: string) {
  return {
    info(message: string, metadata?: Record<string, unknown>) {
      const entry = createLogEntry("info", component, message, metadata);
      console.log(formatLog(entry));
    },

    warn(message: string, metadata?: Record<string, unknown>) {
      const entry = createLogEntry("warn", component, message, metadata);
      console.warn(formatLog(entry));
    },

    error(message: string, metadata?: Record<string, unknown>) {
      const entry = createLogEntry("error", component, message, metadata);
      console.error(formatLog(entry));
    },

    debug(message: string, metadata?: Record<string, unknown>) {
      if (process.env.NODE_ENV === "development") {
        const entry = createLogEntry("debug", component, message, metadata);
        console.debug(formatLog(entry));
      }
    },

    /** Log an AI processing event with full context. */
    processing(event: {
      jobId: string;
      action: string;
      provider?: string;
      model?: string;
      latencyMs?: number;
      status?: string;
      error?: string;
      metadata?: Record<string, unknown>;
    }) {
      const entry = createLogEntry(
        event.error ? "error" : "info",
        component,
        `[Job:${event.jobId}] ${event.action}`,
        {
          provider: event.provider,
          model: event.model,
          latencyMs: event.latencyMs,
          status: event.status,
          error: event.error,
          ...event.metadata,
        }
      );

      if (event.error) {
        console.error(formatLog(entry));
      } else {
        console.log(formatLog(entry));
      }
    },
  };
}
