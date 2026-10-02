# Behavioral Telemetry & Interaction Audit

> **Last Updated:** 2026-07-25
> **Original Audit:** 2026-07-24 (Phase 3)
> **Status:** Living document — update after any telemetry changes

---

## 1. Student Interaction Inventory

| # | Interaction | UI Component | Persisted? | Learning State Affected? |
|---|---|---|---|---|
| 1 | Submit daily study log | `DailyLogForm.tsx` | ✅ `daily_logs` | Indirectly — triggers concept extraction |
| 2 | Answer MCQ (Prelims) | `PracticeCard.tsx` | ✅ `revision_events` + `concept_mastery` | ✅ mastery, confidence, SM-2, weak area |
| 3 | Expand Prelims MCQ section | `PracticeCard.tsx` | ❌ | ❌ |
| 4 | View MCQ explanation | `PracticeCard.tsx` | ❌ | ❌ |
| 5 | Expand Mains section | `PracticeCard.tsx` | ❌ | ❌ |
| 6 | Read Mains question + guidance | `PracticeCard.tsx` | ❌ | ❌ |
| 7 | Expand Interview section | `PracticeCard.tsx` | ❌ | ❌ |
| 8 | Read Interview prompt | `PracticeCard.tsx` | ❌ | ❌ |
| 9 | Expand/collapse NoteCard | `NoteCard.tsx` | ❌ | ❌ |
| 10 | View RelatedConcepts | `RelatedConcepts.tsx` | ❌ (read only) | ❌ |
| 11 | View PYQ matches | `PYQSection.tsx` | ❌ (read only) | ❌ |
| 12 | Trigger note generation | `NoteCard.tsx` | ✅ `ai_notes` | ❌ |
| 13 | Browse revision recommendations | `RevisionList.tsx` | ❌ (read only) | ❌ |
| 14 | Toggle revision stats panel | `RevisionList.tsx` | ❌ | ❌ |
| 15 | Initialize revision backfill | `RevisionList.tsx` | ✅ `concept_mastery` | ✅ mastery rows created |
| 16 | Sign out | `DashboardSidebar.tsx` | Session cleared | ❌ |
| 17 | Navigate between pages | Sidebar links | ❌ | ❌ |

**10 of 17 total interactions are dead-ends** (produce no persistent signals).

---

## 2. Persisted Events

| Event | Trigger | Destination Table | Key Payload | Downstream Consumers |
|---|---|---|---|---|
| Daily log creation | Submit study log | `daily_logs` | `rawInput, subjects[], concepts[], date` | Concept extraction pipeline |
| Concept extraction | AI pipeline after log | `concepts` | `displayName, subject, difficulty, confidence, sourceLogId` | Notes, questions, mastery, revision |
| MCQ attempt | Answer MCQ in Practice | `revision_events` | `conceptId, eventType:"mcq_attempt", qualityRating, mcqCorrect, mcqQuestionIndex` | SM-2 engine → mastery update |
| Mastery state change | After MCQ attempt | `concept_mastery` | Full SM-2 state | Practice surfacing, revision recommendations |
| Mastery initialization | Backfill/orchestration | `concept_mastery` | Default SM-2 state | Revision scheduling |
| AI job tracking | Any AI operation | `ai_processing_jobs` | `jobType, status, timestamps` | Observability only |

### Events NOT Persisted

- Page navigation, section expand/collapse, note viewing, PYQ viewing, relationship viewing, Mains/Interview viewing, revision browsing, session start/end

---

## 3. Revision Event Schema

**Table:** `revision_events`

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `userId` | UUID FK | Who |
| `conceptId` | UUID FK | What concept |
| `eventType` | text | Event classification |
| `qualityRating` | integer | SM-2 quality (0-5) |
| `mcqCorrect` | boolean | MCQ correctness |
| `mcqQuestionIndex` | integer | Which question in the array |
| `eventMetadata` | JSONB | Previous/new interval, ease factor |
| `createdAt` | timestamp | When |

### Event Types

| Type | Trigger | UI Exists? |
|---|---|---|
| `mcq_attempt` | User clicks MCQ option in Practice | ✅ Yes |
| `skip` | `POST /api/revision` with `action: "skip"` | ❌ **Dead code — no UI button** |
| `review` | `POST /api/revision` with `action: "review"` | ❌ **Dead code — no UI button** |
| `self_assessment` | `POST /api/revision` with `action: "self_assessment"` | ❌ **Dead code — no UI** |

