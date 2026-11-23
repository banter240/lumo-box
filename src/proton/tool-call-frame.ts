/**
 * Client tool-call frames arrive as `token_data` with target `tool_call`.
 * With U2L enabled the scheduler encrypts the arguments, so they ride the
 * frame as a ciphertext STRING rather than a parsed object.
 *
 * Mirrors the upstream decrypt transform (WebClients lumo-api-client
 * core/transforms/decrypt.ts): decrypt in place and re-parse so downstream
 * consumers see real arguments. Frames whose arguments are not an encrypted
 * string pass through untouched; a failed decryption also passes through.
 */
export async function decryptToolCallFrame(
  frame: string,
  decrypt: (text: string) => Promise<string | null>,
): Promise<string> {
  let parsed: { arguments?: unknown };
  try {
    parsed = JSON.parse(frame);
  } catch {
    return frame;
  }
  if (typeof parsed.arguments !== "string" || parsed.arguments.length === 0) {
    return frame;
  }
  const decrypted = await decrypt(parsed.arguments);
  if (decrypted === null) {
    return frame;
  }
  let args: unknown = decrypted;
  try {
    args = JSON.parse(decrypted);
  } catch {
    // Decrypted but not JSON — pass the cleartext string on.
  }
  return JSON.stringify({ ...parsed, arguments: args });
}
