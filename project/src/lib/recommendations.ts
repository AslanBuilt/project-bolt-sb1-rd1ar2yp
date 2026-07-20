import { ClothingItem, Formality, Season } from '../types';

// Color harmony rules - which colors work well together
const COLOR_HARMONY: Record<string, string[]> = {
  neutral: ['black', 'white', 'gray', 'navy', 'beige', 'cream', 'tan', 'brown'],
  warm: ['red', 'orange', 'yellow', 'burgundy', 'brown', 'beige', 'cream', 'gold'],
  cool: ['blue', 'navy', 'purple', 'teal', 'turquoise', 'green', 'silver'],
  earth: ['brown', 'beige', 'tan', 'cream', 'olive', 'burgundy', 'gold'],
  accent: ['red', 'pink', 'purple', 'teal', 'turquoise', 'emerald', 'gold', 'silver'],
};

// Colors that generally clash and should be avoided together
const CLASHING_PAIRS: [string, string][] = [
  ['red', 'pink'],
  ['orange', 'pink'],
  ['yellow', 'purple'],
  ['green', 'red'],
];

// Complementary color pairs (opposite on color wheel - can work with care)
const COMPLEMENTARY_PAIRS: [string, string][] = [
  ['blue', 'orange'],
  ['red', 'green'],
  ['purple', 'yellow'],
  ['teal', 'burgundy'],
];

export interface OutfitScore {
  item: ClothingItem;
  rotationScore: number;
  colorScore: number;
  formalityScore: number;
  seasonScore: number;
  totalScore: number;
}

export interface RecommendationContext {
  items: ClothingItem[];
  formality: Formality;
  season: Season;
  activityText?: string;
  recentlyWornIds: string[];
  pastRatings: { item_id: string; rating: 'up' | 'down' }[];
}

/**
 * Calculate how recently an item was worn (higher = worn longer ago = better)
 */
export function calculateRotationScore(item: ClothingItem): number {
  if (!item.last_worn_date) return 100; // Never worn = highest priority

  const daysSinceWorn = Math.floor(
    (Date.now() - new Date(item.last_worn_date).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Score from 0-100 based on days since worn
  // 0 days = 0, 5+ days = 100
  return Math.min(100, daysSinceWorn * 20);
}

/**
 * Check if two colors work well together
 */
export function colorsWorkTogether(color1: string, color2: string): { score: number; reason: string } {
  const c1 = color1.toLowerCase();
  const c2 = color2.toLowerCase();

  if (c1 === c2) return { score: 50, reason: 'same color' };

  // Check for clashing pairs
  for (const [a, b] of CLASHING_PAIRS) {
    if ((c1 === a && c2 === b) || (c1 === b && c2 === a)) {
      return { score: 20, reason: 'potentially clashing' };
    }
  }

  // Check if both are neutral - always works
  if (COLOR_HARMONY.neutral.includes(c1) && COLOR_HARMONY.neutral.includes(c2)) {
    return { score: 95, reason: 'classic neutral pairing' };
  }

  // Check if one is neutral - usually works
  if (COLOR_HARMONY.neutral.includes(c1) || COLOR_HARMONY.neutral.includes(c2)) {
    return { score: 90, reason: 'neutral with accent' };
  }

  // Check if both are in same harmony group
  for (const group of Object.values(COLOR_HARMONY)) {
    if (group.includes(c1) && group.includes(c2)) {
      return { score: 80, reason: 'harmonious color family' };
    }
  }

  // Complementary colors can work with caution
  for (const [a, b] of COMPLEMENTARY_PAIRS) {
    if ((c1 === a && c2 === b) || (c1 === b && c2 === a)) {
      return { score: 60, reason: 'bold complementary pairing' };
    }
  }

  return { score: 50, reason: 'unknown combination' };
}

/**
 * Calculate color coordination score for a potential outfit
 */
export function calculateColorScore(items: ClothingItem[]): number {
  if (items.length < 2) return 100;

  let totalScore = 0;
  let pairs = 0;

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const { score } = colorsWorkTogether(items[i].primary_color, items[j].primary_color);
      totalScore += score;
      pairs++;
    }
  }

  return pairs > 0 ? totalScore / pairs : 100;
}

/**
 * Calculate formality matching score
 */
export function calculateFormalityScore(items: ClothingItem[], targetFormality: Formality): number {
  const formalityRank: Record<Formality, number> = {
    'casual': 0,
    'smart-casual': 1,
    'formal': 2,
  };

  const target = formalityRank[targetFormality];
  let totalDiff = 0;

  for (const item of items) {
    const itemRank = formalityRank[item.formality];
    const diff = Math.abs(itemRank - target);

    // Items more than 1 tier away from target lose points
    totalDiff += diff;
  }

  // Average difference, inverted to score (0 diff = 100, max diff = 0)
  const avgDiff = totalDiff / items.length;
  return Math.max(0, 100 - avgDiff * 40);
}

/**
 * Calculate season appropriateness score
 */
export function calculateSeasonScore(items: ClothingItem[], currentSeason: Season): number {
  let totalScore = 0;

  for (const item of items) {
    if (item.season === 'all') {
      totalScore += 100;
    } else if (item.season === currentSeason) {
      totalScore += 100;
    } else {
      // Wrong season = lower score
      totalScore += 30;
    }
  }

  return totalScore / items.length;
}

/**
 * Get season from month
 */
export function getCurrentSeason(): Season {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}

/**
 * Detect formality from activity text
 */
export function detectFormality(text: string): Formality {
  const lower = text.toLowerCase();

  // Formal triggers
  if (/wedding|gala|black.?tie|interview|presentation|client|pitch|ceremony/i.test(lower)) {
    return 'formal';
  }

  // Smart casual triggers
  if (/work|office|business|lunch|dinner|date|brunch|meeting|restaurant|networking|conference/i.test(lower)) {
    return 'smart-casual';
  }

  // Casual (default)
  return 'casual';
}

