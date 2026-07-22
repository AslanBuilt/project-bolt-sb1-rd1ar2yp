/*
# Weather-aware outfit filtering

1. Changes
- `style_preferences`: stored location (lat/lon + display name, resolved once via
  geocoding) and a personal `temp_offset_f` calibration ("runs cold/hot"),
  defaulting to 0 (no adjustment).
- `clothing_items`: `warmth_min_f` / `warmth_max_f` — the temperature range an
  item is appropriate for. Inferred in code from category/subcategory (no AI
  cost), not by an extra Gemini call.
*/

ALTER TABLE style_preferences ADD COLUMN IF NOT EXISTS location_lat numeric;
ALTER TABLE style_preferences ADD COLUMN IF NOT EXISTS location_lon numeric;
ALTER TABLE style_preferences ADD COLUMN IF NOT EXISTS location_name text;
ALTER TABLE style_preferences ADD COLUMN IF NOT EXISTS temp_offset_f integer NOT NULL DEFAULT 0;

ALTER TABLE clothing_items ADD COLUMN IF NOT EXISTS warmth_min_f integer;
ALTER TABLE clothing_items ADD COLUMN IF NOT EXISTS warmth_max_f integer;
