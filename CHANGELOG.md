## [0.10.1](https://github.com/banter240/lumo-tamer/compare/v0.10.0...v0.10.1) (2026-11-15)

### Bug Fixes

* fix(config-editor): describe every field and gate children behind their toggles

  Fields the /config page could not describe fell back to "See
  config.defaults.yaml and docs/config.md.": the three new compaction
  keys and recovery's holdWindowChars had no copy entry at all. Every
  one of the 126 fields now carries a real hint in the pacing/metrics
  house style, and compaction got its own sidebar category instead of
  spilling into Server > General.

  Dependency chains were equally inconsistent: metrics and updates hid
  their children behind their master toggle, but pacing, autoRefresh,
  wakeword, mock, and the localActions tree showed every knob
  unconditionally. All conditional fields are registered now, and the
  visibility rule cascades — turning a group off collapses its
  sub-groups too, instead of leaving orphaned grandchildren behind.

## [0.10.0](https://github.com/banter240/lumo-tamer/compare/v0.9.0...v0.10.0) (2026-11-15)

### Features

* feat(compaction): stub old tool results before sending

  Agent clients re-send the whole conversation on every request, and
  old tool results dominate the prompt. compactTurns stubs those
  outside the recent window to a one-line "[output of N chars omitted]";
  the recent window stays byte-identical and nothing persisted moves.
  Off by default; server.compaction in config.yaml, shared like pacing.
* feat(images): OpenAI-compatible /v1/images endpoints

  POST /v1/images/generations and /v1/images/edits, for OpenAI-style
  clients. Both run the native generate_image / edit_image tools over a
  synthetic single-turn chat; the b64_json is taken from the streamed
  generated-image markdown, because the persisted reply keeps only
  <lumo-image> markers. Gated on enableImageTools, base64 data URLs
  only, completions counted in lumoCompletionsTotal.
* feat(metrics): expose remaining Lumo allowance as gauges

  The final usage chunk carries the remaining allowance per bucket and
  the billed category; both were logged and dropped. They are now
  gauges on /metrics: lumo_remaining_limits{bucket} and
  lumo_applied_limit_category (1=lite, 2=max, 3=images), set as each
  stream completes.

### Bug Fixes

* fix(client): retry transient stream errors and stop mid-task stalls

  Proton can answer 200 and still fail inside the stream with "timed
  out waiting for capacity" — the whole agent task died with it.
  Completions now retry those through the pacing backoff, re-slotted
  through the scheduler like any other request, and never once anything
  was streamed to the client. Around it, three stall patterns: image
  tool arguments written as text bounce once with the tools re-offered,
  French announcements with the pre-colon space ("Je vérifie :") are
  caught, and agent-made user turns (compaction checkpoints, shell
  notices, instruction banners) no longer pass as real requests. The
  three bounce paths share one helper.
* fix(images): offer attachment tools only on the direct reply to the image

  Tool-loop steps re-send the same history, so after a screenshot
  arrived describe_image stayed advertised and Lumo kept re-describing
  it instead of continuing the task. Attachment tools are now offered
  only on the direct reply to an image turn.
* fix(images): validate magic bytes against the declared MIME type

  parseImageUrl took the declared MIME type at face value; a payload
  claiming to be a PNG travelled as one. The sniffed magic bytes must
  now agree with the declaration, and payloads that are no supported
  image format are rejected outright.
* fix(tools): run tool calls written under markdown headers or bare blocks

  In those turns Lumo did write its tool call, but as prose: under a
  markdown title like **user:shell**, or as a bare arguments object
  with no tool name at all. Neither shape executed, so agent loops
  stalled until the user said continue. The detector now picks up both,
  infers the missing name from the declared tool signatures, and
  unpacks JSON arrays of parallel calls.

### Documentation

* docs(readme): centered header with live Discord and Fluxer badges

## [0.9.0](https://github.com/banter240/lumo-tamer/compare/v0.8.0...v0.9.0) (2026-11-14)

### Features

