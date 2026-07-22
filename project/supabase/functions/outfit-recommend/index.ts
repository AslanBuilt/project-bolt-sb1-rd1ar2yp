import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ClothingItem {
  id: string;
  category: string;
  subcategory: string;
  primary_color: string;
  secondary_color?: string;
  pattern: string;
  formality: string;
  season: string;
  last_worn_date?: string | null;
}

function formatRecency(item: ClothingItem, recentlyWornIds: string[]): string {
  if (!item.last_worn_date) return 'never worn';
  const days = Math.floor((Date.now() - new Date(item.last_worn_date).getTime()) / (1000 * 60 * 60 * 24));
  const flag = recentlyWornIds?.includes(item.id) ? ' — WORN RECENTLY, avoid if a suitable alternative exists' : '';
  return `last worn ${days}d ago${flag}`;
}

interface StylePreferences {
  style_tags: string[];
  formality_range_min: string;
  formality_range_max: string;
}

interface InspirationProfile {
  colorPalette: string[];
  silhouettes: string[];
  patternTrends: string[];
}

interface OutfitRecommendation {
  itemIds: string[];
  reason: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { items, activityText, preferences, weather, inspirationProfile, ratingHistory, recentlyWornIds } = await req.json();
    const wornRecentlyIds: string[] = recentlyWornIds || [];