/**
 * Get outfit type suggestions based on activity
 */
export function getActivityHints(text: string): {
  preferDress: boolean;
  preferComfort: boolean;
  preferLayering: boolean;
  avoidHeels: boolean;
  activityKeywords: string[];
} {
  const lower = text.toLowerCase();

  const hints = {
    preferDress: false,
    preferComfort: false,
    preferLayering: false,
    avoidHeels: false,
    activityKeywords: [] as string[],
  };

  // Extract keywords
  const keywords = ['gym', 'workout', 'hiking', 'running', 'beach', 'party', 'club', 'date', 'wedding'];
  for (const kw of keywords) {
    if (lower.includes(kw)) {
      hints.activityKeywords.push(kw);
    }
  }

  // Activity-based preferences
  if (/gym|workout|running|hiking|walking|cycling|yoga/i.test(lower)) {
    hints.preferComfort = true;
    hints.avoidHeels = true;
  }

  if (/wedding|formal|gala|ceremony/i.test(lower)) {
    hints.preferDress = true;
  }

  if (/beach|pool|vacation|summer/i.test(lower)) {
    hints.preferDress = true;
  }

  if (/cold|rain|winter|snow|chilly/i.test(lower)) {
    hints.preferLayering = true;
  }

  return hints;
}

/**
 * Filter and score items for outfit recommendations
 */
export function filterAndScoreItems(context: RecommendationContext): {
  tops: OutfitScore[];
  bottoms: OutfitScore[];
  dresses: OutfitScore[];
  shoes: OutfitScore[];
  outerwear: OutfitScore[];
} {
  const { items, formality, season, recentlyWornIds, pastRatings } = context;

  const categorize = (category: string) => {
    return items
      .filter(item => item.category === category)
      .map(item => {
        const rotationScore = calculateRotationScore(item);

        // Boost items that were rated well in past outfits
        let ratingBonus = 0;
        const pastRating = pastRatings.find(r => r.item_id === item.id);
        if (pastRating?.rating === 'up') ratingBonus = 15;
        if (pastRating?.rating === 'down') ratingBonus = -20;

        // Penalize recently worn
        const recentlyWornPenalty = recentlyWornIds.includes(item.id) ? -30 : 0;

        const formalityDiff = Math.abs(
          (formality === 'casual' ? 0 : formality === 'smart-casual' ? 1 : 2) -
          (item.formality === 'casual' ? 0 : item.formality === 'smart-casual' ? 1 : 2)
        );
        const formalityScore = 100 - formalityDiff * 30;

        const seasonScore = item.season === 'all' || item.season === season ? 100 : 50;

        const totalScore = rotationScore + ratingBonus + recentlyWornPenalty + formalityScore + seasonScore;

        return { item, rotationScore, colorScore: 0, formalityScore, seasonScore, totalScore };
      })
      .sort((a, b) => b.totalScore - a.totalScore);
  };

  return {
tops: categorize('shirts'),
        bottoms: categorize('pants'),
        dresses: categorize('shorts'),
        shoes: categorize('shoes'),
        outerwear: categorize('sweatshirt_jacket'),
  };
}

/**
 * Generate rule-based outfit candidates
 */
export function generateOutfitCandidates(
  scores: ReturnType<typeof filterAndScoreItems>,
  context: RecommendationContext,
  maxOutfits: number = 3
): ClothingItem[][] {
  const { tops, bottoms, dresses, shoes, outerwear } = scores;
  const candidates: { items: ClothingItem[]; score: number }[] = [];

  // Strategy 1: Top + Bottom + Shoes
  if (tops.length > 0 && bottoms.length > 0 && shoes.length > 0) {
    const topCandidates = tops.slice(0, 5);
    const bottomCandidates = bottoms.slice(0, 5);
    const shoeCandidates = shoes.slice(0, 3);

    for (const top of topCandidates) {
      for (const bottom of bottomCandidates) {
        for (const shoe of shoeCandidates) {
          const items = [top.item, bottom.item, shoe.item];
          const colorScore = calculateColorScore(items);
          const formalityScore = calculateFormalityScore(items, context.formality);
          const seasonScore = calculateSeasonScore(items, context.season);
          const outfitScore = colorScore + formalityScore + seasonScore + top.totalScore + bottom.totalScore + shoe.totalScore;

          candidates.push({ items, score: outfitScore });
        }
      }
    }
  }

  // Strategy 2: Dress + Shoes
  if (dresses.length > 0 && shoes.length > 0) {
    const dressCandidates = dresses.slice(0, 5);
    const shoeCandidates = shoes.slice(0, 3);

    for (const dress of dressCandidates) {
      for (const shoe of shoeCandidates) {
        const items = [dress.item, shoe.item];
        const colorScore = calculateColorScore(items);
        const formalityScore = calculateFormalityScore(items, context.formality);
        const seasonScore = calculateSeasonScore(items, context.season);
        const outfitScore = colorScore + formalityScore + seasonScore + dress.totalScore + shoe.totalScore;

        candidates.push({ items, score: outfitScore });
      }
    }
  }

  // Sort by score and return top candidates
  candidates.sort((a, b) => b.score - a.score);

  // Remove duplicates (same top+bottom combo)
  const seen = new Set<string>();
  const unique: ClothingItem[][] = [];

  for (const candidate of candidates) {
    const key = candidate.items.map(i => i.id).sort().join('-');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate.items);
      if (unique.length >= maxOutfits) break;
    }
  }

  return unique;
}
