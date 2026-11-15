/**
 * OpenAI-compatible /v1/images endpoints.
 *
 * Generation and editing run through Lumo's native image tools
 * (generate_image / edit_image) over a synthetic single-turn chat. Image
 * bytes come back inside the SSE stream (lumo.image_data), decrypted by
 * the LumoClient like any chat reply, and are returned as b64_json.
 *
 * Same policy as parseImageUrl: base64 data URLs in, no remote fetching.
 */

import { Router, type Request, type Response } from "express";
import { getEnableImageTools } from "../../app/config.js";
import { getMetrics } from "../../app/metrics.js";
import { logger } from "../../app/logger.js";
import type { EndpointDependencies } from "../types.js";
import type { Turn } from "../../lumo-client/types.js";
import { Role } from "../../lumo-client/types.js";
import {
  extractGeneratedImages,
  parseImageUrl,
  lumoImageMarker,
} from "../../lumo-client/images.js";
import { nowEpoch } from "./shared.js";

interface GenerationsRequestBody {
  prompt?: string;
  n?: number;
}

interface EditsRequestBody {
  prompt?: string;
  image?: string;
}

function invalidRequest(
  res: Response,
  status: number,
  message: string,
  param?: string,
): void {
  res.status(status).json({
    error: {
      message,
      type: "invalid_request_error",
      param: param ?? null,
      code: null,
    },
  });
}

/** One native image-tool completion; returns the raw base64 images. */
async function runImageTool(
  deps: EndpointDependencies,
  turn: Turn,
  toolSet: "generate" | "edit",
): Promise<{ images: string[] } | { error: string }> {
  if (!deps.lumoClient) return { error: "Lumo client unavailable" };
  try {
    // Persisted reply keeps only markers; base64 bytes arrive as
    // generated-image markdown in onChunk. Collect the stream for extraction.
    let streamed = "";
    const result = await deps.queue.add(() =>
      deps.lumoClient!.chatWithHistory(
        [turn],
        (chunk) => {
          streamed += chunk;
        },
        {
          useNativeTools: true,
          imageToolsOverride:
            toolSet === "generate" ? ["generate_image"] : ["edit_image"],
        },
      ),
    );
    const { images } = extractGeneratedImages(streamed);
    if (images.length === 0) {
      return { error: "Lumo returned no image data" };
    }
    getMetrics()?.lumoCompletionsTotal.inc({
      tier: "auto",
      reasoning: "false",
    });
    return { images: images.map((im) => im.data) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error: message }, "Image tool completion failed");
    return { error: message };
  }
}

export function createImagesRouter(deps: EndpointDependencies): Router {
  const router = Router();

  router.post("/v1/images/generations", async (req: Request, res: Response) => {
    if (!getEnableImageTools()) {
      invalidRequest(res, 403, "Image tools are disabled (enableImageTools)");
      return;
    }
    const body = (req.body ?? {}) as GenerationsRequestBody;
    if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
      invalidRequest(res, 400, "prompt is required", "prompt");
      return;
    }
    const n = body.n ?? 1;
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      invalidRequest(res, 400, "n must be an integer between 1 and 10", "n");
      return;
    }

    const data: Array<{
      url: string;
      b64_json: string;
      revised_prompt?: string;
    }> = [];
    for (let i = 0; i < n; i++) {
      const outcome = await runImageTool(
        deps,
        { role: Role.User, content: body.prompt },
        "generate",
      );
      if ("error" in outcome) {
        res.status(502).json({
          error: {
            message: outcome.error,
            type: "api_error",
            param: null,
            code: null,
          },
        });
        return;
      }
      for (const b64 of outcome.images) {
        data.push({ url: "", b64_json: b64, revised_prompt: body.prompt });
      }
    }
    res.json({ created: nowEpoch(), data });
  });

  router.post("/v1/images/edits", async (req: Request, res: Response) => {
    if (!getEnableImageTools()) {
      invalidRequest(res, 403, "Image tools are disabled (enableImageTools)");
      return;
    }
    const body = (req.body ?? {}) as EditsRequestBody;
    if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
      invalidRequest(res, 400, "prompt is required", "prompt");
      return;
    }
    const parsed = parseImageUrl(body.image);
    if (!parsed.ok) {
      invalidRequest(res, 400, `image: ${parsed.reason}`, "image");
      return;
    }
    // Same shape the message converter builds: marker names the image for
    // edit_image, bytes travel in turn.images.
    const turn: Turn = {
      role: Role.User,
      content: lumoImageMarker(parsed.image.image_id, "user"),
      images: [parsed.image],
    };
    const outcome = await runImageTool(deps, turn, "edit");
    if ("error" in outcome) {
      res.status(502).json({
        error: {
          message: outcome.error,
          type: "api_error",
          param: null,
          code: null,
        },
      });
      return;
    }
    res.json({
      created: nowEpoch(),
      data: outcome.images.map((b64) => ({ url: "", b64_json: b64 })),
    });
  });

  return router;
}
