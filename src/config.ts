import { Type } from "typebox";

const LOCAL_BASE_URL_PATTERN =
  "^https?://(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::[0-9]{1,5})?/?$";
const API_BASE_URL_PATTERN = "^https?://[^\\s/@?#]+(?:/[^\\s?#]*)?$";
const apiBaseUrlPattern = new RegExp(API_BASE_URL_PATTERN);
const localBaseUrlPattern = new RegExp(LOCAL_BASE_URL_PATTERN);
export const ConfigSchema = Type.Object(
  {
    baseUrl: Type.Optional(Type.String({ maxLength: 2048, pattern: API_BASE_URL_PATTERN })),
    apiKey: Type.Optional(
      Type.Object(
        {
          source: Type.Union([
            Type.Literal("env"),
            Type.Literal("store"),
            Type.Literal("file"),
            Type.Literal("exec"),
          ]),
          provider: Type.String({ minLength: 1, maxLength: 128 }),
          id: Type.String({ minLength: 1, maxLength: 1024 }),
        },
        { additionalProperties: false },
      ),
    ),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 60000, default: 30000 })),
  },
  { additionalProperties: false },
);

export type RuntimeConfig = {
  apiKey?: string;
  baseUrl?: string;
  apiBaseUrl?: string;
  credentialsUnavailable?: boolean;
  timeoutMs: number;
};
/** Standard provider API roots retain configured prefixes and imply /v1 for origins. */
export function providerBaseUrl(value: unknown, authenticated = false): string {
  const parsed =
    typeof value === "string" &&
    value.length <= 2048 &&
    apiBaseUrlPattern.test(value) &&
    !value.includes("\\")
      ? URL.parse(value)
      : null;
  if (
    !parsed ||
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "Invalid TypeSafe baseUrl; use an HTTP(S) API root without credentials, query, or fragment.",
    );
  }
  if (
    authenticated &&
    parsed.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  ) {
    throw new Error("TypeSafe credentials require HTTPS except for loopback endpoints.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/v1";
  return parsed.toString().replace(/\/+$/, "");
}
export function hasCredentials(config: RuntimeConfig): boolean {
  return (
    !config.credentialsUnavailable && Boolean(config.baseUrl || config.apiBaseUrl || config.apiKey)
  );
}

/** A configured endpoint grants access to one loopback origin, never arbitrary private hosts. */
export function localBaseUrl(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed =
    typeof value === "string" && value === value.trim() && localBaseUrlPattern.test(value)
      ? URL.parse(value)
      : null;
  if (!parsed) {
    throw new Error(
      "Invalid TypeSafe baseUrl; use an http(s) loopback origin without a path, credentials, query, or fragment.",
    );
  }
  return parsed.origin;
}

/** Validate runtime settings and recognize materialized credentials without resolving inputs. */
export function runtimeConfig(config: Record<string, unknown> | undefined): RuntimeConfig {
  const configuredUrl = config?.baseUrl;
  const baseUrl =
    typeof configuredUrl === "string" && localBaseUrlPattern.test(configuredUrl)
      ? localBaseUrl(configuredUrl)
      : undefined;
  const apiBaseUrl =
    configuredUrl !== undefined && !baseUrl
      ? providerBaseUrl(configuredUrl, config?.apiKey !== undefined)
      : undefined;
  const timeoutMs = config?.timeoutMs ?? 30000;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 60000
  ) {
    throw new Error("Invalid TypeSafe configuration; check plugin Settings.");
  }
  if (baseUrl) {
    return { baseUrl, timeoutMs };
  }
  const key = config?.apiKey;
  return {
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    apiKey: typeof key === "string" && key.trim() ? key : undefined,
    timeoutMs,
  };
}
