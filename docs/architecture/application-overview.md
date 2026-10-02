# Phase 1 — Complete Application Overview

> **Audit Date:** 2026-07-16
> **Auditor:** Senior Architecture Review
> **Codebase:** `Rahulsharma936/Upsc_Buddy`
> **Status:** Read-only audit — no modifications made

---

## 1. Executive Overview

### What This Application Does

UPSC Prep (UPSC Buddy) is an **AI-powered UPSC Civil Services Examination preparation platform**. It helps aspirants track daily study sessions, automatically extract concepts from study logs using AI, generate revision-optimized notes, create practice questions, schedule spaced-repetition reviews, and surface adaptive intelligence about preparation gaps.

### Primary Purpose

Replace passive note-taking with an **intelligent learning loop**: the student logs what they studied → AI extracts concepts → generates revision notes, practice questions, PYQ matches, and relationship maps → a spaced-repetition engine schedules reviews → adaptive analytics highlight gaps.

### Major Capabilities

| Capability | Description |
|---|---|
| **Authentication** | Email/password signup & login via Supabase Auth |
| **Onboarding** | 3-step wizard (exam info, subject priorities, study preferences) |
| **Daily Study Logging** | Free-text study log with subject tagging |
| **AI Concept Extraction** | LLM extracts UPSC-relevant concepts from study logs |
| **Cognitive-Compression Notes** | AI generates 5-section rapid-revision notes per concept |
| **Relationship Intelligence** | AI discovers cross-concept UPSC-relevant relationships |
| **PYQ Matching** | Maps concepts to Previous Year Questions |
| **Context Intelligence** | AI generates multi-dimensional analytical context (constitutional, governance, ethical, etc.) |
| **Question Generation** | AI creates Prelims MCQs, Mains questions, Interview prompts |
| **Spaced Repetition** | Modified SM-2 algorithm for revision scheduling |
| **Adaptive Intelligence** | Subject strength profiling, syllabus coverage, gap detection, recommendations |
| **Cognitive Orchestration** | Automated pipeline: Concept → Notes → Relationships → PYQs → Context → Questions → Revision |

### Overall Architecture

- **Framework:** Next.js 16 (App Router, Server Components)
- **Language:** TypeScript
- **Database:** PostgreSQL (Supabase-hosted)
- **ORM:** Drizzle ORM
- **Auth:** Supabase Auth (@supabase/ssr)
- **AI:** Multi-provider (Groq active, Gemini/Ollama/OpenAI/Anthropic configured)
- **State:** Zustand (client), Server Components (server)
- **UI:** Tailwind CSS 4, shadcn/ui, Lucide icons
- **Validation:** Zod 4

---

## 2. Folder Structure Overview

```
Upsc_app_2/
├── src/
│   ├── app/                    # Next.js App Router (pages, layouts, API routes)
│   │   ├── (auth)/             # Auth route group (login, signup)
│   │   ├── api/                # API Route Handlers (21 route files)
│   │   ├── dashboard/          # Protected dashboard pages (6 sub-routes)
│   │   └── onboarding/         # Onboarding wizard page
│   ├── components/
│   │   ├── features/           # Feature-specific components (8 feature groups)
│   │   ├── shared/             # Reusable shared components (3 files)
│   │   └── ui/                 # shadcn/ui primitives (14 components)
│   ├── hooks/                  # Custom React hooks (2 files)
│   ├── lib/
│   │   ├── ai/                 # AI infrastructure (providers, services, utils)
│   │   ├── constants/          # App config, routes, subjects
│   │   ├── db/                 # Drizzle DB client, schema, seeds
│   │   ├── ontology/           # UPSC syllabus ontology helpers
│   │   ├── repositories/       # Data access layer (13 repositories)
│   │   ├── services/           # Business logic services (3 files)
│   │   ├── supabase/           # Supabase client/server/middleware
│   │   ├── utils/              # API response helpers, errors, dates
│   │   └── validations/        # Zod schemas for forms
│   ├── stores/                 # Zustand stores (2 files)
│   ├── types/                  # TypeScript type definitions (5 files)
│   └── proxy.ts                # Route protection middleware
├── supabase/
│   └── migrations/             # 17 SQL migration files
├── docs/                       # Documentation
├── drizzle.config.ts           # Drizzle ORM configuration
├── next.config.ts              # Next.js configuration
└── package.json                # Dependencies
```

### Key Folder Responsibilities

