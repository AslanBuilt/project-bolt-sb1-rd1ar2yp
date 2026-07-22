/*
# Try-on results cache, keyed by item combination

Previously the try-on image was cached on `outfits.generated_image_url`, which
only exists once an outfit is committed via "Wear This" — but generation now
needs to start as soon as a candidate is *shown*, before any outfits row
exists. This table decouples the cache from any specific outfits row:

- `combo_key`: deterministic key derived from the sorted set of clothing item
  ids that make up an outfit (same combo = same key, regardless of which day
  or which outfits row it eventually becomes). Lets identical outfit
  combinations reuse a previous generation forever, not just same-day.
- The Edge Function itself (via service-role access) writes the final
  status/image_url here, so completion is durable even if the browser tab
  that triggered it has since navigated away or closed.
*/

CREATE TABLE IF NOT EXISTS tryon_results (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  combo_key text NOT NULL,
  status text NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'done', 'failed')),
  image_url text,
  failed_step text,
  skipped text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, combo_key)
);

ALTER TABLE tryon_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_tryon_results" ON tryon_results;
CREATE POLICY "select_own_tryon_results" ON tryon_results FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_tryon_results" ON tryon_results;
CREATE POLICY "insert_own_tryon_results" ON tryon_results FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_tryon_results" ON tryon_results;
CREATE POLICY "update_own_tryon_results" ON tryon_results FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
