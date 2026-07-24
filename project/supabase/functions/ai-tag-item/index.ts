import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TagResult {
  category: string;
  subcategory: string;
  primaryColor: string;
  secondaryColor?: string;
  pattern: string;
  formality: string;
  confidence: number;
  fieldConfidence: {
    category: number;
    subcategory: number;
    primaryColor: number;
    secondaryColor: number;
    pattern: number;
    formality: number;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { imageUrl, imageBase64 } = await req.json();

    if (!imageUrl && !imageBase64) {
      return new Response(
        JSON.stringify({ error: "No image provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Moved to the paid key (2026-07-24) to get off the free tier's shared
    // 20 req/day cap. The paid project's key can't call gemini-2.5-flash for
    // text at all (live 404: "no longer available to new users" - a
    // project-specific restriction, confirmed via a real call, not a general
    // model deprecation), so the model changes along with the key. To revert
    // this function to the free tier, change BOTH constants back:
    // GEMINI_KEY_SECRET -> "GEMINI_API_KEY", GEMINI_MODEL -> "gemini-2.5-flash".
    // See CLAUDE.md "Gemini API key routing".
    const GEMINI_KEY_SECRET = "GEMINI_PAID_API_KEY";
    const GEMINI_MODEL = "gemini-3.5-flash";
    const geminiApiKey = Deno.env.get(GEMINI_KEY_SECRET);
    console.log(`ai-tag-item: using Gemini key from secret "${GEMINI_KEY_SECRET}", model "${GEMINI_MODEL}"`);
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prepare image data for Gemini
    let imagePart: { inlineData: { mimeType: string; data: string } } | null = null;
    if (imageBase64) {
      // Extract mime type from base64 data URL or default to jpeg
      const matches = imageBase64.match(/^data:(image\/[^;]+);base64,(.+)$/);
      const mimeType = matches?.[1] || 'image/jpeg';
      const data = matches?.[2] || imageBase64;
      imagePart = {
        inlineData: { mimeType, data }
      };
    } else if (imageUrl) {
      // Fetch image and convert to base64
      const imageResponse = await fetch(imageUrl);
      const imageBuffer = await imageResponse.arrayBuffer();
      const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
      // Chunked to avoid "Maximum call stack size exceeded" from spreading a
      // large typed array directly into String.fromCharCode (found live
      // during this change's verification - garment photos can be several MB).
      const bytes = new Uint8Array(imageBuffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      imagePart = {
        inlineData: { mimeType, data: base64 }
      };
    }

    if (!imagePart) {
      return new Response(
        JSON.stringify({ error: "Could not process image" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const prompt = `Analyze this clothing item image and detect its attributes.

Respond with ONLY a JSON object (no markdown, no explanation) with these fields:
{
  "category": "shirts" | "sweatshirt_jacket" | "pants" | "shorts" | "shoes",
  "subcategory": "specific type like t-shirt, jeans, sneakers, etc",
  "primaryColor": "main color name",
  "secondaryColor": "secondary color name or null",
  "pattern": "solid" | "striped" | "plaid" | "floral" | "geometric" | "printed" | "other",
  "formality": "casual" | "smart-casual" | "formal",
  "confidence": 0-1 overall score,
  "fieldConfidence": {
    "category": 0-1,
    "subcategory": 0-1,
    "primaryColor": 0-1,
    "secondaryColor": 0-1,
    "pattern": 0-1,
    "formality": 0-1
  }
}

Guidelines:
- category must be exactly one of: shirts, sweatshirt_jacket, pants, shorts, shoes
- For shirts: t-shirt, button-down, polo, tank top, blouse, crop top
- For sweatshirt_jacket: hoodie, sweatshirt, sweater, cardigan, jacket, coat, blazer, vest, windbreaker
- For pants: jeans, trousers, leggings, joggers, chinos
- For shorts: denim shorts, athletic shorts, chino shorts, cargo shorts
- For shoes: sneakers, boots, heels, flats, sandals, loafers, athletic
- Use lowercase, simple color names like black, white, navy, blue, red, gray, brown, beige, green, burgundy, tan, cream, pink, purple, yellow, orange
- Pattern should be the dominant visual pattern
- Formality: casual = everyday wear, smart-casual = office/nice restaurant, formal = business/special occasions`;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`,      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                imagePart
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024,
            thinkingConfig: { thinkingBudget: 0 },
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Gemini API error:', error);

      // The $10 prepaid balance stops serving requests immediately at $0 -
      // this hasn't been exercised against a real drained balance, but
      // Gemini's documented error shapes for that case are a 429/403 with
      // "billing"/"quota" language, distinct from an ordinary transient
      // per-minute rate limit (which still has a "retry in Ns" hint).
      const lowerError = error.toLowerCase();
      const isBillingIssue = response.status === 403 || (response.status === 429 && lowerError.includes('billing'));
      if (isBillingIssue) {
        return new Response(
          JSON.stringify({
            error: "AI tagging is temporarily unavailable (Gemini quota/billing limit reached). Please try again later.",
            billingIssue: true,
          }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (response.status === 429) {
        const retryMatch = error.match(/retry in (\d+(?:\.\d+)?)s/i);
        const retryAfter = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 15;
        return new Response(
          JSON.stringify({ error: "Rate limited", retryAfter }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfter) } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Failed to analyze image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse the JSON response (strip any markdown code blocks)
    let cleanedText = text.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }

    let tags: TagResult;
    try {
      tags = JSON.parse(cleanedText);
    } catch {
      // If parsing fails, return defaults
      tags = {
        category: 'shirts',
        subcategory: 'shirt',
        primaryColor: 'gray',
        pattern: 'solid',
        formality: 'casual',
        confidence: 0.5,
        fieldConfidence: {
          category: 0.5, subcategory: 0.5, primaryColor: 0.5,
          secondaryColor: 0.5, pattern: 0.5, formality: 0.5,
        }
      };
    }

    // Validate and normalize
        const validCategories = ['shirts', 'sweatshirt_jacket', 'pants', 'shorts', 'shoes'];
    const validPatterns = ['solid', 'striped', 'plaid', 'floral', 'geometric', 'printed', 'other'];
    const validFormalities = ['casual', 'smart-casual', 'formal'];

    if (!validCategories.includes(tags.category)) {
      tags.category = 'shirts';
    }
    if (!validPatterns.includes(tags.pattern)) {
      tags.pattern = 'solid';
    }
    if (!validFormalities.includes(tags.formality)) {
      tags.formality = 'casual';
    }

    // Ensure fieldConfidence exists and has valid values
    if (!tags.fieldConfidence) {
      tags.fieldConfidence = {
        category: tags.confidence, subcategory: tags.confidence,
        primaryColor: tags.confidence, secondaryColor: tags.confidence,
        pattern: tags.confidence, formality: tags.confidence,
      };
    } else {
      const fc = tags.fieldConfidence;
      const clamp = (v: number | undefined) => Math.max(0, Math.min(1, v ?? tags.confidence));
      tags.fieldConfidence = {
        category: clamp(fc.category),
        subcategory: clamp(fc.subcategory),
        primaryColor: clamp(fc.primaryColor),
        secondaryColor: clamp(fc.secondaryColor),
        pattern: clamp(fc.pattern),
        formality: clamp(fc.formality),
      };
    }

    return new Response(
      JSON.stringify({ tags }),
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