| Folder | Responsibility |
|---|---|
| `src/app/` | Route definitions, page components, API handlers, layouts |
| `src/components/features/` | Domain-specific UI: auth forms, daily-log, dashboard, notes, practice, revision, insights, onboarding |
| `src/components/ui/` | shadcn/ui design system primitives |
| `src/lib/ai/` | **Entire AI subsystem**: providers, services (14 service files), prompts, schemas, utilities |
| `src/lib/db/` | Database connection (lazy-initialized Proxy pattern), Drizzle schema (18 tables), seed data |
| `src/lib/repositories/` | Repository pattern — data access layer, one per domain entity |
| `src/lib/services/` | Business logic (auth, daily-log, profile) |
| `src/lib/supabase/` | Supabase client creation (browser, server, middleware) |
| `src/lib/ontology/` | UPSC syllabus ontology: paper/domain/subtopic queries |
| `src/stores/` | Zustand client-side state (onboarding wizard, UI sidebar) |
| `supabase/migrations/` | PostgreSQL DDL migrations (sequential, numbered) |

---

## 3. Major Functional Modules

### 3.1 Authentication

- **Purpose:** User signup, login, logout, session management
- **Flow:** Email/password → Supabase Auth → profile auto-created via Postgres trigger → session cookie
- **Key Files:** `src/lib/services/auth.service.ts`, `src/app/api/auth/*/route.ts`, `src/hooks/use-auth.ts`, `src/components/features/auth/`
- **Dependencies:** Supabase Auth, profile repository

### 3.2 Onboarding

- **Purpose:** Collect exam target, study mode, subject priorities, study preferences
- **Flow:** 3-step wizard → POST /api/onboarding → profile updated with preferences
- **Key Files:** `src/app/onboarding/page.tsx`, `src/components/features/onboarding/`, `src/stores/onboarding.store.ts`
- **Dependencies:** Profile service, Zustand store

### 3.3 Dashboard

- **Purpose:** Central hub showing welcome, quick stats, navigation, recent activity
- **Flow:** Server Component fetches profile + recent logs + stats → renders 4 sub-components
- **Key Files:** `src/app/dashboard/page.tsx`, `src/components/features/dashboard/`
- **Dependencies:** Profile repository, daily-log service

### 3.4 Daily Log (Study Input)

- **Purpose:** Record daily study sessions with free-text and subject selection
- **Flow:** Form submission → POST /api/daily-log → concept extraction triggered
- **Key Files:** `src/app/dashboard/daily-log/page.tsx`, `src/components/features/daily-log/`, `src/hooks/use-daily-log.ts`
- **Dependencies:** Daily-log service/repository, AI concept extraction

### 3.5 Knowledge (Notes & Concepts)

- **Purpose:** View extracted concepts with AI-generated revision notes, PYQ matches, related concepts
- **Flow:** GET /api/notes → concepts + latest notes → NotesList renders NoteCard with expandable sections
- **Key Files:** `src/app/dashboard/knowledge/page.tsx`, `src/components/features/notes/`
- **Dependencies:** Concept repository, note repository, PYQ matches, relationships

### 3.6 Practice (Question Intelligence)

- **Purpose:** UPSC-authentic practice questions (Prelims MCQs, Mains, Interview) curated daily
- **Flow:** GET /api/practice → question surfacing engine selects daily set from inventory → PracticeList renders
- **Key Files:** `src/app/dashboard/practice/page.tsx`, `src/components/features/practice/`, `src/lib/ai/services/question-surfacing.engine.ts`
- **Dependencies:** Question inventory, revision mastery, concept repository

### 3.7 Revision (Spaced Repetition)

- **Purpose:** Schedule and track concept reviews using modified SM-2 algorithm
- **Flow:** GET /api/revision?action=recommendations → priority-ranked list → POST records review events
- **Key Files:** `src/app/dashboard/revision/page.tsx`, `src/components/features/revision/RevisionList.tsx`, `src/lib/ai/services/spaced-repetition.engine.ts`, `src/lib/ai/services/revision-intelligence.service.ts`
- **Dependencies:** Concept mastery, revision events, spaced-repetition engine

### 3.8 Insights (Adaptive Intelligence)

- **Purpose:** Meta-cognitive analytics: subject strengths, syllabus coverage, gaps, recommendations
- **Flow:** GET /api/adaptive?action=profile → 6 pure-function engines compute analytics
- **Key Files:** `src/app/dashboard/insights/page.tsx`, `src/components/features/insights/InsightsDashboard.tsx`, `src/lib/ai/services/adaptive-intelligence.engine.ts`, `src/lib/ai/services/adaptive-intelligence.service.ts`
- **Dependencies:** Concepts, mastery records, syllabus ontology, learner adaptive profile

