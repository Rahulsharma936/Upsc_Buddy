# UPSC Buddy — Architecture Documentation

> **Purpose:** Living technical knowledge base for the UPSC Buddy application.
> **Principle:** Read documentation first → inspect source only when needed → update docs after changes.

---

## Documentation Index

### Core Architecture

| Document | Description | Last Updated |
|---|---|---|
| [Application Overview](architecture/application-overview.md) | Complete system audit: tech stack, folder structure, modules, user journey, database schema, AI pipeline, state management, API routes, layered architecture | 2026-07-16 |
| [Learning Engine (Part 1)](architecture/learning-engine-part1.md) | Student learning model, concept mastery deep dive, SM-2 implementation, practice intelligence lifecycle, learner adaptive profile | 2026-07-16 |
| [Learning Engine (Part 2)](architecture/learning-engine-part2.md) | Student signals inventory, dashboard calculations, AI decision logic (9 decisions), hidden scores, repair system readiness | 2026-07-16 |
| [Behavioral Telemetry](architecture/behavioral-telemetry.md) | Complete interaction inventory, event tracking, revision events, MCQ tracking coverage, timing signals, dead-end interactions, telemetry coverage matrix, diagnostic evidence matrix | 2026-07-25 |
| [Repair System](architecture/repair-system.md) | Repair readiness assessment, chronological repair log (4 repairs), known remaining issues, repair design principles | 2026-07-25 |

### Decisions

| Document | Description |
|---|---|
| [ADR-001: Evidence Model](architecture/decisions/ADR-001-evidence-model.md) | 7 key architectural decisions: inventory-first JOIN, fire-and-forget mastery, attempt-count rotation, cache-bust strategy, engine vs service naming, modified SM-2, Drizzle ORM |

### Setup

| Document | Description |
|---|---|
| [Setup Guide](setup.md) | Prerequisites, Supabase setup, environment variables, installation, verification |

---

## Documentation Workflow

```
Existing Documentation
        ↓
Understand Current Architecture
        ↓
Inspect Only Relevant Source Files
        ↓
Implement / Design Current Phase
        ↓
Verify Behavior
        ↓
Update Documentation
        ↓
Future Phase Reads Updated Documentation
```

### When to Update Documentation

Update the relevant document(s) when a phase changes:
- Architecture or system design
- Database schema (tables, fields, indexes)
- Learning engine behavior (SM-2, scoring, surfacing)
- Telemetry coverage (new events, new dead-ends fixed)
- API routes or data flows
- Repair/fix implementations

### What to Record

- What changed and why
- New tables, fields, events, or signals
- Changed data flows or dependencies
- Removed or deprecated behavior
- Relevant files and functions
- Date of change

---

## Quick Reference

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL (Supabase) |
| ORM | Drizzle ORM |
| Auth | Supabase Auth (@supabase/ssr) |
| AI | Multi-provider (Groq active, Gemini/Ollama configured) |
| State | Zustand (client), Server Components (server) |
| UI | Tailwind CSS 4, shadcn/ui, Lucide icons |
| Validation | Zod 4 |

### Database Tables (18)

| Category | Tables |
|---|---|
| **User** | `profiles` |
| **Study Input** | `daily_logs` |
| **AI Extraction** | `concepts`, `ai_processing_jobs`, `ai_notes` |
| **Intelligence** | `concept_relationships`, `concept_context_intelligence`, `concept_questions` |
| **PYQ** | `pyqs`, `pyq_concept_matches` |
| **Ontology** | `gs_papers`, `syllabus_domains`, `syllabus_subtopics`, `concept_syllabus_links` |
| **Learning** | `concept_mastery`, `revision_events`, `learner_adaptive_profile` |

### Key Data Flows

```
Study Log → Concept Extraction → Cognitive Orchestration Pipeline
  ├─ Notes → Relationships → PYQs → Context → Questions → Revision Init
  └─ Adaptive Intelligence Refresh

Practice: Inventory JOIN → Mastery Signals → Surfacing Engine → Daily Set (6 concepts)

MCQ Answer → Fire-and-forget POST /api/revision → SM-2 → Mastery Update

Revision: Due query → Priority scoring → Recommendations (top 15)
```

### Known System Gaps (for future phases)

1. Mains/Interview questions are display-only (zero tracking)
2. Revision page is read-only (no review/skip buttons)
3. No student-reported confidence or self-assessment UI
4. No response timing or session duration tracking
5. No automatic hydration for historical concepts
6. No test files anywhere in the codebase
7. `skip` and `self_assessment` event types exist but have no UI triggers
