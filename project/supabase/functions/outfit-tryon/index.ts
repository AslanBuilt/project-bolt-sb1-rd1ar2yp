import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

interface StepInput {
  category: string; // 'upper' | 'lower' | 'shoes'
  photoUrl: string;
  description?: string;
}

interface TryOnRequest {
  userId: string;
  comboKey: string;
  basePhotoUrl: string;
  steps: StepInput[];
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchAsInlineImage(url: string, label: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${label} (HTTP ${res.status})`);
  }
  const buffer = new Uint8Array(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "image/jpeg";

  // Chunked to avoid "Maximum call stack size exceeded" from spreading a large
  // typed array directly into String.fromCharCode (garment/base photos can be
  // several MB).
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < buffer.length; i += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(i, i + chunkSize));
  }

  return { data: btoa(binary), mimeType };
}

async function generateTryOnImage(
  basePhotoUrl: string,
  steps: StepInput[],
  apiKey: string,
  logPrefix: string
): Promise<Blob> {
  const baseImage = await fetchAsInlineImage(basePhotoUrl, "base photo");
  console.log(`${logPrefix} base photo fetched, mimeType=${baseImage.mimeType}`);

  const garmentImages: { data: string; mimeType: string; category: string; description: string }[] = [];
  for (const step of steps) {
    const image = await fetchAsInlineImage(step.photoUrl, `${step.category} garment photo`);
    const description = step.description?.trim() || step.category;
    garmentImages.push({ ...image, category: step.category, description });
    console.log(`${logPrefix} fetched ${step.category} garment: "${description}" mimeType=${image.mimeType}`);
  }

  const garmentList = garmentImages
    .map((g, i) => `image ${i + 2}: ${g.description} (${g.category} garment)`)
    .join(", ");

  const prompt =
    `You are given a photo of a person (image 1) and ${garmentImages.length} garment reference photo(s): ${garmentList}. ` +
    `Generate a new photorealistic image of the SAME person from image 1, in the same pose, framing, and background, ` +
    `but now wearing all of the garments shown in the other reference images together as a single coordinated outfit. ` +
    `Preserve the person's face, identity, body shape, and the background exactly as in image 1. ` +
    `Match each garment's color, pattern, and style as closely as possible to its reference photo. ` +
    `If a garment category (e.g. shoes) isn't included in the reference images, leave that part of the person's outfit unchanged from image 1.`;

  const parts: Record<string, unknown>[] = [
    { text: prompt },
    { inlineData: { mimeType: baseImage.mimeType, data: baseImage.data } },
    ...garmentImages.map((g) => ({ inlineData: { mimeType: g.mimeType, data: g.data } })),
  ];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error(`${logPrefix} Gemini image API error (HTTP ${response.status}):`, errText.slice(0, 1000));
    throw new Error(`GEMINI_HTTP_${response.status}: ${errText.slice(0, 300)}`);
  }

  const result = await response.json();
  const candidate = result?.candidates?.[0];
  console.log(`${logPrefix} Gemini response finishReason=${candidate?.finishReason}`);

  const resultParts: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] =
    candidate?.content?.parts || [];
  const imagePart = resultParts.find((p) => p.inlineData?.data);

  if (!imagePart?.inlineData?.data) {
    const textPart = resultParts.find((p) => p.text)?.text;
    console.error(`${logPrefix} no image in Gemini response. finishReason=${candidate?.finishReason} text="${textPart?.slice(0, 300)}"`);
    throw new Error("GEMINI_NO_IMAGE");
  }

  const bytes = Uint8Array.from(atob(imagePart.inlineData.data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: imagePart.inlineData.mimeType || "image/png" });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { userId, comboKey, basePhotoUrl, steps } = (await req.json()) as TryOnRequest;

    if (!userId || !comboKey || !basePhotoUrl || !Array.isArray(steps) || steps.length === 0) {
      return json({ success: false, error: "Missing required fields" }, 400);
    }

    // Service-role client so the final result is written durably here,
    // server-side, regardless of whether the browser that triggered this
    // is still connected by the time generation finishes.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    async function markResult(patch: { status: "done" | "failed"; image_url?: string }) {
      const { error } = await supabaseAdmin
        .from("tryon_results")
        .upsert(
          {
            user_id: userId,
            combo_key: comboKey,
            status: patch.status,
            image_url: patch.image_url ?? null,
            failed_step: null,
            skipped: [],
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,combo_key" }
        );
      if (error) {
        console.error(`outfit-tryon[${comboKey}] failed to write tryon_results:`, error);
      }
    }

    // Separate paid key, used only by this function - ai-tag-item,
    // analyze-inspiration, and outfit-recommend keep using GEMINI_API_KEY
    // (free tier) untouched.
    const apiKey = Deno.env.get("GEMINI_IMAGE_API_KEY");
    if (!apiKey) {
      await markResult({ status: "failed" });
      return json({ success: false, error: "GEMINI_IMAGE_API_KEY not configured" }, 500);
    }

    const logPrefix = `outfit-tryon[${comboKey}]`;
    console.log(`${logPrefix} basePhotoUrl=${basePhotoUrl}`);
    console.log(`${logPrefix} steps received:`, JSON.stringify(steps));

    let resultBlob: Blob;
    try {
      resultBlob = await generateTryOnImage(basePhotoUrl, steps, apiKey, logPrefix);
    } catch (err) {
      const message = String((err as Error)?.message || err);
      console.error(`${logPrefix} generation failed:`, message);
      await markResult({ status: "failed" });

      // The $10 prepaid balance stops serving requests immediately when it
      // hits $0 - Gemini surfaces that as a 429 (RESOURCE_EXHAUSTED) or 403
      // (billing/permission denied), same shape as a rate-limit error. Give a
      // clearer message for that case instead of a generic failure. This exact
      // detection hasn't been exercised against a real drained balance (that
      // would mean deliberately spending the $10 down to $0 to test it) - if
      // Google's actual error shape differs, this falls through to the
      // generic message below, which is still accurate and non-crashing.
      const lower = message.toLowerCase();
      const isBillingIssue =
        message.includes("GEMINI_HTTP_429") ||
        message.includes("GEMINI_HTTP_403") ||
        lower.includes("quota") ||
        lower.includes("billing") ||
        lower.includes("resource_exhausted");

      return json(
        {
          success: false,
          error: isBillingIssue
            ? "Try-on is temporarily unavailable (image generation quota/billing limit reached). Please try again later."
            : "Try-on generation failed.",
        },
        200
      );
    }

    const path = `${userId}/generated/${comboKey}.png`;
    const arrayBuffer = await resultBlob.arrayBuffer();
    const { error: uploadError } = await supabaseAdmin.storage
      .from("clothing-photos")
      .upload(path, arrayBuffer, { contentType: resultBlob.type || "image/png", upsert: true });

    if (uploadError) {
      console.error(`${logPrefix} storage upload failed:`, uploadError);
      await markResult({ status: "failed" });
      return json({ success: false, error: "Failed to store generated image" }, 200);
    }

    console.log(`${logPrefix} success: path=${path}`);
    await markResult({ status: "done", image_url: path });

    return json({ success: true, path }, 200);
  } catch (err) {
    console.error("outfit-tryon: unhandled error:", err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
