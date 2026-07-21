# StyleCloset

Personal single-user wardrobe app: Vite + React + TypeScript, backed by Supabase (Postgres + Auth + Storage + Edge Functions).

## Deployment topology

- **GitHub**: `AslanBuilt/project-bolt-sb1-rd1ar2yp` (private). This app lives in the `project/` subfolder of that repo, not the repo root. Pushing to `main` auto-deploys to Vercel via its Git integration.
- **Vercel**: project `style-closet` (scope `aiden-ricketts`). Root Directory is set to `project`. Deployment protection is disabled, so the production URL is publicly reachable.
- **Database**: Supabase project `supabase-red-xylophone` (ref `hrprbiregnrbrdnhetht`), provisioned through the Vercel Marketplace Supabase integration — not a standalone Supabase project. This *replaced* an earlier standalone Supabase project (ref `bhxiwpztitzgzslzxkiz`); that old project's data was not migrated over, only the schema (via the migration files in `supabase/migrations/`).
- **Edge Functions**: `ai-tag-item`, `analyze-inspiration`, `outfit-recommend` under `supabase/functions/` run on Supabase's infrastructure, deployed separately from the Vercel frontend build.

## Environment variables and secrets

Two separate stores, because two separate platforms execute this code:

- **Frontend (Vercel project env vars)**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. These get baked into the client JS bundle at build time — treat them as public, not secret. Managed via `vercel env ls` / `vercel env add`.
- **Edge Functions (Supabase secrets)**: `GEMINI_API_KEY` (Google Gemini API, used by all 3 functions). Set via `supabase secrets set GEMINI_API_KEY=... --project-ref hrprbiregnrbrdnhetht`. **Setting this in Vercel does nothing for the Edge Functions** — they don't run on Vercel and never see its env vars.
- **Local dev**: copy `.env.example`-style values into a local `.env` (gitignored). Never commit real secrets; never hardcode them in source.

Never hardcode credentials in source files. The one existing exception is intentional: `src/contexts/AuthContext.tsx` signs into a single fixed account (`aiden@stylecloset.internal`) with a hardcoded password, because this is deliberately a single-tenant personal app (see `AuthPage.tsx`). That password ships in the public JS bundle regardless of where it's stored, so the deployed URL itself is the real access boundary — don't "fix" this without checking with whoever owns the app first, since it's a design choice, not an oversight.

## Working with the database

Supabase CLI isn't installed globally on this machine (winget doesn't have it, global npm install is deprecated by Supabase) — use `npx -y supabase@latest <command>` for everything.

- **Schema changes**: add a new file to `supabase/migrations/`, then push it:
  ```
  npx supabase@latest db push --db-url "<direct/non-pooling Postgres URL, port 5432>" --yes
  ```
  Get the connection string via `vercel env pull` (look for `POSTGRES_URL_NON_POOLING`) or the Supabase dashboard. Use the direct connection, not the pgbouncer pooled one, for DDL.
- **Storage buckets** are not created by SQL migrations even when RLS policies reference them — create via the Storage Management API (`POST https://<ref>.supabase.co/storage/v1/bucket`, service role key) if a new one is ever needed. Current bucket: `clothing-photos` (private).
- **Edge Functions redeploy**:
  ```
  $env:SUPABASE_ACCESS_TOKEN = "<personal access token from supabase.com/dashboard/account/tokens>"
  npx supabase@latest functions deploy --project-ref hrprbiregnrbrdnhetht --use-api
  ```
  This is a separate auth flow from the DB connection string above — it talks to Supabase's Management API and needs a Personal Access Token, not the DB password.

## Deploying

Normal path: commit, push to `main`, Vercel builds and deploys automatically. No manual `vercel deploy` needed for routine changes. Re-run the Vercel/Supabase CLI steps above only when provisioning changes (new env vars, new migrations, new/changed Edge Functions) — the frontend deploy itself is fully automatic on push.
