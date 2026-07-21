# StyleCloset

Personal single-user wardrobe app: Vite + React + TypeScript, backed by Supabase (Postgres + Auth + Storage + Edge Functions).

## Deployment topology

- **GitHub**: `AslanBuilt/project-bolt-sb1-rd1ar2yp` (private). This app lives in the `project/` subfolder of that repo, not the repo root. Pushing to `main` auto-deploys to Vercel via its Git integration.
- **Vercel**: project `style-closet` (scope `aiden-ricketts`). Root Directory is set to `project`. Deployment protection is disabled, so the production URL is publicly reachable.
- **Database**: Supabase project `supabase-red-xylophone` (ref `hrprbiregnrbrdnhetht`), provisioned through the Vercel Marketplace Supabase integration — not a standalone Supabase project. This *replaced* an earlier standalone Supabase project (ref `bhxiwpztitzgzslzxkiz`); that old project's data was not migrated over, only the schema (via the migration files in `supabase/migrations/`).
- **Edge Functions**: `ai-tag-item`, `analyze-inspiration`, `outfit-recommend` under `supabase/functions/` run on Supabase's infrastructure, deployed separately from the Vercel frontend build.

## Edge Functions require the anon key as a Bearer token

All 3 Edge Functions are deployed with `verify_jwt: true` (the Supabase default) — every `fetch()` call to them from the frontend **must** include `Authorization: Bearer ${VITE_SUPABASE_ANON_KEY}`, or Supabase rejects the request with `401` before it ever reaches the function code. `TodayPage.tsx` did this correctly from the start; `InspirationPage.tsx` and `AddItemPage.tsx` originally didn't, which silently broke AI inspiration analysis and AI auto-tagging entirely (they weren't hitting a real Gemini rate limit at all — every request was being rejected at the auth layer). Fixed 2026-07-21. If a new Edge Function call site is ever added, make sure it includes this header.

## Outfit try-on feature

Visualizes the day's saved outfit on the user's own photo, at $0 cost. Architecture:

- **Base photo**: uploaded in Settings, stored at `${userId}/profile/base-photo.<ext>` in the same private `clothing-photos` bucket (inherits the existing path-scoped RLS policies — no new bucket/policy needed). Path saved in `style_preferences.base_photo_url`.
- **Generation**: `supabase/functions/outfit-tryon` (Deno), triggered from `TodayPage.tsx`'s `wearOutfit()` right after an outfit is saved. Uses `npm:@gradio/client` to call **CatVTON** (`zhengchong/CatVTON`, Space endpoint `/submit_function`) with `HF_TOKEN` as the Space auth token, falling back to **IDM-VTON** (`yisol/IDM-VTON`, endpoint `/tryon`) if CatVTON errors, one retry each.
- **Model limitation (important)**: both CatVTON and IDM-VTON are garment try-on models — `cloth_type` only supports `upper` / `lower` / `overall`. **Neither supports shoes or accessories.** The Edge Function filters steps down to `upper`/`lower` only and always skips anything else (logged, not an error). Don't add a shoes/accessory step without switching to a different model — these two don't have the capability.
- **Chaining**: base photo → (+ upper garment) → result A → (+ lower garment) → result B. If an outfit has both a `shirts` and a `sweatshirt_jacket` item, only the outer layer (`sweatshirt_jacket`) is sent for the "upper" step (frontend picks this in `generateTryOn()`), since only one garment per region can be passed per call.
- **Caching**: final image uploaded to `${userId}/generated/${outfitId}.jpg` in `clothing-photos` (via the Edge Function's service-role client, since it's writing on behalf of the user without a forwarded user JWT), path cached on `outfits.generated_image_url` so the same day's outfit isn't regenerated on repeat views.
- **Failure handling**: on any failure (missing base photo, both models failing a step, storage upload failure), the frontend just leaves `tryOnStatus` at `'failed'`/`'idle'` — the existing flat-lay item-thumbnail row always renders regardless, so there's no separate fallback UI needed, just don't block on the generation.
- **Verified**: the CatVTON/IDM-VTON API signatures below were pulled live from each Space's `/config` endpoint (not guessed) — the `imageeditor`-type person-image input, `{background, layers: [], composite: null}` shape, and parameter order are confirmed real. **Not verified**: an actual live chained generation end-to-end (untested at build time since it needs a real base photo + real garment photos and consumes live ZeroGPU quota) — the Edge Function's module load/import of `npm:@gradio/client` was confirmed to work in Supabase's Deno runtime, but the full predict() → result-extraction path has not had a live run yet. If it errors, check the Edge Function logs first (`extractResultBlob` logs the raw shape it received, since Gradio's output shape can vary slightly by client/Space version).

## Known limitation: Gemini free-tier rate limit

The `GEMINI_API_KEY` currently in use is on Google's **free tier**, which caps `gemini-2.5-flash` at **5 requests/minute per project** — shared across all 3 Edge Functions, since they all call the same model. Uploading several inspiration photos in one batch (or using multiple AI features close together) can exhaust this in seconds; Google returns `429 RESOURCE_EXHAUSTED` with a `retryDelay`.

- `ai-tag-item` and `analyze-inspiration` propagate this as `429` + `retryAfter` (seconds) to the frontend instead of a generic 500. `InspirationPage.tsx` waits that long and retries once before giving up.
- `outfit-recommend` already falls back to a rule-based recommendation on any Gemini failure, so it needed no change.
- This makes normal usage resilient to brief rate limiting, but does **not** raise the actual 5/min ceiling. The real fix is enabling billing on the Gemini key's Google Cloud project (or swapping in a paid-tier key) — set the new key via `supabase secrets set GEMINI_API_KEY=... --project-ref hrprbiregnrbrdnhetht`.

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
