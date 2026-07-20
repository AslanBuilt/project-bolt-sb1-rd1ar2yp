-- Backfill photo_url column: convert full public URLs to storage paths
-- Before: https://xxx.supabase.co/storage/v1/object/public/clothing-photos/user-id/image.jpg
-- After: user-id/image.jpg

UPDATE clothing_items
SET photo_url = REGEXP_REPLACE(
  photo_url,
  '^.*/storage/v1/object/(?:public|sign)/[^/]+/(.+)$',
  '\1'
)
WHERE photo_url LIKE '%/storage/v1/object/%';
