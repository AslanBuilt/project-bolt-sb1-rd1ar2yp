export type ClothingCategory = 'shirts' | 'sweatshirt_jacket' | 'pants' | 'shorts' | 'shoes';
export type Formality = 'casual' | 'smart-casual' | 'formal';
export type Season = 'spring' | 'summer' | 'fall' | 'winter' | 'all';
export type Pattern = 'solid' | 'striped' | 'plaid' | 'floral' | 'geometric' | 'printed' | 'other';

export interface ClothingItem {
  id: string;
  user_id: string;
  photo_url: string;
  category: ClothingCategory;
  subcategory: string;
  primary_color: string;
  secondary_color?: string;
  pattern: Pattern;
  formality: Formality;
  season: Season;
  last_worn_date?: string;
  times_worn: number;
  favorite: boolean;
  retired: boolean;
  created_at: string;
  ai_confidence?: number;
  ai_uncertain_fields?: string[];
}

export interface StylePreferences {
  user_id: string;
  style_tags: string[];
  inspiration_photos?: string[];
  formality_range: {
    min: Formality;
    max: Formality;
  };
  onboarding_completed: boolean;
}

export interface InspirationImage {
  id: string;
  user_id: string;
  photo_url: string;
  color_palette: string[];
  silhouette: string;
  pattern_trends: string[];
  ai_analysis: Record<string, unknown>;
  analyzed: boolean;
  confirmed: boolean;
  created_at: string;
}

export type OutfitSource = 'rule-based' | 'ai';

export interface Outfit {
  id: string;
  user_id: string;
  date: string;
  item_ids: string[];
  items?: ClothingItem[];
  source: OutfitSource;
  activity_text?: string;
  worn: boolean;
  rating?: 'up' | 'down';
  created_at: string;
}

export const STYLE_TAGS = [
  'minimalist',
  'streetwear',
  'business casual',
  'athleisure',
  'preppy',
  'bohemian',
  'vintage',
  'urban',
  'classic',
  'trendy',
  'sporty',
  'romantic',
  'edgy',
  'coastal',
] as const;

export const CATEGORY_SUBCATEGORIES: Record<ClothingCategory, string[]> = {
  shirts: ['t-shirt', 'button-down', 'polo', 'tank top', 'blouse', 'crop top'],
  pants: ['jeans', 'trousers', 'leggings', 'joggers', 'chinos'],
  shorts: ['denim shorts', 'athletic shorts', 'chino shorts', 'cargo shorts'],
  shoes: ['sneakers', 'boots', 'heels', 'flats', 'sandals', 'loafers', 'athletic'],
  sweatshirt_jacket: ['hoodie', 'sweatshirt', 'sweater', 'cardigan', 'jacket', 'coat', 'blazer', 'vest', 'windbreaker'],
};

export const COLORS = [
  'black', 'white', 'gray', 'navy', 'blue', 'red', 'pink', 'purple',
  'green', 'yellow', 'orange', 'brown', 'beige', 'cream', 'tan', 'burgundy',
  'teal', 'turquoise', 'gold', 'silver', 'multi-color',
] as const;
