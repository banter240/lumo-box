/** Mirrors `DesktopQuickAskApi` in clients' `packages/lumo-api-client/core/desktop-quick-ask.ts`. */
export interface LumoQuickAskApi {
  /** The pending quick-ask question, once, if `nonce` matches and has not expired; otherwise null. */
  take(nonce: string): Promise<string | null>;
}
