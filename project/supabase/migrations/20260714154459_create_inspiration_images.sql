/*
# Create inspiration_images table

1. New Tables
- `inspiration_images`
  - `id` (uuid, primary key)
  - `user_id` (uuid, not null, defaults to auth.uid(), references auth.users)
  - `photo_url` (text, storage path in clothing-photos bucket)
  - `color_palette` (text[], dominant colors detected by AI)
  - `silhouette` (text, silhouette/style description from AI)
  - `pattern_trends` (text[], pattern descriptors from AI)
  - `ai_analysis` (jsonb, full raw AI response for future use)
  - `analyzed` (boolean, default false — true once AI analysis completes)
  - `created_at` (timestamptz, default now())

2. Security
- Enable RLS on `inspiration_images`.
- Owner-scoped CRUD: each authenticated user can only access their own inspiration images.
- 4 separate policies (select/insert/update/delete), all scoped to `auth.uid() = user_id`.

3. Notes
- Uses the existing `clothing-photos` storage bucket (shared with clothing items).
- `user_id` defaults to `auth.uid()` so frontend inserts that omit it still satisfy RLS.
- No hard cap on count — users can upload as many inspiration images as they want.
*/

CREATE TABLE IF NOT EXISTS inspiration_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  color_palette text[] DEFAULT '{}',
  silhouette text DEFAULT '',
  pattern_trends text[] DEFAULT '{}',
  ai_analysis jsonb DEFAULT '{}',
  analyzed boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE inspiration_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_inspiration" ON inspiration_images;
CREATE POLICY "select_own_inspiration" ON inspiration_images
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_inspiration" ON inspiration_images;
CREATE POLICY "insert_own_inspiration" ON inspiration_images
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_inspiration" ON inspiration_images;
CREATE POLICY "update_own_inspiration" ON inspiration_images
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_inspiration" ON inspiration_images;
CREATE POLICY "delete_own_inspiration" ON inspiration_images
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_inspiration_images_user_id ON inspiration_images(user_id);
CREATE INDEX IF NOT EXISTS idx_inspiration_images_created_at ON inspiration_images(created_at DESC);
