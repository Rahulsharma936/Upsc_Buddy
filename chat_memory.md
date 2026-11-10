# UPSC Prep App — Master Chat Memory & Knowledge Base

> **Single Source of Truth** for project architecture, AI token metrics, cost models, and conversation decisions.  
> *Last Updated: October 2026*

---

## 📑 Table of Contents
1. [App Architecture & Status (Bird's Eye View)](#1-app-architecture--status-birds-eye-view)
2. [AI vs. Deterministic Feature Boundaries](#2-ai-vs-deterministic-feature-boundaries)
3. [Baseline Token Estimate (Groq / Light Workload)](#3-baseline-token-estimate-groq--light-workload)
4. [Heavy Usage Analysis (Claude Sonnet 4 — $35.34/mo)](#4-heavy-usage-analysis-claude-sonnet-4--3534mo)
5. [The $4/Month Optimization Blueprint (~$3.40/mo)](#5-the-4month-optimization-blueprint-340mo)
6. [Key Architectural Decisions & Learnings](#6-key-architectural-decisions--learnings)

---

## 1. App Architecture & Status (Bird's Eye View)

**UPSC Buddy** is an intelligent preparation tutor following the loop:  
**Study → Practice → Diagnose → Repair → Repeat**.

### The 3 Core Subsystems:
1. **📚 Learning Engine (`/daily-log`, `/knowledge`, `/practice`, `/revision`, `/insights`)**
   - **Daily Log**: Student inputs study entries; AI extracts concepts.
   - **Concept Hydration**: Generates detailed notes, relationship graphs, GS context, and questions (MCQs, Mains, Interview).
   - **Practice**: Daily 6-concept MCQ practice sessions backed by a modified **SM-2 spaced repetition** algorithm.
   - **Revision**: Review due concepts with confidence self-assessment.
   - **Insights**: Heatmaps, mastery progression (`new` → `learning` → `reviewing` → `mastered`), and study streak analytics.

2. **🩺 Diagnostic Engine (`/diagnostic`)**
   - Analyzes 25+ behavioral and performance features across 4 gap types:
     - 🔴 **Concept Gap**: Core misunderstanding (high error rate, consecutive fails).
     - 🟡 **Memory Gap**: Retention decay over time (declining accuracy after long interval).
     - 🟣 **Calibration Gap**: Mismatch between confidence and actual accuracy.
     - 🔵 **Revision Gap**: Inconsistent review cadence / skipped practice.

3. **🔧 Repair Engine (Backend Built ✅ · UI Integrated in Practice & Revision ✅ · Post-Repair Orchestration Pending 🚧)**
   - Routes diagnosed gaps to specialized pedagogical executors across 7 failure modes:
     - *Concept Gap* → **Concept Teaching Executor** (AI-guided re-explanation)
     - *Memory Gap* → **Active Recall Executor** (cued retrieval exercises)
     - *Calibration Gap* → **Calibration / Uncertainty Resolution**
     - *Process / Question Gap* → **Question Interpretation / Error Awareness**
     - *Uncertain* → **Clarification Executor**
   - APIs: `POST /api/repair`, `POST /api/repair/understanding`, `POST /api/repair/verify`.

---

## 2. AI vs. Deterministic Feature Boundaries

To keep costs predictable and latency minimal, **only 3 user actions hit an LLM**. Everything else is 100% deterministic code.

| Feature | Uses AI? | Implementation Mechanism |
|---|:---:|---|
| Concept Extraction | ✅ YES | 1 LLM call per study log submission |
| Concept Hydration (Notes, Graph, GS, Qs) | ✅ YES | 4 layers (or 1 consolidated pass) per new concept |
| Repair Explanations | ✅ YES | 1 LLM call per repair request |
| Bot Chat (Future) | ✅ YES | Conversational LLM session |
| **Spaced Repetition (SM-2)** | ❌ NO | Pure algorithmic scheduling |
| **Practice Session Loading** | ❌ NO | Deterministic SQL/inventory query |
| **Diagnostic Scoring** | ❌ NO | Weighted formula scoring over 25+ telemetry metrics |
| **Adaptive Insights** | ❌ NO | SQL aggregations & deterministic analytics |
| **MCQ Grading & Verification** | ❌ NO | Deterministic DB write & comparison |

---

## 3. Baseline Token Estimate (Groq / Light Workload)

*Initial baseline calculated for 1 active student studying 26 days/month (~200 new concepts, ~110 repairs, ~40 logs):*

| Action | Monthly Volume | Input Tokens | Output Tokens | Total Tokens |
|---|---:|---:|---:|---:|
| Concept Extraction | 40 logs | 30,000 | 20,000 | 50,000 |
| Concept Hydration | 200 concepts | 516,000 | 430,000 | 946,000 |
| Repairs | 110 repairs | 66,000 | 44,000 | 110,000 |
| **Monthly Total** | — | **~612,000** | **~494,000** | **~1,106,000 (~1.1M)** |

* **Cost on Groq (`openai/gpt-oss-120b` or Llama 3.3 70B)**:
  * Input: $0.15 / 1M | Output: $0.60 / 1M
  * **Monthly Cost**: **~$0.39 / student / month**

---

## 4. Heavy Usage Analysis (Claude Sonnet 4 — $35.34/mo)

*Parameters for an intensive student:*
- **10 logs/day** (300/mo)
- **20 concepts/day** (600/mo)
- **10 repairs/day** (300/mo)
- **15 practice questions/day** (450/mo) — *Generated during hydration, served from DB for $0.00*
- **20 min bot chat/day** (600 min/mo, ~15 messages/session)

### The Raw Claude Sonnet 4 Bill ($3.00/M in, $15.00/M out):
| Component | Monthly Tokens | Input Cost | Output Cost | Total Cost | % of Bill |
|---|---:|---:|---:|---:|---:|
| **Concept Hydration** (600 concepts) | 2,838,000 | $4.64 | $19.35 | **$23.99** | **68%** |
| **Bot Chat** (20 min/day, 30 days) | 1,485,000 | $4.05 | $2.03 | **$6.08** | **17%** |
| **Concept Extraction** (300 logs) | 375,000 | $0.68 | $2.25 | **$2.93** | **8%** |
| **Repairs** (300 repairs) | 300,000 | $0.54 | $1.80 | **$2.34** | **7%** |
| **Practice Qs** (15/day) | 0 | $0.00 | $0.00 | **$0.00** | **0%** |
| **TOTAL** | **~5.0M Tokens** | **$9.91** | **$25.43** | **$35.34** | 100% |

> **Key Takeaway**: Concept Hydration alone accounts for nearly 70% of the cost due to high output token volume generated through Sonnet's $15.00/M tier.

---

## 5. The $4/Month Optimization Blueprint (~$3.40/mo)

**Goal**: Bring monthly costs down from **$35.34 → ~$3.40** without cutting any features, prompts, or pedagogical depth.

### The 4 Optimization Pillars:

1. **Intelligent Model Tiering (Worker vs. Mentor)**
   - **Claude Sonnet 4 for High-Touch Interactions**:
     - *Bot Chat*: Requires high EQ, tone moderation, and conversational reasoning.
     - *Repairs*: Requires nuanced understanding of misconceptions.
   - **Worker Model (Groq Llama-3.3-70B or Claude 3.5 Haiku) for Data Pipelines**:
     - *Concept Extraction*: Pure JSON entity extraction.
     - *Concept Hydration*: Structured syllabus generation. Fast models produce equivalent structured outputs at 1/20th the cost.

2. **Single-Pass Hydration Pipeline**
   - Merges the 4 separate calls (Notes, Graph, GS context, Questions) into **1 comprehensive JSON call**.
   - Eliminates redundant system prompt re-transmission and repetitive headers, cutting input tokens per concept by **~68%**.

3. **Anthropic Prompt Caching & Sliding Window on Chat**
   - Enables prompt caching on Claude Sonnet (Anthropic cache reads are **$0.30/M — a 90% discount**).
   - Implements a **6-message sliding window + 1 rolling summary** for the bot chat, preventing quadratic context growth during 20-minute sessions.

4. **Global Concept Registry (Cache-First Database)**
   - The UPSC syllabus has ~2,500 core canonical concepts.
   - Once a concept (e.g., *"Basic Structure Doctrine"*) is hydrated by any user, it is stored in the database.
   - Subsequent user requests retrieve it instantly at **0 ms for $0.00**.

### Optimized Cost Matrix:

| Feature | Volume / Month | Optimized Model Tier | Monthly Cost |
|---|---:|---|---:|
| **Concept Extraction** | 300 logs | Groq Llama-3.3-70B / Haiku | **$0.08** |
| **Concept Hydration + Qs** | 600 concepts | Groq Llama-3.3-70B (Single-pass JSON) | **$0.82** |
| **Repairs** | 300 repairs | Claude Sonnet 4 (Prompt Cached) | **$1.15** |
| **Bot Chat** | 30 sessions (20 min) | Claude Sonnet 4 (Sliding + Cached) | **$1.40** |
| **Practice Qs** | 450 served | Deterministic DB Query | **$0.00** |
| **TOTAL** | — | **Hybrid Architecture** | **~$3.45 / month** |

*(If restricted to a 100% Anthropic Claude stack with Claude 3.5 Haiku Batch API for hydration + Sonnet for Chat/Repairs, the cost is **~$4.30 / month**).*

---

## 6. Key Architectural Decisions & Learnings

1. **Practice Questions are Subsumed by Concept Hydration**:
   - Questions (MCQs, Mains, Interview) are created in Layer 4 of Concept Hydration.
   - Daily practice sessions simply fetch existing questions from the database. There is **no separate LLM cost** for doing practice sessions.
2. **Never Run Uncached Chat in Production**:
   - Multi-turn chat without prompt caching or context window truncation consumes up to 50,000 tokens per 20 minutes.
   - Always pin system instructions with cache breakpoints (`cache_control: {"type": "ephemeral"}`).
3. **Keep Algorithmic Logic Out of the LLM**:
   - Spaced repetition (SM-2), diagnostic scoring, and mastery metrics are computed deterministically in TypeScript/SQL. This keeps the core loop instantaneous, reliable, and completely free of LLM fees.

---

## 7. Diagnostic & Post-Practice Intelligence Loop Audit (October 2026)

### The Vision vs. Current Reality
**Intended Cognitive Flow**:
```
Practice tells the app what happened → Repair fixes the immediate problem →
Related learning reinforces it → Revision remembers it over time.
Practice → Evidence → Repair / Reinforcement → More learning material → Revision
```

**After-Practice Dynamic Reinforcement Needs**:
- **Notes**: Targeted micro-notes for concepts where the student actually struggled (NOT generic chapter dumps from Knowledge page).
- **More MCQs**: Follow-up questions on the same/related concept to verify knowledge transfer.
- **Dominoes**: Link concepts so learning one triggers/reveals the next relevant prerequisite or downstream concept.
- **PYQs**: Relevant UPSC past year questions highlighting exam relevance.
- **Active Recall / Fill-in-the-blank**: Targeted retrieval drills when memory retrieval is the bottleneck.
- **Mains Analytical Drills**: Answer-writing reasoning prompts when deeper conceptual analysis is needed.
- **Revision Scheduling**: Explicitly feeding into the future revision queue with transparent scheduling feedback.

### Audit Discoveries
1. **Diagnostic Page (`/dashboard/diagnostic`)**:
   - **UUID Display**: `diagnostic.service.ts` groups by `conceptId` but never queries `concepts` for `displayName`. Frontend truncates UUIDs (`75d55a3b...`).
   - **"All Red" Dead End**: Scores gaps accurately, but offers zero action buttons (no "Practice", "Repair", "Read Notes").
   - **Diagnostic (R2) vs Repair (R3) Disconnect**: The 4 diagnostic gap types do not map directly to the 7 repair failure reasons, and repairs cannot be launched from the diagnostic page.
2. **Post-Practice Termination**:
   - In `PracticeCard.tsx`, after an MCQ is missed, repaired, verified, and self-assessed, the flow halts with a static one-liner (`"Repair complete"` or `"Left for revision"`).
   - Knowledge `NoteCard` and Practice `Mains questions` are static, pre-generated batch assets, NOT the dynamic post-practice reinforcement intended.
   - Fill-in-the-blank drills do not yet exist.

### Action Roadmap for Next Session
1. **Phase 1: Diagnostic Usability Fixes**:
   - Resolve concept names in `diagnostic.service.ts` from `concepts` table.
   - Add action buttons per gap type in `DiagnosticView.tsx`.
2. **Phase 2: Post-Practice Orchestrator**:
   - Build a post-practice session engine that consumes student performance + failure reasons + gap classification.
   - Dynamically generate and serve: targeted micro-notes, transfer MCQs, concept dominoes, relevant PYQs, fill-in-the-blank retrieval drills, and mains reasoning prompts.
   - Display explicit spaced-repetition revision scheduling feedback.