    if (!items || items.length < 3) {
      return new Response(
        JSON.stringify({
          recommendations: [],
          error: "Need at least 3 items to generate outfits"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

    if (!geminiApiKey) {
      // Fallback to rule-based if no API key
      return new Response(
        JSON.stringify({
          recommendations: generateRuleBasedOutfits(items, activityText),
          source: "rule-based"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build context
    const styleContext = preferences?.style_tags?.length > 0
      ? `User's style preferences: ${preferences.style_tags.join(', ')}`
      : 'No specific style preferences set';

    const activityContext = activityText
      ? `Today's activity: "${activityText}"`
      : 'No specific activity planned';

    // Note: weather-inappropriate items have already been hard-filtered out of
    // `items` upstream (client-side, before either recommendation pass) based
    // on each item's warmth band vs. today's personally-calibrated felt
    // temperature - this context is narrative only, not a filtering signal.
    const weatherContext = weather
      ? `Current weather: ${weather.temp}°F, ${weather.condition}${weather.feltTemp != null ? ` (feels like ${weather.feltTemp}°F to this user)` : ''}${weather.isRainy ? '. Rain expected - if suggesting a SWEATSHIRT/JACKET, prefer one, and mention weather-readiness in the reason.' : ''}`
      : 'Weather unknown';

    // Build inspiration style profile context
    let inspirationContext = 'No inspiration images analyzed yet';
    if (inspirationProfile && (
      (inspirationProfile.colorPalette && inspirationProfile.colorPalette.length > 0) ||
      (inspirationProfile.silhouettes && inspirationProfile.silhouettes.length > 0) ||
      (inspirationProfile.patternTrends && inspirationProfile.patternTrends.length > 0)
    )) {
      const parts: string[] = [];
      if (inspirationProfile.colorPalette?.length > 0) {
        const colorCounts: Record<string, number> = {};
        for (const c of inspirationProfile.colorPalette) {
          colorCounts[c] = (colorCounts[c] || 0) + 1;
        }
        const sorted = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n}x)`);
        parts.push(`Preferred colors: ${sorted.join(', ')}`);
      }
      if (inspirationProfile.silhouettes?.length > 0) {
        const silCounts: Record<string, number> = {};
        for (const s of inspirationProfile.silhouettes) {
          silCounts[s] = (silCounts[s] || 0) + 1;
        }
        const sorted = Object.entries(silCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, n]) => `${s} (${n}x)`);
        parts.push(`Preferred silhouettes: ${sorted.join(', ')}`);
      }
      if (inspirationProfile.patternTrends?.length > 0) {
        const patCounts: Record<string, number> = {};
        for (const p of inspirationProfile.patternTrends) {
          patCounts[p] = (patCounts[p] || 0) + 1;
        }
        const sorted = Object.entries(patCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, n]) => `${p} (${n}x)`);
        parts.push(`Preferred patterns/textures: ${sorted.join(', ')}`);
      }
      inspirationContext = `User's inspiration style profile (aggregated from ${inspirationProfile.colorPalette?.length || 0}+ analyzed images):\n${parts.join('\n')}`;
    }

    // Build rating history context
    let ratingContext = '';
    if (ratingHistory) {
      const parts: string[] = [];
      if (ratingHistory.liked?.length > 0) {
        parts.push(`The user has previously loved these combinations:\n${ratingHistory.liked.map((c: string, i: number) => `  ${i + 1}. ${c}`).join('\n')}`);
      }
      if (ratingHistory.disliked?.length > 0) {
        parts.push(`The user has previously disliked these combinations (avoid repeating similar pairings):\n${ratingHistory.disliked.map((c: string, i: number) => `  ${i + 1}. ${c}`).join('\n')}`);
      }
      if (parts.length > 0) {
        ratingContext = `\n${parts.join('\n\n')}`;
      }
    }

    // Categorize items for the prompt
const tops = items.filter((i: ClothingItem) => i.category === 'shirts');
    const bottoms = items.filter((i: ClothingItem) => i.category === 'pants');
    const dresses = items.filter((i: ClothingItem) => i.category === 'shorts');
    const shoes = items.filter((i: ClothingItem) => i.category === 'shoes');
    const outerwear = items.filter((i: ClothingItem) => i.category === 'sweatshirt_jacket');

    const prompt = `You are a personal style assistant creating outfit recommendations.

${styleContext}
${inspirationContext}
${activityContext}
${weatherContext}${ratingContext}

Available wardrobe items (organized by category):

SHIRTS (${tops.length} available):
${tops.map(i => `- ${i.id}: ${i.primary_color} ${i.subcategory}, ${i.formality}, ${formatRecency(i, wornRecentlyIds)}`).join('\n')}

PANTS (${bottoms.length} available):
${bottoms.map(i => `- ${i.id}: ${i.primary_color} ${i.subcategory}, ${i.formality}, ${formatRecency(i, wornRecentlyIds)}`).join('\n')}

SHORTS (${dresses.length} available):
${dresses.map(i => `- ${i.id}: ${i.primary_color} ${i.subcategory}, ${i.formality}, ${formatRecency(i, wornRecentlyIds)}`).join('\n')}

SHOES (${shoes.length} available):
${shoes.map(i => `- ${i.id}: ${i.primary_color} ${i.subcategory}, ${i.formality}, ${formatRecency(i, wornRecentlyIds)}`).join('\n')}

SWEATSHIRT/JACKETS (${outerwear.length} available):
${outerwear.map(i => `- ${i.id}: ${i.primary_color} ${i.subcategory}, ${i.formality}, ${formatRecency(i, wornRecentlyIds)}`).join('\n')}

Rules:
1. Each outfit must be complete: a SHIRT + (PANTS or SHORTS) + SHOES
2. Optionally add a SWEATSHIRT/JACKET if weather is cold or it fits the look
3. Consider color coordination - neutral colors (black, white, gray, navy, beige) pair well with everything
4. All items should match the activity formality level
5. Where possible, prefer items whose colors, silhouettes, and patterns align with the user's inspiration style profile above
6. Avoid items marked "WORN RECENTLY" when a suitable alternative exists in the same category — vary the outfit from recent days where possible. Only reuse a recently-worn item if there's no other option in that category.
7. Learn from the user's past ratings: favor combinations similar to those they liked, and avoid combinations similar to those they disliked
8. Provide 1-3 outfit suggestions

Respond with ONLY a JSON array (no markdown, no explanation):
[
  {"itemIds": ["id1", "id2", "id3"], "reason": "Brief one-line explanation of why this works for the activity"},
  ...
]`;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
          maxOutputTokens: 2048,          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Gemini API error:', error);
      return new Response(
        JSON.stringify({
          recommendations: generateRuleBasedOutfits(items, activityText),
          source: "rule-based"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON response
    let cleanedText = text.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      
    }
    const arrayStart = cleanedText.indexOf('['); const arrayEnd = cleanedText.lastIndexOf(']'); if (arrayStart !== -1 && arrayEnd > arrayStart) { cleanedText = cleanedText.slice(arrayStart, arrayEnd + 1); }

    let recommendations: OutfitRecommendation[] = [];
    try {
      recommendations = JSON.parse(cleanedText);
    } catch {
      console.error('Failed to parse Gemini response:', cleanedText);
      return new Response(
        JSON.stringify({
          recommendations: generateRuleBasedOutfits(items, activityText),
          source: "rule-based"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate recommendations
    const validRecommendations = recommendations.filter(rec => {
      const outfitItems = items.filter((i: ClothingItem) => rec.itemIds?.includes(i.id));
      if (outfitItems.length < 2) return false;

      // Must have shoes
      const hasShoes = outfitItems.some((i: ClothingItem) => i.category === 'shoes');
      if (!hasShoes) return false;

      // Must have a shirt plus pants or shorts
      const hasShirt = outfitItems.some((i: ClothingItem) => i.category === 'shirts');
      const hasPants = outfitItems.some((i: ClothingItem) => i.category === 'pants');
      const hasShorts = outfitItems.some((i: ClothingItem) => i.category === 'shorts');

      return hasShirt && (hasPants || hasShorts);
    });

    return new Response(
      JSON.stringify({
        recommendations: validRecommendations,
        source: "ai"
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error('Error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Rule-based fallback
function generateRuleBasedOutfits(items: ClothingItem[], activityText: string): OutfitRecommendation[] {
  const recommendations: OutfitRecommendation[] = [];

  const tops = items.filter(i => i.category === 'shirts');
  const bottoms = items.filter(i => i.category === 'pants');
  const dresses = items.filter(i => i.category === 'shorts');
  const shoes = items.filter(i => i.category === 'shoes');
  const outerwear = items.filter(i => i.category === 'sweatshirt_jacket');

  // Top + Bottom + Shoes combo
  if (tops.length > 0 && bottoms.length > 0 && shoes.length > 0) {
    const top = tops[0];
    const bottom = bottoms[0];
    const shoe = shoes[0];
    const combo = [top.id, bottom.id, shoe.id];

    if (outerwear.length > 0) {
      combo.push(outerwear[0].id);
    }

    recommendations.push({
      itemIds: combo,
      reason: `A ${top.formality} look pairing ${top.primary_color} ${top.subcategory} with ${bottom.primary_color} ${bottom.subcategory}${activityText ? ` - suitable for ${activityText}` : ''}`
    });
  }

  // Shirt + Shorts + Shoes combo
        if (tops.length > 0 && dresses.length > 0 && shoes.length > 0) {
                  const top = tops[Math.min(1, tops.length - 1)];
                  const shorts = dresses[0];
                  const shoe = shoes[Math.min(1, shoes.length - 1)];

                  recommendations.push({
                              itemIds: [top.id, shorts.id, shoe.id],
                              reason: `A relaxed ${shorts.formality} pairing of ${top.primary_color} ${top.subcategory} with ${shorts.primary_color} ${shorts.subcategory}${activityText ? ` - works well for ${activityText}` : ''}`
                  });
        }

  // Second top+bottom combo if available
  if (tops.length > 1 && bottoms.length > 1 && shoes.length >= 1) {
    const top = tops[1];
    const bottom = bottoms[1];
    const shoe = shoes[Math.min(1, shoes.length - 1)];

    recommendations.push({
      itemIds: [top.id, bottom.id, shoe.id],
      reason: `An alternative ${top.formality} option with ${top.primary_color} ${top.subcategory} and ${bottom.primary_color} ${bottom.subcategory}`
    });
  }

  return recommendations;
}
