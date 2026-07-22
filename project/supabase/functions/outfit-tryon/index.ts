import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Client, handle_file } from "npm:@gradio/client@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// CatVTON and IDM-VTON are garment try-on models: they only understand
// upper-body / lower-body clothing, not shoes or accessories. Any step
// outside this set is skipped rather than sent to the model.
type SupportedCategory = "upper" | "lower";

interface StepInput {
  category: string;
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

function isSupportedCategory(category: string): category is SupportedCategory {
  return category === "upper" || category === "lower";
}

async function fetchAsBlob(url: string, label: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${label} (HTTP ${res.status})`);
  }
  return await res.blob();
}

// Gradio image-output results can come back in a few shapes depending on
// client/space version: a Blob directly, a FileData object with .url or
// .path, or a bare URL string. Handle all of them defensively.
async function extractResultBlob(result: { data?: unknown[] }, spaceHost: string, logPrefix: string): Promise<Blob> {
  console.log(`${logPrefix} raw predict() result:`, JSON.stringify(result).slice(0, 1000));

  const data = result?.data?.[0] as
    | Blob
    | string
    | { url?: string; path?: string }
    | undefined;

  if (!data) throw new Error("No result data returned from Space");
  if (data instanceof Blob) return data;
  if (typeof data === "string") return await fetchAsBlob(data, "result (string url)");
  if (data.url) return await fetchAsBlob(data.url, "result (.url)");
  if (data.path) {
    const path = data.path.startsWith("/") ? data.path : `/${data.path}`;
    return await fetchAsBlob(`https://${spaceHost}/file=${path}`, "result (.path)");
  }
  throw new Error(`Could not extract image from result: ${JSON.stringify(data).slice(0, 200)}`);
}

async function callCatVTON(
  personBlob: Blob,
  garmentBlob: Blob,
  clothType: SupportedCategory,
  hfToken: string,
  logPrefix: string
): Promise<Blob> {
  console.log(`${logPrefix} calling CatVTON: personBlob=${personBlob.size}B garmentBlob=${garmentBlob.size}B clothType=${clothType}`);
  const client = await Client.connect("zhengchong/CatVTON", { hf_token: hfToken as `hf_${string}` });
  const result = await client.predict("/submit_function", [
    { background: handle_file(personBlob), layers: [], composite: null },
    handle_file(garmentBlob),
    clothType,
    30, // inference steps (default is 50; lowered for speed on a free ZeroGPU quota)
    2.5, // CFG strength (Space default)
    -1, // seed (-1 = random)
    "result only",
  ]);
  return await extractResultBlob(result, "zhengchong-catvton.hf.space", logPrefix);
}

async function callIdmVton(
  personBlob: Blob,
  garmentBlob: Blob,
  category: SupportedCategory,
  description: string,
  hfToken: string,
  logPrefix: string
): Promise<Blob> {
  console.log(`${logPrefix} calling IDM-VTON: personBlob=${personBlob.size}B garmentBlob=${garmentBlob.size}B category=${category} description="${description}"`);
  const client = await Client.connect("yisol/IDM-VTON", { hf_token: hfToken as `hf_${string}` });
  const result = await client.predict("/tryon", [
    { background: handle_file(personBlob), layers: [], composite: null },
    handle_file(garmentBlob),
    description,
    true, // use auto-generated mask
    false, // use auto-crop & resizing
    30, // denoising steps
    42, // seed
  ]);
  return await extractResultBlob(result, "yisol-idm-vton.hf.space", logPrefix);
}

