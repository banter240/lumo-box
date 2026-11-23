# Proton wire mirrors

One-to-one mirrors of Proton wire logic, each carrying its upstream
reference in the file header. When Proton changes one of these areas,
the patch lands here and nowhere else.

| File                       | Mirrors (WebClients)                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| chat-completions-body.ts   | packages/lumo-api-client core/chat-completions.ts (toChatCompletionsBody / resolveChatModel / serializeMessages) |
| chat-completions-stream.ts | packages/lumo-api-client core/streaming.ts (processOpenAiChunk / processDelta / processToolCallDelta)            |
| tool-call-frame.ts         | packages/lumo-api-client core/transforms/decrypt.ts (client tool-call frames under U2L)                          |
| client-tools-normalize.ts  | lumo-api-client normalizeTools (flat ChatCompletionsFlatFunctionTool → nested)                          |
| image-encryption.ts        | packages/lumo-api-client core/encryption.ts encryptImage + image mime inference                                  |
| webapp-fork.ts             | packages/shared/lib/authentication/fork/{constants,blob,produce}.ts (sessionBlobCryptoHelper V3)                 |
| sync-encryption-codec.ts   | Lumo WebClient persistence crypto (AES-GCM AEAD, sorted-key stringify AD)                               |

Byte-exact upstream code (unmodified) lives separately under
packages/lumo-webview and is synced only via scripts/upstream/sync-webview.sh.
The Node shims in src/shims exist so upstream code can run unmodified; they
are tamer-owned, not mirrors.
