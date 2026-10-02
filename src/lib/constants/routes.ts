/**
 * Application route constants.
 * Single source of truth for all route paths.
 *
 * Phase 5: Four cognitive surfaces — Knowledge, Practice, Revision, Insights
 */

export const ROUTES = {
  // Public
  HOME: "/",
  LOGIN: "/login",
  SIGNUP: "/signup",

  // Protected — Cognitive surfaces
  DASHBOARD: "/dashboard",
  DAILY_LOG: "/dashboard/daily-log",
  KNOWLEDGE: "/dashboard/knowledge",
  PRACTICE: "/dashboard/practice",
  REVISION: "/dashboard/revision",
  INSIGHTS: "/dashboard/insights",
  DIAGNOSTIC: "/dashboard/diagnostic",
  ONBOARDING: "/onboarding",

  // Legacy aliases (backward compat — redirect to Knowledge)
  NOTES: "/dashboard/knowledge",

  // API
  API: {
    AUTH: {
      SIGNUP: "/api/auth/signup",
      LOGIN: "/api/auth/login",
      LOGOUT: "/api/auth/logout",
      SESSION: "/api/auth/session",
    },
    DAILY_LOG: {
      BASE: "/api/daily-log",
      RECENT: "/api/daily-log/recent",
    },
    ONBOARDING: "/api/onboarding",
    AI: {
      EXTRACT_CONCEPTS: "/api/ai/extract-concepts",
      JOB: (id: string) => `/api/ai/jobs/${id}`,
    },
  },
} as const;

/**
 * Routes that require authentication.
 */
export const PROTECTED_ROUTES = [
  ROUTES.DASHBOARD,
  ROUTES.DAILY_LOG,
  ROUTES.KNOWLEDGE,
  ROUTES.PRACTICE,
  ROUTES.REVISION,
  ROUTES.INSIGHTS,
  ROUTES.DIAGNOSTIC,
  ROUTES.ONBOARDING,
] as const;

/**
 * Routes that are only accessible when NOT authenticated.
 */
export const AUTH_ROUTES = [ROUTES.LOGIN, ROUTES.SIGNUP] as const;
