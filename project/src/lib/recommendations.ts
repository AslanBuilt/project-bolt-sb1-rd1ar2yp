import { ClothingItem, Formality, Season } from '../types';

// Real color-wheel logic (Wikipedia: Color scheme), replacing the previous
// ad-hoc harmony/clash tables. Neutrals (per the same source - "black and
// white have long been known to combine well with almost any other colors")
// skip hue-distance scoring entirely and get a flat pairing bonus instead.
const NEUTRAL_COLORS = ['black', 'white', 'gray', 'navy', 'beige', 'denim'];

// Approximate hue in degrees (0-360) per tagged color name. A hardcoded
// name->hue lookup is enough - color is already a tagged field per item, not
// extracted from the photo itself.
const COLOR_HUE_MAP: Record<string, number> = {
  red: 0,
  burgundy: 345,
  pink: 330,
  purple: 275,
  blue: 210,
  turquoise: 185,
  teal: 175,
  green: 120,
  yellow: 55,
  cream: 55,
  gold: 45,
  tan: 35,
  brown: 25,
  orange: 30,
  silver: 45,
};

function getHue(color: string): number | null {
  const key = color.toLowerCase().trim();
  return key in COLOR_HUE_MAP ? COLOR_HUE_MAP[key] : null;
}

export interface OutfitScore {
  item: ClothingItem;
  rotationScore: number;
  colorScore: number;
  formalityScore: number;
  seasonScore: number;
  totalScore: number;
}

export interface InspirationProfile {
  colorPalette: string[];
  silhouettes: string[];
  patternTrends: string[];
}

export interface RecommendationContext {
  items: ClothingItem[];
  formality: Formality;
  season: Season;
  activityText?: string;
  recentlyWornIds: string[];
  pastRatings: { item_id: string; rating: 'up' | 'down' }[];
  inspirationProfile?: InspirationProfile | null;
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
 * Real color-wheel pairing score between two tagged colors (Wikipedia: Color
 * scheme). Neutrals pair with anything (flat bonus, no hue math needed). For
 * two chromatic colors, hue distance is bucketed into analogous (~30°),
 * triadic (~120°), or complementary/split-complementary (~150-180°) bands,
 * each with a modest bonus - the bands are intentionally close together
 * since color harmony is subjective; this is a scoring nudge, never a hard
 * filter. An unmapped color name (e.g. "multi-color", or a custom tag) fails
 * safe to a small neutral-adjacent default rather than erroring or excluding
 * the item.
 */
export function colorsWorkTogether(color1: string, color2: string): { score: number; reason: string } {
  const c1 = color1.toLowerCase().trim();
  const c2 = color2.toLowerCase().trim();

  if (c1 === c2) return { score: 75, reason: 'same color' };

  if (NEUTRAL_COLORS.includes(c1) && NEUTRAL_COLORS.includes(c2)) {
    return { score: 95, reason: 'classic neutral pairing' };
  }
  if (NEUTRAL_COLORS.includes(c1) || NEUTRAL_COLORS.includes(c2)) {
    return { score: 90, reason: 'neutral with accent' };
  }

  const h1 = getHue(c1);
  const h2 = getHue(c2);
  if (h1 === null || h2 === null) {
    return { score: 60, reason: 'unmapped color, default pairing' };
  }

  const diff = Math.abs(h1 - h2);
  const distance = Math.min(diff, 360 - diff);

  if (distance <= 15) return { score: 65, reason: 'near-identical hues' };
  if (distance <= 45) return { score: 70, reason: 'analogous hues (~30° apart)' };
  if (distance <= 100) return { score: 55, reason: 'unrelated hues' };
  if (distance <= 140) return { score: 78, reason: 'triadic hues (~120° apart)' };
  if (distance <= 165) return { score: 82, reason: 'split-complementary hues' };
  return { score: 88, reason: 'complementary hues (~180° apart)' };
}

/**
 * Best color relationship between two items, considering each item's
 * secondary_color alongside its primary_color - e.g. a striped shirt's
 * accent color complementing the pants even if the primary colors alone
 * don't relate as strongly.
 */
function bestColorMatch(a: ClothingItem, b: ClothingItem): { score: number; reason: string } {
  const aColors = [a.primary_color, a.secondary_color].filter((c): c is string => Boolean(c));
  const bColors = [b.primary_color, b.secondary_color].filter((c): c is string => Boolean(c));

  let best = colorsWorkTogether(a.primary_color, b.primary_color);
  for (const ac of aColors) {
    for (const bc of bColors) {
      const result = colorsWorkTogether(ac, bc);
      if (result.score > best.score) best = result;
    }
  }
  return best;
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
      const { score } = bestColorMatch(items[i], items[j]);
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
  const { items, formality, season, recentlyWornIds, pastRatings, inspirationProfile } = context;

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

        // Boost items whose color/pattern align with the user's confirmed
        // inspiration profile, so inspiration still has an effect on days the
        // AI pass isn't used (fails, rate-limited, etc.) - not just the AI pass.
        let inspirationBonus = 0;
        const color = item.primary_color.toLowerCase();
        if (inspirationProfile?.colorPalette?.some(c => {
          const cl = c.toLowerCase();
          return cl === color || cl.includes(color) || color.includes(cl);
        })) {
          inspirationBonus += 15;
        }
        const pattern = item.pattern.toLowerCase();
        if (inspirationProfile?.patternTrends?.some(p => {
          const pl = p.toLowerCase();
          return pl.includes(pattern) || pattern.includes(pl);
        })) {
          inspirationBonus += 10;
        }

        const totalScore = rotationScore + ratingBonus + recentlyWornPenalty + formalityScore + seasonScore + inspirationBonus;

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
