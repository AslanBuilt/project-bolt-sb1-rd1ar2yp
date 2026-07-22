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

Visualizes the day's recommended outfit on the user's own photo, at $0 cost, generated automatically in the background.

- **Base photo**: uploaded in Settings, stored at `${userId}/profile/base-photo.<ext>` in the same private `clothing-photos` bucket (inherits the existing path-scoped RLS policies — no new bucket/policy needed). Path saved in `style_preferences.base_photo_url`.
- **Generation**: `supabase/functions/outfit-tryon` (Deno). Uses `npm:@gradio/client` to call **IDM-VTON** (`yisol/IDM-VTON`, Space endpoint `/tryon`) as the sole model, with a real garment description (`${primary_color} ${subcategory}`, e.g. "white t-shirt") passed as text conditioning — not a placeholder string. Image blobs passed to `predict()` **must** be wrapped in `handle_file()` from `@gradio/client` — passing raw `Blob`s directly silently produces wrong/garbage results (an actual bug found in production: a real request returned an unrelated denim jacket, because unwrapped blobs weren't recognized as valid file inputs). Fixed 2026-07-21.
- **CatVTON is disabled (2026-07-22), not just deprioritized.** It was the original primary model with IDM-VTON as fallback, but live diagnostics across an entire day of usage showed a **0% success rate** — every single call failed with either a server-side `IndexError` crash in the Space's own code, or a ZeroGPU quota rejection — and every failed attempt still consumed real shared quota that the *next* chained step then needed, causing cascading failures (see below). A `CATVTON_ENABLED` const at the top of the step loop in `index.ts` gates this — flip it back on only if you have fresh evidence the Space has stabilized, not by default. Retries were also cut from 2 attempts to 1 for the same reason: logs showed a retry has never once recovered from a first-attempt failure (the same error, usually quota exhaustion, just recurs seconds later) — it only burns more of the scarce daily quota.
- **Model limitation (permanent, by design)**: both CatVTON and IDM-VTON are garment try-on models — `cloth_type`/category only supports `upper` / `lower` / `overall`. **Neither supports shoes or accessories**, confirmed from each Space's live API config, not assumed. The Edge Function filters steps down to `upper`/`lower` only and always skips anything else (logged, not an error). This is not a bug to fix — don't add a shoes/accessory step without switching to a completely different model. **Confirmed and closed 2026-07-22 — do not revisit.**
- **Partial results are surfaced, not silently masked.** If one chained step fails after the other succeeded (e.g. upper converts fine but lower's model call errors), the pre-failure image is still saved and marked `done` (a partial visualization beats none) — but `tryon_results.failed_step` records what didn't convert, and `TodayPage.tsx` shows a small note ("Couldn't update the lower in this visualization...") rather than presenting it as if fully accurate. Earlier versions saved the partial image with no visible indication, which read as "the model failed to convert the garment" when the real cause was the step erroring out entirely (ZeroGPU quota exhaustion) — investigate via logs before assuming a conversion/fidelity limitation; check whether the step's `raw predict() result` log entry exists at all for that category first.
- **Chaining**: base photo → (+ upper garment) → result A → (+ lower garment) → result B. If an outfit has both a `shirts` and a `sweatshirt_jacket` item, only the outer layer (`sweatshirt_jacket`) is sent for the "upper" step (`getTryOnStepItems()` in `TodayPage.tsx`), since only one garment per region can be passed per call.
- **Trigger timing**: generation starts the moment a candidate outfit is shown or regenerated (`TodayPage.tsx` effects on `[outfits, currentIndex]` and `[savedOutfit?.id]`), *not* on "Wear This" — by the time the user commits to an outfit, its visualization is usually already done or in progress. "Wear This" (`wearOutfit()`) also calls `ensureTryOn()` as an idempotent safety net.
- **Caching, keyed by item combination, not by outfit row**: cache key (`combo_key`) is the sorted, joined ids of just the upper+lower items being visualized — not the outfit's full item list, and not any `outfits` row id. This lets identical combinations reuse a previous generation instantly, forever, and lets generation start on a browsed candidate *before* any `outfits` row exists for it. Tracked in the `tryon_results` table (`user_id, combo_key` composite PK; `status`: `generating`/`done`/`failed`; `image_url`). The `outfits.generated_image_url` column from the first version of this feature is superseded and no longer written to — `tryon_results` is now the source of truth.
- **Durable completion**: the Edge Function itself writes the final `tryon_results` row via its service-role client once generation finishes (success or failure) — not the client. This means a result completes correctly even if the browser tab that triggered it has since navigated away or closed; the next time `ensureTryOn()` runs for that combo, it just reads whatever the function already persisted. The client only does a lightweight poll (every 6s, `TodayPage.tsx`) purely for a snappier UI update while it happens to still be on-screen — polling is not required for correctness.
- **Failure handling**: on any failure (missing base photo, both models failing a step, storage upload failure), `tryon_results.status` becomes `'failed'` and the frontend just shows nothing extra — the existing flat-lay item-thumbnail row always renders regardless, so there's no separate fallback UI needed.
- **Verified**: the CatVTON/IDM-VTON API signatures were pulled live from each Space's `/config` endpoint (not guessed) — the `imageeditor`-type person-image input, `{background, layers: [], composite: null}` shape, and parameter order are confirmed real, as is the `handle_file()` requirement. **Still not verified**: a full live chained generation producing a *correct* visual result end-to-end — the first live test surfaced the `handle_file()` bug above; that's fixed, but hasn't yet been re-confirmed to produce a correct chained (upper+lower) result. If a future test still looks wrong, check the Edge Function logs first (extensive step-by-step logging was added: base photo URL, each garment URL, blob sizes, raw `predict()` result per step, and which model/step succeeded or failed).

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
