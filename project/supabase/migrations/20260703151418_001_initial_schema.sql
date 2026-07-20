/*
# Closet & Outfit Recommender - Initial Schema

1. New Tables
- `clothing_items`: Stores user's wardrobe items with metadata
  - id (uuid, primary key)
  - user_id (uuid, references auth.users, defaults to auth.uid())
  - photo_url (text, URL to stored image)
  - category (text: top/bottom/outerwear/shoes/accessory/dress)
  - subcategory (text: e.g., t-shirt, jeans, sneakers)
  - primary_color (text)
  - secondary_color (text, nullable)
  - pattern (text: solid/striped/plaid/floral/geometric/printed/other)
  - formality (text: casual/smart-casual/formal)
  - season (text: spring/summer/fall/winter/all)
  - last_worn_date (date, nullable)
  - times_worn (integer, default 0)
  - favorite (boolean, default false)
  - retired (boolean, default false)
  - created_at (timestamp)

- `style_preferences`: User's style preferences from onboarding
  - user_id (uuid, primary key, references auth.users)
  - style_tags (text array: e.g., minimalist, streetwear)
  - inspiration_photos (text array, nullable)
  - formality_range_min (text: casual/smart-casual/formal)
  - formality_range_max (text)
  - onboarding_completed (boolean, default false)

- `outfits`: Daily outfit recommendations and history
  - id (uuid, primary key)
  - user_id (uuid, references auth.users, defaults to auth.uid())
  - date (date)
  - item_ids (uuid array, references clothing_items)
  - source (text: rule-based/ai)
  - activity_text (text, nullable)
  - worn (boolean, default false)
  - rating (text, nullable: up/down)
  - created_at (timestamp)

2. Security
- Enable RLS on all tables
- Owner-scoped CRUD policies for authenticated users
- user_id columns default to auth.uid() for seamless inserts

3. Notes
- Cascading deletes when user is deleted
- Indexes on user_id and date for performance
*/

CREATE TABLE IF NOT EXISTS clothing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  category text NOT NULL CHECK (category IN ('top', 'bottom', 'outerwear', 'shoes', 'accessory', 'dress')),
  subcategory text NOT NULL,
  primary_color text NOT NULL,
  secondary_color text,
  pattern text NOT NULL DEFAULT 'solid' CHECK (pattern IN ('solid', 'striped', 'plaid', 'floral', 'geometric', 'printed', 'other')),
  formality text NOT NULL DEFAULT 'casual' CHECK (formality IN ('casual', 'smart-casual', 'formal')),
  season text NOT NULL DEFAULT 'all' CHECK (season IN ('spring', 'summer', 'fall', 'winter', 'all')),
  last_worn_date date,
  times_worn integer NOT NULL DEFAULT 0,
  favorite boolean NOT NULL DEFAULT false,
  retired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clothing_items_user_id ON clothing_items(user_id);
CREATE INDEX IF NOT EXISTS idx_clothing_items_category ON clothing_items(category);
CREATE INDEX IF NOT EXISTS idx_clothing_items_retired ON clothing_items(retired);

ALTER TABLE clothing_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_clothing_items" ON clothing_items;
CREATE POLICY "select_own_clothing_items" ON clothing_items FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_clothing_items" ON clothing_items;
CREATE POLICY "insert_own_clothing_items" ON clothing_items FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_clothing_items" ON clothing_items;
CREATE POLICY "update_own_clothing_items" ON clothing_items FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_clothing_items" ON clothing_items;
CREATE POLICY "delete_own_clothing_items" ON clothing_items FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS style_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  style_tags text[] NOT NULL DEFAULT '{}',
  inspiration_photos text[],
  formality_range_min text NOT NULL DEFAULT 'casual' CHECK (formality_range_min IN ('casual', 'smart-casual', 'formal')),
  formality_range_max text NOT NULL DEFAULT 'smart-casual' CHECK (formality_range_max IN ('casual', 'smart-casual', 'formal')),
  onboarding_completed boolean NOT NULL DEFAULT false
);

ALTER TABLE style_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_style_preferences" ON style_preferences;
CREATE POLICY "select_own_style_preferences" ON style_preferences FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_style_preferences" ON style_preferences;
CREATE POLICY "insert_own_style_preferences" ON style_preferences FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_style_preferences" ON style_preferences;
CREATE POLICY "update_own_style_preferences" ON style_preferences FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS outfits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  item_ids uuid[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'rule-based' CHECK (source IN ('rule-based', 'ai')),
  activity_text text,
  worn boolean NOT NULL DEFAULT false,
  rating text CHECK (rating IN ('up', 'down')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outfits_user_id ON outfits(user_id);
CREATE INDEX IF NOT EXISTS idx_outfits_date ON outfits(date);

ALTER TABLE outfits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_outfits" ON outfits;
CREATE POLICY "select_own_outfits" ON outfits FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_outfits" ON outfits;
CREATE POLICY "insert_own_outfits" ON outfits FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_outfits" ON outfits;
CREATE POLICY "update_own_outfits" ON outfits FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_outfits" ON outfits;
CREATE POLICY "delete_own_outfits" ON outfits FOR DELETE
  TO authenticated USING (auth.uid() = user_id);