---

## 4. MCQ Tracking Coverage

| Signal | Status |
|---|---|
| Question identifier (concept) | ✅ Tracked |
| Question index within concept | ✅ Tracked |
| Selected option | ❌ Not tracked (only `mcqCorrect` boolean) |
| Correct/incorrect | ✅ Tracked |
| Attempt timestamp | ✅ Tracked |
| Question difficulty | ❌ Not tracked |
| Response time | ❌ Not tracked |
| Confidence before/after | ❌ Not tracked |

### Mains & Interview: **Zero tracking** — completely display-only

---

## 5. Timing Signals

### Genuine Behavioral Timing

| Signal | Exists? |
|---|---|
| `lastReviewedAt` | ✅ `concept_mastery.last_reviewed_at` |
| `nextReviewAt` | ✅ `concept_mastery.next_review_at` |
| MCQ answer timestamp | ✅ `revision_events.created_at` |
| Daily log date | ✅ `daily_logs.date` |

### Completely Missing

- Time spent answering MCQ, reading notes, on practice page
- Session duration, reading time for explanations

---

## 6. Dead-End Interactions

| # | Interaction | Persistent Signal? |
|---|---|---|
| 1 | Read AI notes | ❌ None |
| 2 | View PYQ matches | ❌ None |
| 3 | View related concepts | ❌ None |
| 4 | Read Mains question | ❌ None |
| 5 | Read Interview prompt | ❌ None |
| 6 | Read MCQ explanation | ❌ None |
| 7 | Browse revision list | ❌ None |
| 8 | View revision stats | ❌ None |
| 9 | Navigate between pages | ❌ None |
| 10 | View Insights dashboard | ❌ None |

---

## 7. Telemetry Coverage Matrix

| Surface | Interaction Data | Performance Data | Timing Data | Historical Data | Self-Reported Data |
|---|---|---|---|---|---|
| Daily Log | ✅ Strong | ❌ Missing | 🟡 Partial (date only) | ✅ Strong | ❌ Missing |
| Knowledge/Notes | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing |
| Practice MCQ | ✅ Strong | ✅ Strong | 🟡 Partial (timestamp only) | ✅ Strong (event log) | ❌ Missing |
| Practice Mains | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing |
| Interview | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing |
| Revision | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing |
| Insights | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing | ❌ Missing |

---

## 8. Diagnostic Evidence Matrix

| Problem Category | Evidence Level | Available Signals |
|---|---|---|
| **Knowledge Problem** (doesn't understand) | 🟡 Partial | Repeated incorrect MCQs. Cannot distinguish from misread question. |
| **Memory Problem** (knew but forgot) | 🟡 Partial | Correct → later incorrect in events. No self-reported recall. |
| **Application Problem** (knows but can't apply) | 🔴 None | MCQs test recall, not application. Mains produce zero data. |
| **Question Interpretation Problem** | 🔴 None | Selected option not stored. |
| **Mains Answer-Writing Problem** | 🔴 None | No answer input/evaluation. |
| **Confidence/Calibration Problem** | 🔴 None | No student-reported confidence. |
| **Revision Problem** | 🔴 None | Revision page read-only. |
| **Avoidance/Engagement Problem** | 🟡 Partial | Could infer from surfaced-but-unanswered. |

---

## 9. Collected-but-Unused Data

| Data | Stored In | NOT Consumed By |
|---|---|---|
| `mcqQuestionIndex` | `revision_events` | Per-question difficulty estimation |
| `eventMetadata.previousEase/newEase` | `revision_events` | Ease factor trajectory |
| `concepts.extractionMetadata` | `concepts` | Nothing |
| `concepts.keywords[]` | `concepts` | Search, matching, recommendations |
| `daily_logs.concepts[]` (manual) | `daily_logs` | Nothing — AI extraction replaces |
| `learner_adaptive_profile.conceptGaps` | `learner_adaptive_profile` | Question generation or surfacing |

---

## 10. Exploitable Historical Data

1. **`revision_events`** — append-only log with before/after SM-2 state. Can reconstruct mastery trajectory.
2. **`daily_logs` date patterns** — study consistency, frequency, subject distribution over time.
3. **Cross-referencing surfaced concepts with events** — identify implicit avoidance signals.
4. **`concepts.createdAt` vs first `revision_events.createdAt`** — time-to-first-practice per concept.
5. **`mcqQuestionIndex` across events** — within-question learning signal.
