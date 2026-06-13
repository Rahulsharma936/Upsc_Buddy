-- =========================================================
-- GS PAPERS
-- =========================================================

create table if not exists gs_papers (
  id uuid primary key default gen_random_uuid(),

  code text not null unique,
  title text not null,

  created_at timestamptz not null default now()
);

-- =========================================================
-- SYLLABUS DOMAINS
-- =========================================================

create table if not exists syllabus_domains (
  id uuid primary key default gen_random_uuid(),

  paper_id uuid not null references gs_papers(id) on delete cascade,

  name text not null,
  description text,

  created_at timestamptz not null default now(),

  unique(paper_id, name)
);

-- =========================================================
-- SYLLABUS SUBTOPICS
-- =========================================================

create table if not exists syllabus_subtopics (
  id uuid primary key default gen_random_uuid(),

  domain_id uuid not null references syllabus_domains(id) on delete cascade,

  name text not null,

  keywords jsonb,

  created_at timestamptz not null default now(),

  unique(domain_id, name)
);

-- =========================================================
-- CONCEPT ↔ SYLLABUS LINKS
-- =========================================================

create table if not exists concept_syllabus_links (
  id uuid primary key default gen_random_uuid(),

  concept_id uuid not null references concepts(id) on delete cascade,

  subtopic_id uuid not null references syllabus_subtopics(id) on delete cascade,

  confidence_score numeric(3,2) not null check (
    confidence_score >= 0
    and confidence_score <= 1
  ),

  reasoning text,

  created_at timestamptz not null default now(),

  unique(concept_id, subtopic_id)
);

-- =========================================================
-- INDEXES
-- =========================================================

create index if not exists idx_syllabus_domains_paper_id
on syllabus_domains(paper_id);

create index if not exists idx_syllabus_subtopics_domain_id
on syllabus_subtopics(domain_id);

create index if not exists idx_concept_syllabus_links_concept_id
on concept_syllabus_links(concept_id);

create index if not exists idx_concept_syllabus_links_subtopic_id
on concept_syllabus_links(subtopic_id);

-- =========================================================
-- ENABLE RLS
-- =========================================================

alter table gs_papers enable row level security;
alter table syllabus_domains enable row level security;
alter table syllabus_subtopics enable row level security;
alter table concept_syllabus_links enable row level security;

-- =========================================================
-- READ POLICIES
-- =========================================================

create policy "Allow authenticated users to read gs papers"
on gs_papers
for select
to authenticated
using (true);

create policy "Allow authenticated users to read syllabus domains"
on syllabus_domains
for select
to authenticated
using (true);

create policy "Allow authenticated users to read syllabus subtopics"
on syllabus_subtopics
for select
to authenticated
using (true);

create policy "Allow authenticated users to read concept syllabus links"
on concept_syllabus_links
for select
to authenticated
using (true);

-- =========================================================
-- INSERT/UPDATE POLICIES
-- =========================================================

create policy "Allow service role full access gs papers"
on gs_papers
for all
to service_role
using (true)
with check (true);

create policy "Allow service role full access syllabus domains"
on syllabus_domains
for all
to service_role
using (true)
with check (true);

create policy "Allow service role full access syllabus subtopics"
on syllabus_subtopics
for all
to service_role
using (true)
with check (true);

create policy "Allow service role full access concept syllabus links"
on concept_syllabus_links
for all
to service_role
using (true)
with check (true);