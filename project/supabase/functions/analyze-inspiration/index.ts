import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface InspirationAnalysis {
  colorPalette: string[];
  silhouette: string;
  patternTrends: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { imageBase64, imageUrl } = await req.json();

    if (!imageBase64 && !imageUrl) {
      console.error('analyze-inspiration: no image provided in request body');
      return new Response(
        JSON.stringify({ error: "No image provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      console.error('analyze-inspiration: GEMINI_API_KEY env var is not set');
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let imagePart: { inlineData: { mimeType: string; data: string } } | null = null;

    if (imageBase64) {
      const matches = imageBase64.match(/^data:(image\/[^;]+);base64,(.+)$/);
      const mimeType = matches?.[1] || 'image/jpeg';
      const data = matches?.[2] || imageBase64;
      imagePart = { inlineData: { mimeType, data } };
    } else if (imageUrl) {
      console.log('analyze-inspiration: fetching image from URL:', imageUrl.substring(0, 80) + '...');
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        console.error('analyze-inspiration: failed to fetch image URL, status:', imageResponse.status, imageResponse.statusText);
        return new Response(
          JSON.stringify({ error: "Failed to fetch image from URL" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const imageBuffer = await imageResponse.arrayBuffer();
      const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
      const bytes = new Uint8Array(imageBuffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      imagePart = { inlineData: { mimeType, data: base64 } };
    }

    if (!imagePart) {
      console.error('analyze-inspiration: image processing produced null imagePart');
      return new Response(
        JSON.stringify({ error: "Could not process image" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const prompt = `Analyze this fashion/outfit inspiration image and extract style attributes for building a user's style profile.

This image may take one of several forms:
- A flat-lay: isolated clothing items and accessories arranged on a plain background, with NO person present (like a Pinterest outfit board).
- A product collage: multiple garment photos cut out and arranged together.
- A photo of a person wearing an outfit.
- A mood board or style collage.

Regardless of which form the image takes, extract style attributes from the garments, colors, and textures visible. Do NOT assume a person is present — if the image is a flat-lay or product collage, infer the overall silhouette and fit from the garment shapes themselves (e.g. loose-fitting top + slim pants = "relaxed top with slim bottom", oversized blazer = "oversized and structured").

Respond with ONLY a JSON object (no markdown fences, no explanation) with these fields:
{
  "colorPalette": ["dominant color names", "up to 5 colors"],
  "silhouette": "brief description of the overall silhouette/fit impression, inferred from garment shapes if no person is visible (e.g. 'oversized and relaxed', 'tailored and fitted', 'flowy and draped', 'cropped and structured', 'relaxed top with slim bottom')",
  "patternTrends": ["pattern or texture descriptors", "up to 4 items like 'striped', 'color-block', 'textured knit', 'monochrome', 'denim', 'leather'"]
}

Guidelines:
- Use lowercase, simple color names (black, white, navy, blue, red, gray, brown, beige, green, burgundy, tan, cream, pink, purple, yellow, orange, olive, teal, gold, silver)
- For flat-lay images, describe the silhouette as the combined impression of the garment shapes — how the outfit would drape on a body based on the cuts and proportions of the items shown.
- Pattern trends should capture visual patterns, textures, fabric types, and styling techniques visible in the image.
- If the image is not fashion-related, still extract whatever visual style cues you can.
- Always return a valid JSON object, even if some fields are sparse.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
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
            temperature: 0.2,
            maxOutputTokens: 400,
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('analyze-inspiration: Gemini API returned non-OK status:', response.status, response.statusText);
      console.error('analyze-inspiration: Gemini error body:', errorText);
      return new Response(
        JSON.stringify({ error: "Failed to analyze image", detail: `Gemini API ${response.status}: ${errorText.substring(0, 200)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();

    // Check for prompt-level blocking / safety filters
    if (result.promptFeedback?.blockReason) {
      console.error('analyze-inspiration: prompt blocked by safety filters:', result.promptFeedback.blockReason);
      return new Response(
        JSON.stringify({ error: "Image blocked by safety filters", detail: result.promptFeedback.blockReason }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const candidates = result.candidates;
    if (!candidates || candidates.length === 0) {
      console.error('analyze-inspiration: Gemini returned no candidates. Full response:', JSON.stringify(result).substring(0, 500));
      return new Response(
        JSON.stringify({ error: "No analysis generated", detail: "Gemini returned empty candidates" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const finishReason = candidates[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.error('analyze-inspiration: Gemini finished with non-STOP reason:', finishReason);
    }

    const text = candidates[0]?.content?.parts?.[0]?.text || '';

    if (!text || text.trim().length === 0) {
      console.error('analyze-inspiration: Gemini returned empty text. finishReason:', finishReason, 'candidate:', JSON.stringify(candidates[0]).substring(0, 300));
      return new Response(
        JSON.stringify({ error: "Empty analysis response", detail: `finishReason: ${finishReason || 'unknown'}` }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let cleanedText = text.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }

    let analysis: InspirationAnalysis;
    try {
      const parsed = JSON.parse(cleanedText);
      analysis = {
        colorPalette: Array.isArray(parsed.colorPalette) ? parsed.colorPalette.slice(0, 5) : [],
        silhouette: typeof parsed.silhouette === 'string' ? parsed.silhouette : '',
        patternTrends: Array.isArray(parsed.patternTrends) ? parsed.patternTrends.slice(0, 4) : [],
      };
    } catch (parseErr) {
      console.error('analyze-inspiration: JSON parse failed. Raw text:', cleanedText.substring(0, 500));
      console.error('analyze-inspiration: parse error:', parseErr);
      analysis = {
        colorPalette: [],
        silhouette: '',
        patternTrends: [],
      };
    }

    return new Response(
      JSON.stringify({ analysis }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error('analyze-inspiration: unhandled error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
