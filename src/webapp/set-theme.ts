/**
 * Set the Lumo web app's theme mode in its real home: the E2E-encrypted
 * server user settings (the field the app's own Appearance UI writes via
 * Redux -> serialize -> PUT /lumo/v1/settings). Doing the same from the
 * server gives the sidebar toggle the same authority: on the next load
 * the app takes the theme from the server copy, and its listeners write
 * the local mirrors (lumo-settings) themselves.
 *
 * Crypto mirrors the vendored serialization.ts (deserializeUserSettings /
 * serializeUserSettings) — upstream reference: WebClients
 * applications/lumo/src/app/redux/slices/lumoUserSettingsThunks.ts.
 */

import { logger } from "../app/logger.js";
import {
  deserializeUserSettings,
  serializeUserSettings,
} from "@lumo/serialization.js";
import { base64ToAesWrapKey } from "@lumo/crypto/index.js";
import type { ProtonApi } from "../lumo-client/types.js";

/** Shared GET+decrypt for the settings envelope. */
async function loadUserSettings(protonApi: ProtonApi, masterKeyBase64: string) {
  const list = (await protonApi({
    url: "lumo/v1/settings",
    method: "get",
  })) as SerializedEnvelope;
  const fromApi = list?.UserSettings;
  if (!fromApi?.UserSettingsTag || !fromApi.Encrypted) {
    throw new Error("No user settings on the server yet");
  }
  const masterKey = await base64ToAesWrapKey(masterKeyBase64);
  const settings = await deserializeUserSettings(
    {
      userSettingsTag: fromApi.UserSettingsTag,
      encrypted: fromApi.Encrypted,
      createTime: fromApi.CreateTime || new Date().toISOString(),
      updateTime: fromApi.UpdateTime || new Date().toISOString(),
    },
    masterKey,
  );
  if (!settings) {
    throw new Error("User settings could not be decrypted");
  }
  return settings;
}

export type WebThemeMode = "light" | "dark" | "auto";

interface SerializedEnvelope {
  UserSettings?: {
    UserSettingsTag?: string;
    Encrypted?: string;
    CreateTime?: string;
    UpdateTime?: string;
  };
}

/** GET + decrypt + patch theme + encrypt + PUT, all through the
 * authenticated ProtonApi so scopes, tokens and retries are tamer's. */
export async function setWebappThemeMode(
  protonApi: ProtonApi,
  masterKeyBase64: string,
  mode: WebThemeMode,
): Promise<void> {
  const masterKey = await base64ToAesWrapKey(masterKeyBase64);
  const settings = await loadUserSettings(protonApi, masterKeyBase64);
  // Upstream field: string union, dispatched by useLumoThemeLogic's
  // updateSettings({ theme: 'light' | 'dark' | 'auto' }).
  (settings as { theme?: string }).theme = mode;
  const updated = await serializeUserSettings(settings, masterKey);
  // Flat envelope, exactly what upstream putUserSettings sends via
  // sendPutJson('settings', userSettingsArgs).
  const status = await protonApi({
    url: "lumo/v1/settings",
    method: "put",
    data: {
      UserSettingsTag: updated.UserSettingsTag,
      Encrypted: updated.Encrypted,
    },
  });
  if (
    typeof status === "object" &&
    status !== null &&
    "Code" in (status as object) &&
    (status as { Code?: number }).Code !== 1000
  ) {
    throw new Error(
      `PUT settings rejected: ${JSON.stringify(status).slice(0, 200)}`,
    );
  }
  logger.info({ mode }, "webapp theme: server user settings updated");
}

/** Read the theme mode from the server user settings (light | dark |
 * auto). Throws when unsigned-in or no settings exist yet. */
export async function getWebappThemeMode(
  protonApi: ProtonApi,
  masterKeyBase64: string,
): Promise<WebThemeMode> {
  const settings = await loadUserSettings(protonApi, masterKeyBase64);
  const theme = (settings as { theme?: string }).theme;
  return theme === "light" || theme === "dark" ? theme : "auto";
}
