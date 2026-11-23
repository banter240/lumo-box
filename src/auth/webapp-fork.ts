/**
 * Server-authorized webapp fork (single sign-in).
 *
 * After /auth the tamer session can PRODUCE a fork for the proxied web app
 * instead of routing the user through account.proton.me a second time:
 * pushForkSession with Independent:1 mints a fresh, separate session for
 * the web app (mirrors upstream fork/produce.ts), so server and app never
 * share rotating refresh tokens.
 *
 * Upstream mirror: WebClients shared/lib/authentication/fork/{blob,produce}.ts,
 * sessionBlobCryptoHelper.ts (V3 blob: AES-GCM, 12-byte IV, AD "fork").
 */

import { randomFillSync } from "crypto";
import { importKey, encryptData } from "@proton/crypto/lib/subtle/aesGcm";
import type { ProtonApi } from "../lumo-client/types.js";

/** Fork wire constants — upstream fork/constants.ts + produce.ts.
 * ChildClientID must stay web-lumo (the web app's own fork client); a
 * mismatch surfaces as "Invalid selector" at redemption. */
export const FORK_CHILD_CLIENT_ID = "web-lumo";
/** Independent:1 mints a separate session for the app — server and app
 * never share rotating refresh tokens. */
export const FORK_INDEPENDENT = 1;
/** Fork payload V3 AD and shape, upstream fork/blob.ts. */
const FORK_AD = new TextEncoder().encode("fork");
type ForkBlob = { type: "default"; keyPassword: string };

/** Fresh 32-byte fork key, base64url-encoded without padding (upstream produce.ts). */
function forkKey(): { raw: Uint8Array<ArrayBuffer>; b64u: string } {
  const raw = new Uint8Array(new ArrayBuffer(32));
  randomFillSync(raw);
  return {
    raw,
    b64u: Buffer.from(raw).toString("base64url"),
  };
}

/** AES-GCM-encrypt the fork blob with the fresh key, AD "fork" (V3 blob). */
async function encryptForkBlob(
  rawKey: Uint8Array<ArrayBuffer>,
  keyPassword: string,
): Promise<string> {
  const key = await importKey(rawKey);
  const blob: ForkBlob = { type: "default", keyPassword };
  const ct = await encryptData(
    key,
    new TextEncoder().encode(JSON.stringify(blob)),
    FORK_AD,
  );
  return Buffer.from(ct).toString("base64");
}

/** Mint a fork for the web app from the tamer session. Returns the exact
 * payload the app's /login#selector&sk handoff consumes. */
export async function produceWebappFork(
  api: ProtonApi,
  keyPassword: string,
): Promise<{ selector: string; keyB64u: string }> {
  if (!keyPassword) {
    throw new Error("Session has no key password; re-login required");
  }
  const { raw, b64u } = forkKey();
  const payload = await encryptForkBlob(raw, keyPassword);
  const json = (await api({
    url: "/auth/v4/sessions/forks",
    method: "post",
    data: {
      Payload: payload,
      ChildClientID: FORK_CHILD_CLIENT_ID,
      Independent: FORK_INDEPENDENT,
    },
  })) as { Selector?: string };
  if (!json?.Selector || typeof json.Selector !== "string") {
    throw new Error("Fork push returned no selector");
  }
  return { selector: json.Selector, keyB64u: b64u };
}
