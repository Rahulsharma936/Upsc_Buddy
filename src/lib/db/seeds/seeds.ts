/**
 * UPSC Civil Services Mains Syllabus Ontology
 *
 * Purpose   : Database seeding · GS mapping · PYQ tagging · AI grounding
 * Source    : Official UPSC CSE Mains syllabus (DOPT / UPSC notification)
 * Scope     : GS1 · GS2 · GS3 · GS4 · Essay  (no Optionals, no CSAT)
 * Principle : Minimal, maintainable, AI-contextual — NOT encyclopedic
 */

export const upscSyllabus = {

  // ─────────────────────────────────────────────
  // GS PAPER 1
  // Indian Heritage · History · Geography · Society
  // ─────────────────────────────────────────────
  GS1: {

    IndianHeritage: [
      "art and architecture",
      "literature and philosophy",
      "cultural traditions and salient aspects",
    ],

    History: [
      "ancient and medieval india",
      "modern indian history (1757–1947)",
      "freedom struggle and national movement",
      "post-independence consolidation and reorganisation",
      "world history (18th–20th century events)",
    ],

    Geography: [
      "physical geography of india and world",
      "resources — land, water, minerals, energy",
      "agriculture and land use patterns",
      "industries and economic geography",
      "climate, weather phenomena, natural hazards",
      "human and regional geography",
    ],

    Society: [
      "salient features of indian society",
      "diversity, communalism, regionalism, secularism",
      "women and women's organisation",
      "population and development issues",
      "urbanisation and migration",
      "social empowerment — SC/ST, OBC, minorities",
      "globalization and its effects on society",
    ],

  },

  // ─────────────────────────────────────────────
  // GS PAPER 2
  // Governance · Constitution · Polity · IR · Social Justice
  // ─────────────────────────────────────────────
  GS2: {

    Constitution: [
      "constitutional framework and features",
      "fundamental rights, duties, and dpsp",
      "constitutional amendments",
      "emergency provisions",
      "comparative constitutional provisions",
    ],

    Polity: [
      "parliament — structure, functioning, legislation",
      "executive — president, pm, cabinet, bureaucracy",
      "judiciary — structure, independence, judicial review",
      "federalism and centre-state relations",
      "local self-government — panchayati raj and ULBs",
      "statutory and regulatory bodies",
      "pressure groups and political parties",
    ],

    Governance: [
      "transparency and accountability",
      "e-governance and digital services",
      "civil services and administrative reforms",
      "government policies and interventions",
      "citizens charter, RTI, grievance redressal",
      "role of ngos and civil society",
    ],

    SocialJustice: [
      "welfare schemes for vulnerable sections",
      "health, education, and human resource policies",
      "poverty and hunger alleviation mechanisms",
      "issues of labour and skill development",
      "mechanisms for social protection",
    ],

    InternationalRelations: [
      "india's foreign policy and bilateral relations",
      "international organisations and india's role",
      "india's neighbourhood — south asia and beyond",
      "global geopolitics and strategic affairs",
      "indian diaspora",
    ],

  },

  // ─────────────────────────────────────────────
  // GS PAPER 3
  // Economy · Environment · Science · Security
  // ─────────────────────────────────────────────
  GS3: {

    Economy: [
      "planning, growth, and development",
      "agriculture — issues, reforms, supply chain",
      "industry, infrastructure, and investment",
      "employment and labour market",
      "fiscal policy, taxation, and public finance",
      "monetary policy, banking, and financial sector",
      "external sector — trade, BoP, WTO",
      "inclusive growth and regional disparities",
      "government schemes and economic policies",
    ],

    ScienceAndTechnology: [
      "developments in science and technology",
      "space and defence technology",
      "biotechnology and its applications",
      "it, ai, and digital economy",
      "indigenization of technology and ipr",
    ],

    Environment: [
      "conservation of natural resources",
      "biodiversity — concepts, threats, protection",
      "climate change — causes, impacts, policy",
      "pollution and environmental degradation",
      "environmental acts, institutions, and agreements",
      "disaster management — preparedness and mitigation",
    ],

    Security: [
      "internal security threats and challenges",
      "insurgency, extremism, and terrorism",
      "border management and coastal security",
      "organised crime and money laundering",
      "cyber security",
      "security forces — role and mandate",
    ],

  },

  // ─────────────────────────────────────────────
  // GS PAPER 4
  // Ethics · Integrity · Aptitude
  // ─────────────────────────────────────────────
  GS4: {

    EthicsFoundations: [
      "essence and determinants of ethics",
      "ethics in public and private life",
      "human values — role of family, society, educational institutions",
      "moral thinkers and philosophers — indian and western",
      "attitude — content, structure, function, influence",
    ],

    IntegrityAndAptitude: [
      "integrity and impartiality in public service",
      "objectivity and non-partisanship",
      "dedication to public service",
      "empathy, tolerance, and compassion",
      "emotional intelligence",
    ],

    PublicServiceEthics: [
      "ethical issues in governance",
      "accountability and ethical governance",
      "codes of conduct, laws, rules, regulations",
      "citizens charter and quality of service",
      "work culture and organisational ethics",
      "utilisation of public funds",
    ],

    ProbityInGovernance: [
      "concept of public service",
      "philosophical basis of governance and probity",
      "information sharing and transparency",
      "right to information",
      "corruption — forms, causes, remedies",
    ],

    CaseStudies: [
      "ethical dilemmas in public administration",
      "case studies on above topics",
    ],

  },

  // ─────────────────────────────────────────────
  // ESSAY PAPER
  // Not domain-specific — thematic clusters for context mapping
  // ─────────────────────────────────────────────
  Essay: {

    ThematicClusters: [
      "philosophy and abstract ideas",
      "society, culture, and human values",
      "governance, democracy, and politics",
      "economy and development",
      "science, technology, and future",
      "environment and sustainability",
      "india — history, identity, and aspirations",
      "international affairs and global order",
      "ethics, morality, and human conduct",
      "literature, arts, and critical thinking",
    ],

  },

} as const;

// ─────────────────────────────────────────────
// TYPE HELPERS  (useful for DB seeding and GS mapping)
// ─────────────────────────────────────────────

export type GsPaper = keyof typeof upscSyllabus;

export type DomainsOf<P extends GsPaper> = keyof (typeof upscSyllabus)[P];

export type SubtopicsOf<
  P extends GsPaper,
  D extends DomainsOf<P>
> = (typeof upscSyllabus)[P][D] extends readonly string[]
  ? (typeof upscSyllabus)[P][D][number]
  : never;

/**
 * Flat record of all (paper, domain, subtopic) triples.
 * Use for seeding a `syllabus_nodes` table or building a concept graph.
 *
 * Example row: { paper: "GS2", domain: "Governance", subtopic: "e-governance" }
 */
export type SyllabusNode = {
  paper: GsPaper;
  domain: string;
  subtopic: string;
};

/** Utility: generate all flat SyllabusNode records from the ontology */
export function flattenSyllabus(): SyllabusNode[] {
  const nodes: SyllabusNode[] = [];
  for (const paper of Object.keys(upscSyllabus) as GsPaper[]) {
    const domains = upscSyllabus[paper] as Record<string, readonly string[]>;
    for (const domain of Object.keys(domains)) {
      for (const subtopic of domains[domain]) {
        nodes.push({ paper, domain, subtopic });
      }
    }
  }
  return nodes;
}