/**
 * Integration tests for the /v1/images endpoints.
 *
 * Drives the native generate_image pipeline through the mock scenario
 * `imageGeneration` (tool call → result → lumo.image_data → text).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestServer, type TestServer } from "../helpers/test-server.js";

vi.mock("../../src/app/config.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getEnableImageTools: () => true,
}));

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_B64 = PNG_BYTES.toString("base64");
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;

function post(
  ts: TestServer,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${ts.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/v1/images", () => {
  describe("generations", () => {
    let ts: TestServer;

    beforeAll(async () => {
      ts = await createTestServer("imageGeneration");
    });
    afterAll(async () => {
      await ts.close();
    });

    it("returns b64_json from the mocked native image tool", async () => {
      const res = await post(ts, "/v1/images/generations", { prompt: "a cat" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.created).toBeGreaterThan(0);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].b64_json).toBe(PNG_B64);
    });

    it("rejects a missing prompt with 400", async () => {
      const res = await post(ts, "/v1/images/generations", {});
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.param).toBe("prompt");
    });

    it("rejects n out of range with 400", async () => {
      const res = await post(ts, "/v1/images/generations", {
        prompt: "x",
        n: 11,
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.param).toBe("n");
    });
  });

  describe("edits", () => {
    let ts: TestServer;

    beforeAll(async () => {
      ts = await createTestServer("imageGeneration");
    });
    afterAll(async () => {
      await ts.close();
    });

    it("returns b64_json for a data-URL image", async () => {
      const res = await post(ts, "/v1/images/edits", {
        prompt: "make the cat black",
        image: PNG_DATA_URL,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data[0].b64_json).toBe(PNG_B64);
    });

    it("rejects remote image URLs (no proxy fetching)", async () => {
      const res = await post(ts, "/v1/images/edits", {
        prompt: "edit",
        image: "https://example.com/cat.png",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.param).toBe("image");
    });

    it("rejects an image whose bytes contradict the declared type", async () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");
      const res = await post(ts, "/v1/images/edits", {
        prompt: "edit",
        image: `data:image/png;base64,${jpeg}`,
      });
      expect(res.status).toBe(400);
    });
  });
});