### 3.9 AI Pipeline (Cognitive Orchestration)

- **Purpose:** Automated intelligence lifecycle for every concept
- **Flow:** Concept → Notes → Relationships → PYQs → GS/Context → Questions → Revision (each layer isolated)
- **Key Files:** `src/lib/ai/services/cognitive-orchestration.service.ts`, all 14 AI service files
- **Dependencies:** All repositories, AI provider, prompts

### 3.10 Health Check

- **Purpose:** Keep Supabase free-tier database active via periodic pings
- **Key Files:** `src/app/api/health/route.ts`
- **Dependencies:** Database connection

### Modules That Do NOT Exist

- ❌ Admin panel
- ❌ Subscription / payments
- ❌ Settings page
- ❌ Profile editing UI
- ❌ Concept graph visualization
- ❌ Background job workers (orchestration is fire-and-forget in API routes)
- ❌ Cron jobs (external service hits /api/health)
- ❌ Real-time / WebSocket features

---

## 4. User Journey

```
┌─────────────┐
│   Landing    │  Root page (/) checks auth state
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│   Login     │◄───►│   Signup     │  Email/password via Supabase Auth
└──────┬──────┘     └──────┬───────┘
       │                    │
       │                    ▼
       │            ┌──────────────┐
       │            │  Onboarding  │  3-step wizard (exam, subjects, preferences)
       │            └──────┬───────┘
       │                   │
       ▼                   ▼
┌──────────────────────────────────┐
│           Dashboard              │  Welcome, stats, navigation, recent activity
└──────┬───────────────────────────┘
       │
       ├──► Daily Log ──► [AI Extraction] ──► Concepts created
       │         │                                    │
       │         │         ┌──────────────────────────┘
       │         │         ▼ (background orchestration)
       │         │    Notes → Relationships → PYQs → Context → Questions → Revision
       │         │
       ├──► Knowledge ──► View concepts, notes, PYQ matches, relationships
       │
       ├──► Practice ──► Daily curated MCQs, Mains, Interview questions
       │
       ├──► Revision ──► Spaced repetition reviews, mastery tracking
       │
       └──► Insights ──► Subject strengths, coverage, gaps, recommendations
```

**Key transitions:**
- Unauthenticated users → redirected to `/login`
- Authenticated users on auth pages → redirected to `/dashboard`
- Incomplete onboarding → redirected to `/onboarding`
- `/dashboard/notes` → redirected to `/dashboard/knowledge` (legacy compat)

---

## 5. Database Overview

### Technology

- **Engine:** PostgreSQL (hosted on Supabase)
- **ORM:** Drizzle ORM (postgres-js driver)
- **Connection:** Lazy-initialized singleton via Proxy pattern, connection pooling (max 10)
- **Migrations:** 17 sequential SQL files in `supabase/migrations/`

### Major Entities (18 tables)

| Entity | Table | Purpose |
|---|---|---|
| **profiles** | `profiles` | User profile, preferences (JSONB), onboarding status |
| **dailyLogs** | `daily_logs` | Study session entries (raw text, subjects, concepts) |
| **concepts** | `concepts` | AI-extracted study concepts (normalized name, subject, keywords, confidence) |
| **aiProcessingJobs** | `ai_processing_jobs` | Job tracking for AI pipelines (status, retries, metadata) |
| **aiNotes** | `ai_notes` | AI-generated revision notes (5 sections, versioned) |
| **conceptRelationships** | `concept_relationships` | Cross-concept links (type, reason, strength) |
| **pyqs** | `pyqs` | Previous Year Questions (seeded data) |
| **pyqConceptMatches** | `pyq_concept_matches` | Concept ↔ PYQ mappings (match score) |
| **gsPapers** | `gs_papers` | GS Paper definitions (ontology) |
| **syllabusDomains** | `syllabus_domains` | Syllabus domain hierarchy |
| **syllabusSubtopics** | `syllabus_subtopics` | Syllabus subtopic leaf nodes |
| **conceptSyllabusLinks** | `concept_syllabus_links` | Concept ↔ Syllabus mappings |
| **conceptContextIntelligence** | `concept_context_intelligence` | Multi-dimensional analytical context per concept |
| **conceptQuestions** | `concept_questions` | AI-generated questions (MCQs, Mains, Interview) |
| **conceptMastery** | `concept_mastery` | SM-2 mastery state per user per concept |
| **revisionEvents** | `revision_events` | Individual review/skip/MCQ attempt records |
| **learnerAdaptiveProfile** | `learner_adaptive_profile` | Cached adaptive intelligence profile |

