/*
# Add AI confidence tracking columns

1. Modified Tables
- `clothing_items`
  - `ai_confidence` (double precision, default 1.0) — overall AI confidence score 0-1
  - `ai_uncertain_fields` (text[], default '{}') — list of fields where AI confidence < 0.7 (e.g. ['pattern', 'formality'])
- `inspiration_images`
  - `confirmed` (boolean, default false) — true once the user has reviewed and confirmed the AI-extracted style traits

2. Notes
- All new columns have safe defaults so existing rows are unaffected.
- `ai_confidence` of 1.0 means "fully confident" (the default for manually-added items).
- `ai_uncertain_fields` is empty for confident items; populated only when AI tagging returns low confidence on specific fields.
- `confirmed` on inspiration_images gates whether an image's analysis is included in the recommendation prompt — unconfirmed images are shown to the user first for review.
*/

ALTER TABLE clothing_items
  ADD COLUMN IF NOT EXISTS ai_confidence double precision DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS ai_uncertain_fields text[] DEFAULT '{}';

ALTER TABLE inspiration_images
  ADD COLUMN IF NOT EXISTS confirmed boolean DEFAULT false;
