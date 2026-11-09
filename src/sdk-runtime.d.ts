// Narrow declarations for exports still missing .d.ts files in OpenClaw 2026.11.2.
// Signatures originally checked against the v2026.10.5 source tag.
// Retain until the SDK publishes matching declarations.
declare module "openclaw/plugin-sdk/fetch-runtime" {
  import type { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
  type GuardedFetchOptions = Parameters<typeof fetchWithSsrFGuard>[0];
  export function responseWithRelease(response: Response, release: () => Promise<void>): Response;
  export function shouldUseEnvHttpProxyForUrl(targetUrl: string, env?: NodeJS.ProcessEnv): boolean;
  export function withTrustedEnvProxyGuardedFetchMode(
    params: Omit<GuardedFetchOptions, "mode">,
  ): GuardedFetchOptions;
}
declare module "openclaw/plugin-sdk/retry-runtime" {
  export function parseRetryAfterHeaderSeconds(
    value: string | null | undefined,
    now?: number,
  ): number | undefined;
}