* feat(config): configurable coach-announce hold window
* feat(pacing): human-like request pacing with jitter, bursts, and backoff

  Space out every outgoing Proton completion (chat, title, bounces,
  tool-result continuations) so agent tool loops don't dispatch
  back-to-back:

  - skewed jitter (mostly short, rare long waits), minimum interval
    with its own jitter, rare long "got distracted" pauses
  - simulated reading/typing pauses sized by the previous reply and the
    outgoing message, with per-request speed variance and occasional
    skips so timings don't correlate perfectly with message sizes
  - burst-aware spacing: relaxed interval inside an active exchange,
    resume delay after idle
  - processing pause for machine-fed turns (bounces, tool results):
    nobody types those, so they pay a short uniform pause instead of a
    length-scaled typing pause
  - night-time multiplier during quiet hours
  - exponential backoff with jitter on retryable Proton errors (429/5xx)
  - pacing metrics: wait histogram, paced/immediate counter, retry counter

  All knobs live under a shared `pacing:` config section (overridable
  per server/cli), surfaced in the /config editor.

### Bug Fixes

* fix(web-ui): hide the UI-lock button for local requests

  The lock button clears the unlock cookie, but requests from this
  machine are trusted without a key (loopback), so on localhost it was a
  no-op carousel: lock -> /ui-login -> key -> back to a UI that was
  never locked. htmlPage now takes localUi and serves the button (and
  its /ui-logout binding) only to non-local requests.

## [0.8.0](https://github.com/banter240/lumo-tamer/compare/v0.7.1...v0.8.0) (2026-11-11)

### Features

* feat(web-ui): lock button to clear the unlock cookie

  POST /ui-logout (idempotent, CSRF-guarded) plus a header button clear
  the UI session cookie, so the next page load asks for the API key
  again instead of staying unlocked for 30 days.

  createAttemptGate gains success(ip), called after a correct UI unlock
  and after a successful Proton login: only failures accumulate now, so
  legitimate device unlocks no longer lock each other out.

## [0.7.1](https://github.com/banter240/lumo-tamer/compare/v0.7.0...v0.7.1) (2026-11-10)

### Bug Fixes

* fix(security): keep the web UI and conversation content on this machine

  A security and privacy pass so the proxy does not weaken what Proton
  promises for Lumo (no logs, zero-access history, U2L encryption).

  - server.host defaults to 127.0.0.1 (LUMO_TAMER_HOST override; the
    Dockerfile sets 0.0.0.0 so published ports keep working). Startup
    logs the listen address and warns on exposure with a weak setup.
  - UI routes (/config, /logs, /auth, /health, /metrics) no longer skip
    the API key: loopback requests with a localhost Host header pass;
    other devices authenticate once via /ui-login (HttpOnly,
    SameSite=Strict cookie holding an HMAC of the key, never the key).
    Bearer still works everywhere, now compared in constant time.
  - CSRF and DNS-rebinding protection: state-changing UI requests with
    a cross-site Sec-Fetch-Site or foreign/null Origin are refused;
    unlock redirects accept same-origin paths only.
  - Host-only settings (updates.repository, updates.dockerSocket, auth
    binary/browser paths, vault/log/dump/db paths, log.messageContent,
    server.host) are editable only in config.yaml. PUT /v1/config
    refuses them (403), import skips them. Breaks the API-key-to-
    host-root chain (repository + /v1/update with docker.sock mounted).
  - docker-compose.yml no longer mounts /var/run/docker.sock by default.
  - contentForLog() hides content-bearing log fields (tool arguments,
    results, CLI queries, detector snippets) unless messageContent is on.
  - Google Fonts import removed (local Inter or system UI font).
* fix(tools): only offer image and web tools when the user asks for them

  Image tools: offered only when the latest real user message asks for a
  picture, attaches one, or follows up on an assistant image; never on
  title/compaction helper requests, bounces, or tool-loop steps after an
  image was generated. Only the tool the message calls for is offered
  (generate / describe / edit), so an attached screenshot no longer gets
  edited unprompted.

  Web tools: unchanged in plain chat; on agent requests (client tools)
  offered only when the user asks for something online, so tool-loop
  steps no longer fire off-topic searches.

## [0.7.0](https://github.com/banter240/lumo-tamer/compare/v0.6.0...v0.7.0) (2026-11-09)

### Features

* feat(api): proxy core, instructions modules, privacy masking

  Shared request-prep drives both OpenAI routes: userish validation, tool
  choice preparation, injected instructions with per-module toggles,
  reduced cold-start refusals. response_format/json mode support, reply
  recovery fixes, deterministic conversation ids, privacy dump masking
  for the API dump, conversation store hardening, richer mock scenarios,
  listen helper for integration tests.
