/**
 * Database types — inferred from Drizzle schema.
 * Re-exported here for use across the application.
 */

import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import type {
  profiles,
  dailyLogs,
  concepts,
  aiProcessingJobs,
  aiNotes,
  conceptRelationships,
  pyqs,
  pyqConceptMatches,
  gsPapers,
  syllabusDomains,
  syllabusSubtopics,
  conceptSyllabusLinks,
  conceptContextIntelligence,
  conceptQuestions,
  conceptMastery,
  revisionEvents,
  learnerAdaptiveProfile,
} from "@/lib/db/schema";

// ─── Profiles ─────────────────────────────────────────────
export type Profile = InferSelectModel<typeof profiles>;
export type NewProfile = InferInsertModel<typeof profiles>;

// ─── Daily Logs ───────────────────────────────────────────
export type DailyLog = InferSelectModel<typeof dailyLogs>;
export type NewDailyLog = InferInsertModel<typeof dailyLogs>;

// ─── Concepts ─────────────────────────────────────────────
export type Concept = InferSelectModel<typeof concepts>;
export type NewConcept = InferInsertModel<typeof concepts>;

// ─── AI Processing Jobs ───────────────────────────────────
export type AIProcessingJob = InferSelectModel<typeof aiProcessingJobs>;
export type NewAIProcessingJob = InferInsertModel<typeof aiProcessingJobs>;

// ─── AI Notes ─────────────────────────────────────────────
export type AINoteRecord = InferSelectModel<typeof aiNotes>;
export type NewAINoteRecord = InferInsertModel<typeof aiNotes>;

// ─── Concept Relationships ────────────────────────────────
export type ConceptRelationship = InferSelectModel<typeof conceptRelationships>;
export type NewConceptRelationship = InferInsertModel<typeof conceptRelationships>;

// ─── PYQs ─────────────────────────────────────────────────
export type PYQ = InferSelectModel<typeof pyqs>;
export type NewPYQ = InferInsertModel<typeof pyqs>;

// ─── PYQ Concept Matches ─────────────────────────────────
export type PYQConceptMatch = InferSelectModel<typeof pyqConceptMatches>;
export type NewPYQConceptMatch = InferInsertModel<typeof pyqConceptMatches>;

// ─── GS Papers (Ontology) ─────────────────────────────────
export type GsPaperRecord = InferSelectModel<typeof gsPapers>;
export type NewGsPaperRecord = InferInsertModel<typeof gsPapers>;

// ─── Syllabus Domains (Ontology) ──────────────────────────
export type SyllabusDomainRecord = InferSelectModel<typeof syllabusDomains>;
export type NewSyllabusDomainRecord = InferInsertModel<typeof syllabusDomains>;

// ─── Syllabus Subtopics (Ontology) ────────────────────────
export type SyllabusSubtopicRecord = InferSelectModel<typeof syllabusSubtopics>;
export type NewSyllabusSubtopicRecord = InferInsertModel<typeof syllabusSubtopics>;

// ─── Concept ↔ Syllabus Links ─────────────────────────────
export type ConceptSyllabusLinkRecord = InferSelectModel<typeof conceptSyllabusLinks>;
export type NewConceptSyllabusLinkRecord = InferInsertModel<typeof conceptSyllabusLinks>;

// ─── Concept Context Intelligence (Phase 3A) ─────────────
export type ConceptContextRecord = InferSelectModel<typeof conceptContextIntelligence>;
export type NewConceptContextRecord = InferInsertModel<typeof conceptContextIntelligence>;

// ─── Concept Questions (Phase 3B) ─────────────────────────
export type ConceptQuestionsRecord = InferSelectModel<typeof conceptQuestions>;
export type NewConceptQuestionsRecord = InferInsertModel<typeof conceptQuestions>;

// ─── Concept Mastery (Phase 3C) ───────────────────────────
export type ConceptMasteryRecord = InferSelectModel<typeof conceptMastery>;
export type NewConceptMasteryRecord = InferInsertModel<typeof conceptMastery>;

// ─── Revision Events (Phase 3C) ───────────────────────────
export type RevisionEventRecord = InferSelectModel<typeof revisionEvents>;
export type NewRevisionEventRecord = InferInsertModel<typeof revisionEvents>;

// ─── Learner Adaptive Profile (Phase 4) ───────────────────
export type LearnerAdaptiveProfileRecord = InferSelectModel<typeof learnerAdaptiveProfile>;
export type NewLearnerAdaptiveProfileRecord = InferInsertModel<typeof learnerAdaptiveProfile>;

// ─── Preferences JSONB shape ──────────────────────────────
export interface UserPreferences {
  examTarget?: string;
  studyMode?: string;
  subjectPriorities?: Record<string, number>;
  studyHoursPerDay?: number;
  reminderTime?: string;
  language?: string;
  onboardingCompletedAt?: string;
}
