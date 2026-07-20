-- Update clothing_items category taxonomy from
-- (top, bottom, outerwear, shoes, accessory, dress)
-- to (shirts, sweatshirt_jacket, pants, shorts, shoes)

ALTER TABLE clothing_items DROP CONSTRAINT IF EXISTS clothing_items_category_check;

UPDATE clothing_items
SET category = CASE
  WHEN category = 'top' THEN 'shirts'
  WHEN category = 'outerwear' THEN 'sweatshirt_jacket'
  WHEN category = 'bottom' AND subcategory ILIKE '%short%' THEN 'shorts'
  WHEN category = 'bottom' THEN 'pants'
  WHEN category = 'dress' THEN 'shirts'
  WHEN category = 'accessory' THEN 'shirts'
  ELSE category
END
WHERE category NOT IN ('shirts', 'sweatshirt_jacket', 'pants', 'shorts', 'shoes');

ALTER TABLE clothing_items ADD CONSTRAINT clothing_items_category_check
  CHECK (category IN ('shirts', 'sweatshirt_jacket', 'pants', 'shorts', 'shoes'));