### Data Organization

- Row-Level Security (RLS) policies defined in migration `00003`
- User-scoped: all data keyed by `user_id` (UUID from Supabase Auth)
- Ontology tables (gs_papers, syllabus_domains, subtopics) are shared/seeded data
- PYQs are seeded via migration `00011`
- Profile auto-created via Postgres trigger on auth.users insert

---

## 6. AI Overview

### AI Providers

| Provider | Status | Default Model |
|---|---|---|
| **Groq** | **Active** (current .env) | `llama-3.3-70b-versatile` |
| **Gemini** | Implemented | `gemini-2.0-flash` |
| **Ollama** | Implemented | `qwen2.5:7b` |
| **OpenAI** | Config only (no provider class) | `gpt-4o-mini` |
| **Anthropic** | Config only (no provider class) | `claude-sonnet-4-20250514` |

### AI Services (14 files in `src/lib/ai/services/`)

| Service | Purpose |
|---|---|
| `concept-extraction.service.ts` | Extract UPSC concepts from study log text |
| `note-generation.service.ts` | Generate 5-section cognitive-compression revision notes |
| `relationship-extraction.service.ts` | Discover cross-concept relationships |
| `pyq-matching.service.ts` | Match concepts to Previous Year Questions |
| `context-intelligence.service.ts` | Generate multi-dimensional analytical context |
| `question-intelligence.service.ts` | Generate Prelims MCQs, Mains questions, Interview prompts |
| `gs-mapping.engine.ts` | Map concepts to GS papers/domains/subtopics |
| `revision-intelligence.service.ts` | Manage spaced repetition reviews and mastery |
| `spaced-repetition.engine.ts` | Modified SM-2 algorithm (pure functions) |
| `adaptive-intelligence.engine.ts` | 6 pure-function engines for adaptive analytics |
| `adaptive-intelligence.service.ts` | Service layer for adaptive intelligence |
| `cognitive-orchestration.service.ts` | Pipeline orchestrator (concept lifecycle) |
| `question-surfacing.engine.ts` | Daily practice set selection (pure functions) |
| `ai-processing.service.ts` | Job state management for AI pipelines |

### AI Pipeline Flow

```
Study Log Input
    │
    ▼
Concept Extraction (LLM)
    │
    ▼ (fire-and-forget orchestration)
    ├─► Note Generation (LLM)
    ├─► Relationship Extraction (LLM)
    ├─► PYQ Matching (deterministic + LLM)
    ├─► GS/Context Intelligence (LLM)
    ├─► Question Generation (LLM)
    └─► Revision Initialization (deterministic)
         │
         ▼
    Adaptive Intelligence Refresh (deterministic)
```

### AI Utilities (8 files in `src/lib/ai/utils/`)

- `json-repair.ts` — Repair malformed JSON from LLM output
- `confidence.ts` — Multi-signal confidence scoring
- `deduplication.ts` — Concept deduplication logic
- `normalize.ts` — Name normalization
- `note-normalize.ts` — Note content normalization
- `relationship-normalize.ts` — Relationship normalization
- `response-validator.ts` — Zod-based AI output validation
- `logger.ts` — Structured AI logging

---

## 7. State Management

| Mechanism | Where Used | Details |
|---|---|---|
| **Server Components** | Dashboard, Knowledge, Practice, Revision, Insights pages | Primary data fetching — DB queries in server components |
| **Zustand** | Onboarding wizard, sidebar toggle | `onboarding.store.ts` (multi-step form), `ui.store.ts` (sidebar state) |
| **Custom Hooks** | Auth operations, daily log CRUD | `use-auth.ts` (login/signup/logout via fetch), `use-daily-log.ts` (CRUD via fetch) |
| **Local Component State** | Form inputs, loading states | `useState` in client components |
| **URL State** | Query params in API routes | Filter/action parameters in API GET requests |

**Notable:** No React Context providers, no Redux, no React Query, no SWR. The app relies heavily on Server Components for data and Zustand for minimal client state.

---

## 8. Backend Architecture

### API Routes (21 route files)

