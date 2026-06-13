/**
 * Ontology module barrel export.
 * Phase 2G: UPSC syllabus ontology infrastructure.
 */

export {
  GS_PAPER_CODES,
  isValidPaper,
  getDomainsForPaper,
  getSubtopicsForDomain,
  resolvePapersForSubject,
  findSubtopicsByKeyword,
  findSubtopicsByKeywords,
  isValidOntologyPath,
  getOntologyStats,
} from "./helpers";

export { upscSyllabus, flattenSyllabus } from "@/lib/db/seeds/seeds";
export type { GsPaper, SyllabusNode } from "@/lib/db/seeds/seeds";
