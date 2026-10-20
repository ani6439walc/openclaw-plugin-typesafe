import { resolveSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { getPreparedPluginSecretInput } from "openclaw/plugin-sdk/secret-input-runtime";
import { providerBaseUrl, runtimeConfig, type RuntimeConfig } from "./config.js";

/** Only host-prepared capability snapshots may supply a credential. Never resolve or cache refs. */
export function resolveRuntimeConfig(
  snapshot: ReturnType<OpenClawPluginApi["runtime"]["config"]["current"]>,
): RuntimeConfig {
  const configured = snapshot.plugins?.entries?.typesafe?.config;
  const provider = snapshot.models?.providers?.typesafe;
  if (provider && configured?.baseUrl === undefined && configured?.apiKey === undefined) {
    // This compatibility backport supports API-root routing and prepared bearer auth.
    // Other shared provider transport overrides require a newer host SDK.
    if (provider.request || provider.headers || provider.authHeader === false) {
      throw new Error("TypeSafe provider transport overrides require a newer OpenClaw host.");
    }
    const { timeoutMs } = runtimeConfig({ timeoutMs: configured?.timeoutMs });
    const credential = resolveSecretInputString({
      value: provider.apiKey,
      defaults: snapshot.secrets?.defaults,
      path: "models.providers.typesafe.apiKey",
      mode: "inspect",
    });
    return {
      apiBaseUrl: providerBaseUrl(provider.baseUrl, provider.apiKey !== undefined),
      apiKey: credential.value,
      credentialsUnavailable: credential.status === "configured_unavailable",
      timeoutMs: provider.timeoutSeconds === undefined ? timeoutMs : provider.timeoutSeconds * 1000,
    };
  }
  const validated = runtimeConfig(configured);
  if (validated.baseUrl) {
    return validated;
  }
  const prepared = getPreparedPluginSecretInput("typesafe", "apiKey");
  return {
    ...validated,
    // A custom keyless endpoint must not inherit a stale hosted credential.
    apiKey: configured?.apiKey === undefined && validated.apiBaseUrl ? undefined : prepared.value,
    credentialsUnavailable: configured?.apiKey !== undefined && !prepared.value,
  };
}