| Route | Methods | Purpose |
|---|---|---|
| `/api/auth/signup` | POST | User registration |
| `/api/auth/login` | POST | User login |
| `/api/auth/logout` | POST | User logout |
| `/api/auth/session` | GET | Current session check |
| `/api/daily-log` | GET, POST | Create/read daily logs |
| `/api/daily-log/recent` | GET | Recent logs with stats |
| `/api/onboarding` | POST | Complete onboarding |
| `/api/notes` | GET | Concepts with notes |
| `/api/ai/extract-concepts` | POST | Trigger concept extraction |
| `/api/ai/generate-notes` | POST | Trigger note generation |
| `/api/ai/extract-relationships` | POST | Trigger relationship extraction |
| `/api/ai/gs-context` | POST | Trigger context intelligence |
| `/api/ai/questions` | POST | Trigger question generation |
| `/api/ai/jobs/[id]` | GET | Check AI job status |
| `/api/ai/orchestrate` | GET, POST | Cognitive orchestration / status check |
| `/api/ai/hydrate` | GET, POST | Historical hydration audit / execute |
| `/api/practice` | GET, POST | Daily practice set / backfill |
| `/api/revision` | GET, POST | Revision recommendations / record reviews |
| `/api/adaptive` | GET, POST | Adaptive intelligence profile |
| `/api/pyq-matches` | GET, POST | PYQ matching |
| `/api/health` | GET | Database health check |

### Request Flow

```
Client Request
    │
    ▼
Next.js Proxy (src/proxy.ts)
    ├─ Session refresh via Supabase middleware
    ├─ Route protection (protected vs auth pages)
    │
    ▼
API Route Handler (src/app/api/...)
    ├─ Authentication check (supabase.auth.getUser())
    ├─ Input validation (Zod schemas)
    │
    ▼
Service Layer (src/lib/services/)
    ├─ Business logic, validation, orchestration
    │
    ▼
Repository Layer (src/lib/repositories/)
    ├─ Drizzle ORM queries
    │
    ▼
Database (PostgreSQL via Supabase)
```

### Authentication Flow

1. **Signup:** Client → POST /api/auth/signup → `authService.signup()` → Supabase Auth `signUp()` → profile auto-created by Postgres trigger → redirect to /onboarding
2. **Login:** Client → POST /api/auth/login → `authService.login()` → Supabase Auth `signInWithPassword()` → fetch profile → redirect to /dashboard
3. **Session:** Supabase middleware refreshes session cookies on every request
4. **Protection:** `proxy.ts` checks auth state for protected/auth routes and redirects accordingly

### Layered Architecture

```
┌─────────────────────────────────────┐
│          UI Components              │  React Server + Client Components
├─────────────────────────────────────┤
│          Hooks / Stores             │  useAuth, useDailyLog, Zustand
├─────────────────────────────────────┤
│          API Routes                 │  Next.js Route Handlers
├─────────────────────────────────────┤
│          Services                   │  Business logic (auth, profile, daily-log)
├─────────────────────────────────────┤
│          AI Services                │  14 intelligence services + engines
├─────────────────────────────────────┤
│          Repositories               │  13 data access repositories
├─────────────────────────────────────┤
│          Database                   │  Drizzle ORM → PostgreSQL (Supabase)
└─────────────────────────────────────┘
```

---

## 9. Application Flow Diagram

```
                         ┌──────────────┐
                         │     User     │
                         └──────┬───────┘
                                │
                    ┌───────────▼───────────┐
                    │   Next.js Frontend    │
                    │  (Server Components   │
                    │   + Client Components)│
                    └───────────┬───────────┘
                                │
                 ┌──────────────┼──────────────┐
                 │              │              │
          ┌──────▼──────┐ ┌────▼────┐  ┌──────▼──────┐
          │ Proxy/Auth  │ │  Pages  │  │   Zustand   │
          │ Middleware   │ │ (SSR)   │  │   Stores    │
          └──────┬──────┘ └────┬────┘  └─────────────┘
                 │             │
                 ▼             ▼
          ┌────────────────────────────┐
          │      API Route Handlers    │
          │  (21 routes, auth-gated)   │
          └────────────┬───────────────┘
                       │
            ┌──────────┼──────────┐
            │          │          │
     ┌──────▼──┐  ┌────▼────┐ ┌──▼──────────┐
     │Services │  │  AI     │ │ Repositories│
     │(3 files)│  │Services │ │ (13 files)  │
     └────┬────┘  │(14 files)│ └──────┬──────┘
          │       └────┬────┘        │
          │            │             │
          │     ┌──────▼──────┐      │
          │     │ AI Providers│      │
          │     │(Groq/Gemini/│      │
          │     │ Ollama)     │      │
          │     └─────────────┘      │
          │                          │
          └──────────┬───────────────┘
                     │
              ┌──────▼──────┐
              │  PostgreSQL  │
              │  (Supabase)  │
              └──────────────┘
```

