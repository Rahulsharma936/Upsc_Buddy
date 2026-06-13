# UPSC Prep — Setup Guide

## Prerequisites

- Node.js 18+
- npm
- Supabase account

## 1. Supabase Setup

### Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note down:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **Anon public key** (Settings → API → `anon` key)
   - **Database URL** (Settings → Database → Connection string → URI)

### Run Migrations

In the Supabase SQL Editor, run the migration files in order:

1. `supabase/migrations/00001_create_profiles.sql`
2. `supabase/migrations/00002_create_daily_logs.sql`
3. `supabase/migrations/00003_rls_policies.sql`

### Configure Auth

1. Go to **Authentication → Providers**
2. Ensure **Email** provider is enabled
3. (Optional) Disable email confirmation for development:
   - Authentication → Settings → toggle off "Enable email confirmations"

## 2. Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
DATABASE_URL=postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> **Note:** For `DATABASE_URL`, use the **direct connection string** (not the pooler) from Supabase Dashboard → Settings → Database → Connection string → URI.

## 3. Install Dependencies

```bash
npm install
```

## 4. Run Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

## 5. Verify Setup

1. Navigate to `http://localhost:3000` — should redirect to `/login`
2. Create an account via `/signup`
3. Complete the onboarding wizard
4. You should land on the dashboard
5. Create a daily study log

## Architecture Overview

```
Frontend UI (React Server/Client Components)
→ Next.js API Route Handlers (/api/*)
→ Service Layer (/lib/services/)
→ Repository Layer (/lib/repositories/)
→ Supabase PostgreSQL (via Drizzle ORM)
```

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/            # Auth pages (login, signup)
│   ├── (dashboard)/       # Protected dashboard pages
│   ├── api/               # API route handlers
│   └── onboarding/        # Onboarding wizard
├── components/
│   ├── ui/                # shadcn/ui primitives
│   ├── shared/            # Reusable shared components
│   └── features/          # Feature-specific components
├── hooks/                 # Custom React hooks
├── lib/
│   ├── constants/         # App constants
│   ├── db/                # Drizzle schema + client
│   ├── repositories/      # Data access layer
│   ├── services/          # Business logic layer
│   ├── supabase/          # Supabase clients
│   ├── utils/             # Utility functions
│   └── validations/       # Zod schemas
├── stores/                # Zustand stores
├── types/                 # TypeScript type definitions
└── middleware.ts          # Route protection
```

## Database Schema

### profiles
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | References auth.users |
| email | TEXT | User email |
| full_name | TEXT | Display name |
| onboarding_completed | BOOLEAN | Onboarding status |
| preferences | JSONB | Onboarding data + settings |
| created_at | TIMESTAMPTZ | Row creation time |
| updated_at | TIMESTAMPTZ | Last update time |

### daily_logs
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated |
| user_id | UUID (FK) | References profiles |
| date | DATE | Log date |
| raw_input | TEXT | Free-form study notes |
| subjects | TEXT[] | Subject IDs studied |
| concepts | TEXT[] | Key concepts (manual) |
| created_at | TIMESTAMPTZ | Row creation time |
| updated_at | TIMESTAMPTZ | Last update time |

## Security

- **RLS enabled** on all tables
- **Middleware** protects dashboard routes
- **Server-side session validation** on every API request
- **Zod validation** on all API inputs