async function tryStep(
  model: "catvton" | "idm-vton",
  personBlob: Blob,
  garmentBlob: Blob,
  category: SupportedCategory,
  description: string,
  hfToken: string,
  logPrefix: string,
  maxAttempts: number
): Promise<Blob | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return model === "catvton"
        ? await callCatVTON(personBlob, garmentBlob, category, hfToken, logPrefix)
        : await callIdmVton(personBlob, garmentBlob, category, description, hfToken, logPrefix);
    } catch (err) {
      console.error(`${logPrefix} ${model} attempt ${attempt}/${maxAttempts} failed for category=${category}:`, err);
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
  return null;
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

    // Service-role client so the final result is written durably here,
    // server-side, regardless of whether the browser that triggered this
    // is still connected by the time generation finishes.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    async function markResult(patch: {
      status: "done" | "failed";
      image_url?: string;
      failed_step?: string | null;
      skipped?: string[];
    }) {
      const { error } = await supabaseAdmin
        .from("tryon_results")
        .upsert(
          {
            user_id: userId,
            combo_key: comboKey,
            status: patch.status,
            image_url: patch.image_url ?? null,
            failed_step: patch.failed_step ?? null,
            skipped: patch.skipped ?? [],
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,combo_key" }
        );
      if (error) {
        console.error(`outfit-tryon[${comboKey}] failed to write tryon_results:`, error);
      }
    }

    const hfToken = Deno.env.get("HF_TOKEN");
    if (!hfToken) {
      await markResult({ status: "failed", failed_step: null });
      return json({ success: false, error: "HF_TOKEN not configured" }, 500);
    }

    const supportedSteps = steps.filter((s) => isSupportedCategory(s.category)) as (StepInput & {
      category: SupportedCategory;
    })[];
    const skipped = steps.filter((s) => !isSupportedCategory(s.category)).map((s) => s.category);

    if (skipped.length > 0) {
      console.log(`outfit-tryon[${comboKey}] skipping unsupported categories:`, skipped);
    }

    if (supportedSteps.length === 0) {
      await markResult({ status: "failed", failed_step: null, skipped });
      return json(
        { success: false, error: "No supported garment categories (upper/lower) in this outfit", skipped },
        200
      );
    }

    const logPrefixBase = `outfit-tryon[${comboKey}]`;
    console.log(`${logPrefixBase} basePhotoUrl=${basePhotoUrl}`);
    console.log(`${logPrefixBase} steps received:`, JSON.stringify(steps));

    let currentImageBlob: Blob;
    try {
      currentImageBlob = await fetchAsBlob(basePhotoUrl, "base photo");
      console.log(`${logPrefixBase} base photo fetched: ${currentImageBlob.size} bytes`);
    } catch (err) {
      console.error(`${logPrefixBase} failed to fetch base photo:`, err);
      await markResult({ status: "failed", failed_step: null, skipped });
      return json({ success: false, error: "Could not load base photo", skipped }, 200);
    }

    const stepsCompleted: string[] = [];
    let modelUsed: "catvton" | "idm-vton" | null = null;
    let failedStep: string | null = null;

    for (const step of supportedSteps) {
      const logPrefix = logPrefixBase;
      console.log(`${logPrefix} step category=${step.category} photoUrl=${step.photoUrl}`);
      let garmentBlob: Blob;
      try {
        garmentBlob = await fetchAsBlob(step.photoUrl, `${step.category} garment photo`);
        console.log(`${logPrefix} garment photo fetched for ${step.category}: ${garmentBlob.size} bytes`);
      } catch (err) {
        console.error(`${logPrefix} failed to fetch garment photo for ${step.category}:`, err);
        failedStep = step.category;
        break;
      }

      const description = step.description?.trim() || (step.category === "upper" ? "top garment" : "bottom garment");

      // CatVTON gets a single attempt: live diagnostics show it currently fails
      // with the same server-side "IndexError" on every single call regardless
      // of input, so a second attempt is pure wasted latency right now. IDM-VTON
      // (the model actually succeeding) gets the full retry budget instead.
      let stepResult = await tryStep("catvton", currentImageBlob, garmentBlob, step.category, description, hfToken, logPrefix, 1);
      let stepModel: "catvton" | "idm-vton" = "catvton";

      if (!stepResult) {
        stepResult = await tryStep("idm-vton", currentImageBlob, garmentBlob, step.category, description, hfToken, logPrefix, 2);
        stepModel = "idm-vton";
      }

      if (!stepResult) {
        console.error(`${logPrefix} both CatVTON and IDM-VTON failed for category=${step.category}`);
        failedStep = step.category;
        break;
      }

      console.log(`${logPrefix} step ${step.category} succeeded via ${stepModel}, result size=${stepResult.size} bytes`);
      currentImageBlob = stepResult;
      modelUsed = modelUsed ?? stepModel;
      stepsCompleted.push(step.category);
    }

    if (stepsCompleted.length === 0) {
      await markResult({ status: "failed", failed_step: failedStep, skipped });
      return json({ success: false, error: "Try-on generation failed", failedStep, skipped }, 200);
    }

    const path = `${userId}/generated/${comboKey}.jpg`;
    const arrayBuffer = await currentImageBlob.arrayBuffer();
    const { error: uploadError } = await supabaseAdmin.storage
      .from("clothing-photos")
      .upload(path, arrayBuffer, { contentType: "image/jpeg", upsert: true });

    if (uploadError) {
      console.error(`${logPrefixBase} storage upload failed:`, uploadError);
      await markResult({ status: "failed", failed_step: failedStep, skipped });
      return json({ success: false, error: "Failed to store generated image", stepsCompleted, skipped }, 200);
    }

    console.log(`${logPrefixBase} success: path=${path} stepsCompleted=${stepsCompleted.join(",")} modelUsed=${modelUsed}`);

    // A partial result (e.g. upper succeeded, lower failed) is still marked "done" —
    // a partially-dressed visualization is better than none, matching the fallback philosophy.
    await markResult({ status: "done", image_url: path, failed_step: failedStep, skipped });

    return json(
      {
        success: true,
        path,
        stepsCompleted,
        skipped,
        partial: failedStep !== null,
        failedStep,
        modelUsed,
      },
      200
    );
  } catch (err) {
    console.error("outfit-tryon: unhandled error:", err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