---

## 10. Dependency Map

```
Authentication
  └─► Profile Repository
       └─► Onboarding (preferences)

Daily Log
  └─► Concept Extraction (AI)
       └─► Cognitive Orchestration
            ├─► Note Generation (AI)
            ├─► Relationship Extraction (AI)
            ├─► PYQ Matching (AI + deterministic)
            ├─► Context Intelligence (AI)
            ├─► Question Generation (AI)
            └─► Revision Initialization (deterministic)
                 └─► Adaptive Intelligence Refresh

Knowledge Page
  ├─► Concept Repository
  ├─► Note Repository
  ├─► PYQ Match Repository
  └─► Relationship Repository

Practice Page
  ├─► Concept Questions Repository
  ├─► Question Surfacing Engine
  └─► Revision Repository (mastery signals)

Revision Page
  ├─► Revision Intelligence Service
  ├─► Spaced Repetition Engine
  └─► Concept Mastery Repository

Insights Page
  ├─► Adaptive Intelligence Service
  ├─► Adaptive Intelligence Engine (6 sub-engines)
  ├─► Concept Repository
  ├─► Concept Mastery Repository
  ├─► Syllabus Ontology
  └─► Learner Adaptive Profile Repository

All AI Services
  └─► AI Client (singleton)
       └─► AI Provider (Groq/Gemini/Ollama)
            └─► External LLM API
```

---

## 11. Potential Audit Areas

The following systems deserve deeper inspection in future phases:

| Area | Reason |
|---|---|
| **AI Pipeline Reliability** | 14 services with LLM calls — prompt quality, error handling, retry logic, JSON repair, timeout behavior |
| **Spaced Repetition Engine** | Modified SM-2 algorithm — correctness of interval calculations, mastery classification, weak-area detection |
| **Cognitive Orchestration** | Fire-and-forget background processing — no job queue, no worker, no retry persistence across server restarts |
| **Question Surfacing Engine** | Daily budget system, rotation logic, priority scoring — needs validation against real usage patterns |
| **Adaptive Intelligence** | 6 pure-function engines — correctness of strength scoring, coverage calculation, gap detection, recommendation generation |
| **Database Schema & Performance** | 18 tables, JSONB columns, index coverage, N+1 query patterns, RLS policy effectiveness |
| **AI Output Validation** | Zod schemas + JSON repair — edge cases in malformed LLM output, schema evolution strategy |
| **Prompt Engineering** | 5 prompt versions (2b.3, 2c.2, 2d.1, 3a.1, 3b.1) — prompt quality, hallucination control, output consistency |
| **Authentication & Security** | RLS policies, API route auth checks, environment variable exposure, session management |
| **Error Handling** | Typed error classes exist but graceful degradation patterns vary across routes |
| **Ontology System** | Static seed data + DB tables — coverage completeness, mapping accuracy |
| **Frontend UX** | Client components are thin wrappers — loading states, error states, empty states across all surfaces |
| **Hydration System** | Historical backfill for pre-orchestration concepts — pagination, progress tracking, idempotency |
| **Provider Abstraction** | Only 3 of 5 configured providers have implementations (Groq, Gemini, Ollama) |
| **Testing** | No test files found anywhere in the codebase |
| **Middleware** | `proxy.ts` exists but no `middleware.ts` at `src/` root — route protection may not be active via Next.js middleware |

---

## Summary

UPSC Buddy is a sophisticated, AI-heavy preparation platform built on a clean layered architecture (UI → Hooks/Stores → API Routes → Services → Repositories → Database). The AI subsystem is the most complex part, with 14 service files implementing a full cognitive lifecycle from concept extraction through adaptive intelligence. The application uses modern Next.js patterns (Server Components, App Router) with Zustand for minimal client state.

The codebase is well-organized with clear separation of concerns, consistent naming conventions, and comprehensive TypeScript typing. The main architectural risks are around the fire-and-forget AI orchestration (no persistent job queue), the absence of tests, and the potential for `proxy.ts` not being wired as Next.js middleware.
