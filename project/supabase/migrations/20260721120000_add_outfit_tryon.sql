/*
# Outfit try-on visualization

1. Changes
- `style_preferences.base_photo_url`: path to the user's uploaded try-on base photo (private storage, same bucket/pattern as clothing photos)
- `outfits.generated_image_url`: path to the cached AI-generated try-on visualization for that day's outfit, so it isn't regenerated on every view
*/

ALTER TABLE style_preferences ADD COLUMN IF NOT EXISTS base_photo_url text;
ALTER TABLE outfits ADD COLUMN IF NOT EXISTS generated_image_url text;