* feat(app): settings editor, portable config, env overrides

  Full /config editor with sub-categories, sort drop-in modules below base
  prompts, compiled and tested inline scripts. Portable JSON export and
  import. Port and vault-key env overrides with config.yaml hot reload,
  no YAML line folding, LUMO_HOME support, safer proxy defaults and the
  app const/enum SSOT feeding schemas and editor copy.
* feat(auth): password login page, desktop sign-in, sidecar auth

  Lumo-scoped /auth page with SRP password flow, Proton desktop sign-in,
  sidecar login, collapsed login paths. Logout drops the vault even when
  Proton revoke fails; auth-required errors carry a reachable /auth URL.
  Rate-limited config saves, token refresh hardening, vault atomic write
  follows symlinks, Go login CLI fixes including Windows binaryPath.
* feat(cli): interactive prompt and instructions builder

  Interactive CLI prompt; the instructions builder moves from the
  misleading message-converter.ts name to instructions.ts, imported by
  cli/client.ts.
* feat(images): vision input, generation, and editing

  Send image input (vision) to Lumo U2L-encrypted with strict base64
  validation and image bytes excluded from the token estimate. Native
  image generation and editing (generate/edit/describe_image), decrypted
  in the proxy and streamed as markdown data URLs; image tools are only
  offered on turns that involve images.

  Co-authored-by: aloizwinters-glitch <324018590+aloizwinters-glitch@users.noreply.github.com>
* feat(logging): live /logs page backend with redaction

  Redacted ring buffer broadcasting structured logs to the web UI;
  log-redact strips login credentials and secrets, tested against
  realistic field sets. Verbosity stays governed by log.level, message
  content logging remains opt-in.
* feat(lumo-client): completion core refinements

  Per-request trace anchors (tier, turns, images, encrypted, requestId)
  pair with the tool detector stream logs, bounce-once guard for dead tool
  call announcements, response-chunk accumulation in one place, single
  resolveChatModel tier mapping via LUMO_MODEL_TIERS.
* feat(models): Apertus 1.5, thinking variants, reasoning effort mapping

  Apertus 1.5 with alias canonicalization, auto-advertised -thinking
  variants via autoVariants, minimal/xhigh/default reasoning_effort
  values mapped onto Lumo's high/none. Prompt-token estimation
  rebaselined so factor 1.0 is the tuned value.
* feat(tools): robust streaming tool detection

  Fences open only at line start or before a JSON payload, lone and inline
  closers are never emitted, fenced calls survive fences inside payload
  strings. Lenient parser decodes JSON escapes, jammed tool JSON is split
  and repaired, unknown client tools are counted and escalated to warn so
  retry loops surface. flattenToolItem is the single OpenAI-to-Lumo tool
  mapping, choice instructions and announce/extract modules included.
* feat(updates): git and docker self-update with channel switching

  docker.sock self-update prunes old images after a successful recreate,
  git self-update covers bare checkouts, optional GitHub PAT for release
  checks, stable/dev channel switching with downgrade warnings. Stale
  dist is rebuilt on respawn, the listen port is released before restart,
  and /health surfaces the build commit plus a staleness flag on the
  single semver comparator.
* feat(web-ui): served web UI with toasts, auth chip, live log feed

  Click-to-copy toasts (errors linger), global auth status chip with
  sign-out detection, vertical sidebar on narrow screens, compact toolbar
  with searchable type=search settings, log feed with internal scrolling,
  theme toggle without DOM wipe, number input guards, build commit in the
  header, single __ltToast implementation for all bind scripts.

### Bug Fixes

* fix(app): register fallback store in mock mode

  In initializeMock(), when useFallbackStore is true the else-branch
  called getFallbackStore() but never registered it as the active
  conversation store via setConversationStore(). This left the
  activeStore singleton null, so APIServer.getDependencies() threw
  'ConversationStore not initialized - call initializeConversationStore()
  first' on startup, causing a crash loop in mock mode.

  Wrap the call in setConversationStore(), mirroring the primary-store
  branch above.

### Documentation

* docs: fork documentation overhaul

  README rewritten against current code, new docs for /config settings
  and the update system, authentication/opencode/local-actions guides
  updated through the full audit sweep.
