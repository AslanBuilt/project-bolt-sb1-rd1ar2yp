import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMINI_TIMEOUT_MS = 60_000;

// Scope deliberately locked to exactly top + bottom (2026-07-24) - shoes were
// tried, worked, but were reverted for overall reliability. Not a "shoes
// support" bug to fix later; see CLAUDE.md "Outfit try-on feature".
interface StepInput {
  category: "upper" | "lower";
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

async function callGeminiImageGeneration(
  parts: Record<string, unknown>[],
  apiKey: string,
  logPrefix: string
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    return await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        signal: controller.signal,
      }
    );
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new Error(`GEMINI_TIMEOUT: no response within ${GEMINI_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateTryOnImage(
  basePhotoUrl: string,
  upperStep: StepInput,
  lowerStep: StepInput,
  apiKey: string,
  logPrefix: string
): Promise<Blob> {
  const baseImage = await fetchAsInlineImage(basePhotoUrl, "base photo");
  console.log(`${logPrefix} base photo fetched, mimeType=${baseImage.mimeType}`);

  const upperImage = await fetchAsInlineImage(upperStep.photoUrl, "upper garment photo");
  const upperDescription = upperStep.description?.trim() || "top garment";
  console.log(`${logPrefix} fetched upper garment: "${upperDescription}" mimeType=${upperImage.mimeType}`);

  const lowerImage = await fetchAsInlineImage(lowerStep.photoUrl, "lower garment photo");
  const lowerDescription = lowerStep.description?.trim() || "bottom garment";
  console.log(`${logPrefix} fetched lower garment: "${lowerDescription}" mimeType=${lowerImage.mimeType}`);

  const prompt =
    `You are given a photo of a person (image 1), a top garment (image 2: ${upperDescription}), ` +
    `and a bottom garment (image 3: ${lowerDescription}). ` +
    `Generate a new photorealistic image of the SAME person from image 1, in the same pose and background, ` +
    `now wearing the top garment from image 2 and the bottom garment from image 3 together as a coordinated outfit. ` +
    `Preserve the person's face, identity, body shape, and the background exactly as in image 1. ` +
    `Match each garment's color, pattern, and style as closely as possible to its reference photo. ` +
    `Leave everything else - including the person's existing shoes/footwear and any accessories - exactly as shown in image 1, unchanged. ` +
    `Do not crop, zoom in, or reframe the shot: keep the exact same full-body framing as image 1, with the person's entire body visible from head to feet, including their shoes fully in frame.`;

  const parts: Record<string, unknown>[] = [
    { text: prompt },
    { inlineData: { mimeType: baseImage.mimeType, data: baseImage.data } },
    { inlineData: { mimeType: upperImage.mimeType, data: upperImage.data } },
    { inlineData: { mimeType: lowerImage.mimeType, data: lowerImage.data } },
  ];

  let response: Response | null = null;
  let lastErrorText = "";
  const maxAttempts = 2; // one retry, specifically for Gemini's transient 503 "high demand" - not a general retry policy
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    response = await callGeminiImageGeneration(parts, apiKey, logPrefix);
    if (response.ok) break;

    lastErrorText = await response.text();
    console.error(`${logPrefix} Gemini image API error (HTTP ${response.status}), attempt ${attempt}/${maxAttempts}:`, lastErrorText.slice(0, 1000));

    if (response.status === 503 && attempt < maxAttempts) {
      console.log(`${logPrefix} 503 (high demand) - retrying once after a short delay`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }
    break;
  }

  if (!response!.ok) {
    throw new Error(`GEMINI_HTTP_${response!.status}: ${lastErrorText.slice(0, 300)}`);
  }

  const result = await response!.json();
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

    if (!userId || !comboKey || !basePhotoUrl || !Array.isArray(steps)) {
      return json({ success: false, error: "Missing required fields" }, 400);
    }

    const upperStep = steps.find((s) => s.category === "upper");
    const lowerStep = steps.find((s) => s.category === "lower");
    if (steps.length !== 2 || !upperStep || !lowerStep) {
      return json(
        { success: false, error: "Expected exactly two garment steps: upper and lower" },
        400
      );
    }

    // Service-role client so the final result is written durably here,
    // server-side, regardless of whether the browser that triggered this
    // is still connected by the time generation finishes.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Retries once on failure - a generated image that never gets marked
    // "done" here is a real image, already paid for and already in storage,
    // but the combo-key cache will never learn that, silently forcing a
    // wasteful re-generation (or a stuck "generating" row) next time this
    // combo is requested. One retry meaningfully reduces that risk for a
    // one-off transient DB blip at effectively no extra cost.
    async function markResult(patch: { status: "done" | "failed"; image_url?: string }): Promise<boolean> {
      for (let attempt = 1; attempt <= 2; attempt++) {
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
        if (!error) return true;
        console.error(`outfit-tryon[${comboKey}] failed to write tryon_results (attempt ${attempt}/2):`, error);
      }
      return false;
    }

    // Image generation isn't available on Gemini's free tier at all, so this
    // one always uses the paid key - unlike the text functions (ai-tag-item,
    // analyze-inspiration, outfit-recommend), there's no "revert to free" case
    // for this constant. See CLAUDE.md "Gemini API key routing".
    const GEMINI_KEY_SECRET = "GEMINI_PAID_API_KEY";
    const apiKey = Deno.env.get(GEMINI_KEY_SECRET);
    console.log(`outfit-tryon[${comboKey}] using Gemini key from secret "${GEMINI_KEY_SECRET}"`);
    if (!apiKey) {
      await markResult({ status: "failed" });
      return json({ success: false, error: `${GEMINI_KEY_SECRET} not configured` }, 500);
    }

    const logPrefix = `outfit-tryon[${comboKey}]`;
    console.log(`${logPrefix} basePhotoUrl=${basePhotoUrl}`);
    console.log(`${logPrefix} steps received:`, JSON.stringify(steps));

    let resultBlob: Blob;
    try {
      resultBlob = await generateTryOnImage(basePhotoUrl, upperStep, lowerStep, apiKey, logPrefix);
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
      const isTimeout = message.includes("GEMINI_TIMEOUT");

      return json(
        {
          success: false,
          error: isBillingIssue
            ? "Try-on is temporarily unavailable (image generation quota/billing limit reached). Please try again later."
            : isTimeout
              ? "Try-on generation timed out. Please try again."
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
    const persisted = await markResult({ status: "done", image_url: path });
    if (!persisted) {
      // The image is real and already in storage - still tell the client it
      // succeeded (it did) - but this combo's cache row is now inconsistent
      // and needs to be loud in logs since nothing else will ever surface it.
      console.error(`${logPrefix} CRITICAL: image generated and stored at ${path}, but tryon_results could not be marked done after 2 attempts - this combo's cache is now stale`);
    }

    return json({ success: true, path }, 200);
  } catch (err) {
    console.error("outfit-tryon: unhandled error:", err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
