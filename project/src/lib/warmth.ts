import { ClothingCategory } from '../types';

export interface WarmthBand {
  min: number;
  max: number;
}

// Rough warmth bands in °F, inferred from category/subcategory keywords -
// zero AI cost, no extra Gemini call. Deliberately generous/overlapping
// ranges since this is a coarse "would this be uncomfortable" filter, not a
// precise thermal model.
const SUBCATEGORY_WARMTH: Record<string, WarmthBand> = {
  'tank top': { min: 70, max: 115 },
  'crop top': { min: 70, max: 115 },
  't-shirt': { min: 60, max: 115 },
  polo: { min: 55, max: 105 },
  'button-down': { min: 50, max: 95 },
  blouse: { min: 55, max: 95 },

  'denim shorts': { min: 65, max: 115 },
  'athletic shorts': { min: 60, max: 115 },
  'chino shorts': { min: 65, max: 115 },
  'cargo shorts': { min: 65, max: 115 },

  leggings: { min: 35, max: 90 },
  jeans: { min: 30, max: 95 },
  chinos: { min: 40, max: 95 },
  trousers: { min: 35, max: 90 },
  joggers: { min: 30, max: 90 },

  sneakers: { min: 35, max: 115 },
  loafers: { min: 40, max: 100 },
  flats: { min: 45, max: 100 },
  athletic: { min: 35, max: 115 },
  sandals: { min: 65, max: 115 },
  boots: { min: 15, max: 75 },
  heels: { min: 40, max: 95 },

  hoodie: { min: 30, max: 70 },
  sweatshirt: { min: 30, max: 70 },
  sweater: { min: 25, max: 65 },
  cardigan: { min: 35, max: 72 },
  jacket: { min: 25, max: 68 },
  windbreaker: { min: 35, max: 72 },
  vest: { min: 30, max: 70 },
  blazer: { min: 38, max: 78 },
  coat: { min: -10, max: 55 },
};

// Category-level fallback for subcategories not in the table above (e.g. a
// free-typed subcategory that doesn't match a known keyword).
const CATEGORY_WARMTH: Record<ClothingCategory, WarmthBand> = {
  shirts: { min: 55, max: 110 },
  pants: { min: 30, max: 95 },
  shorts: { min: 60, max: 115 },
  shoes: { min: 35, max: 105 },
  sweatshirt_jacket: { min: 25, max: 70 },
};

export function getWarmthBand(category: ClothingCategory, subcategory: string): WarmthBand {
  const key = subcategory.toLowerCase().trim();
  return SUBCATEGORY_WARMTH[key] || CATEGORY_WARMTH[category] || { min: -50, max: 150 };
}
