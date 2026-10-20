import { afterEach, expect, it, vi } from "vitest";
import { getPreparedPluginSecretInput } from "openclaw/plugin-sdk/secret-input-runtime";
import { providerBaseUrl, localBaseUrl, ConfigSchema } from "./config.js";
import { Check } from "typebox/value";
import { readFileSync } from "node:fs";
import { resolveRuntimeConfig } from "./credentials.js";
import { evaluate } from "./client.js";
import { createDecisionProvider } from "./decisions.js";
vi.mock("openclaw/plugin-sdk/secret-input-runtime", () => ({
  getPreparedPluginSecretInput: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("preserves API prefixes while legacy plugin baseUrl stays loopback-only", () => {
  expect(providerBaseUrl("https://decision.example/typesafe/v1/")).toBe(
    "https://decision.example/typesafe/v1",
  );
  expect(providerBaseUrl("https://decision.example")).toBe("https://decision.example/v1");
  expect(() => localBaseUrl("https://decision.example/typesafe")).toThrow();
  for (const url of [
    "https://user:pass@decision.example/v1",
    "https://decision.example/v1?key=x",
    "https://decision.example/v1#x",
    "file:///tmp/x",
  ]) {
    expect(() => providerBaseUrl(url)).toThrow();
  }
});
it("supports legacy provider credentials when plugin routing is unset", () => {
  const config = resolveRuntimeConfig({
    models: {
      providers: {
        typesafe: {
          baseUrl: "https://decision.example/typesafe/v1",
          apiKey: "synthetic-key",
          models: [],
        },
      },
    },
  });
  expect(config).toMatchObject({
    apiBaseUrl: "https://decision.example/typesafe/v1",
    apiKey: "synthetic-key",
  });
  expect(getPreparedPluginSecretInput).not.toHaveBeenCalled();
  const unavailable = resolveRuntimeConfig({
    models: {
      providers: {
        typesafe: {
          baseUrl: "https://decision.example/v1",
          apiKey: { source: "env", provider: "default", id: "UNRESOLVED" },
          models: [],
        },
      },
    },
  });
  expect(createDecisionProvider(() => unavailable).isReady?.()).toBe(false);
});
it("sends authenticated requests to the configured API prefix and parses hosted answers", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: "jev-test",
          answers: { q: { type: "noul", noul: 0.9 } },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await evaluate(
    {
      model: "jev-test",
      state: null,
      questions: { q: { type: "noul", instructions: "Check" } },
    },
    {
      apiBaseUrl: "https://decision.example/typesafe/v1",
      apiKey: "synthetic-key",
      timeoutMs: 1000,
    },
  );
  expect(result.evaluation.answers.q).toEqual({ type: "noul", noul: 0.9 });
  expect(fetch.mock.calls[0]?.[0]).toBe("https://decision.example/typesafe/v1/systemone");
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
    "Bearer synthetic-key",
  );
  expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string).questions.q).not.toHaveProperty(
    "criteria",
  );
});

it("supports an explicitly configured HTTP loopback provider without sending a bearer placeholder", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: "jev-test",
          answers: { q: { type: "noul", noul: 0.9 } },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  await evaluate(
    { model: "jev-test", state: null, questions: { q: { type: "noul", instructions: "Check" } } },
    { apiBaseUrl: "http://127.0.0.1:8009/v1", timeoutMs: 1000 },
  );
  expect(fetch.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8009/v1/systemone");
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has("Authorization")).toBe(false);
});

const pluginEndpoint = {
  baseUrl: "https://decision.example/typesafe/v1/",
  apiKey: { source: "env", provider: "default", id: "SYSTEM_ONE_TOKEN" },
};
it("accepts custom API roots in both plugin schemas", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
  );
  expect(Check(ConfigSchema, pluginEndpoint)).toBe(true);
  expect(Check(manifest.configSchema, pluginEndpoint)).toBe(true);
});
it("routes using only plugin settings and the prepared plugin credential", async () => {
  vi.mocked(getPreparedPluginSecretInput).mockReturnValue({ revision: 1, value: "plugin-token" });
  const config = resolveRuntimeConfig({
    plugins: { entries: { typesafe: { config: pluginEndpoint } } },
  });
  expect(config).toMatchObject({
    apiBaseUrl: "https://decision.example/typesafe/v1",
    apiKey: "plugin-token",
    credentialsUnavailable: false,
  });
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: "jev-test",
          answers: { q: { type: "noul", noul: 0.9 } },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  await evaluate(
    { model: "jev-test", state: null, questions: { q: { type: "noul", instructions: "Check" } } },
    config,
  );
  expect(fetch.mock.calls[0]?.[0]).toBe("https://decision.example/typesafe/v1/systemone");
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
    "Bearer plugin-token",
  );
});
it("prefers explicit plugin settings without inheriting provider credentials or transport", () => {
  vi.mocked(getPreparedPluginSecretInput).mockReturnValue({ revision: 1, value: "plugin-token" });
  const config = resolveRuntimeConfig({
    plugins: { entries: { typesafe: { config: pluginEndpoint } } },
    models: {
      providers: {
        typesafe: {
          baseUrl: "https://old.example/v1",
          apiKey: "old-token",
          models: [],
          headers: { "X-Old": "old" },
        },
      },
    },
  });
  expect(config.apiBaseUrl).toBe("https://decision.example/typesafe/v1");
  expect(config.apiKey).toBe("plugin-token");
});
it("fails closed on an unavailable plugin credential and observes recovery and rotation", async () => {
  const snapshot = { plugins: { entries: { typesafe: { config: pluginEndpoint } } } };
  vi.mocked(getPreparedPluginSecretInput).mockReturnValue({ revision: 1 });
  const unavailable = resolveRuntimeConfig(snapshot);
  expect(createDecisionProvider(() => unavailable).isReady?.()).toBe(false);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    evaluate(
      { model: "jev-test", state: null, questions: { q: { type: "noul", instructions: "Check" } } },
      unavailable,
    ),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  for (const value of ["recovered-token", "rotated-token"]) {
    vi.mocked(getPreparedPluginSecretInput).mockReturnValue({ revision: 2, value });
    expect(resolveRuntimeConfig(snapshot).apiKey).toBe(value);
    expect(createDecisionProvider(() => resolveRuntimeConfig(snapshot)).isReady?.()).toBe(true);
  }
});
it("allows a keyless custom plugin endpoint without inheriting another key", () => {
  const config = resolveRuntimeConfig({
    plugins: { entries: { typesafe: { config: { baseUrl: pluginEndpoint.baseUrl } } } },
    models: {
      providers: {
        typesafe: { baseUrl: "https://old.example/v1", apiKey: "old-token", models: [] },
      },
    },
  });
  expect(config.apiBaseUrl).toBe("https://decision.example/typesafe/v1");
  expect(config.apiKey).toBeUndefined();
  expect(createDecisionProvider(() => config).isReady?.()).toBe(true);
});

it.each([
  "https://user:pass@decision.example/v1",
  "https://decision.example/v1?key=x",
  "https://decision.example/v1#x",
  "file:///tmp/x",
  " https://decision.example/v1",
  "https://decision.example:65536/v1",
  "https://decision.example/\\evil",
  null,
])("rejects unsafe plugin API root %s before reading credentials", (baseUrl) => {
  expect(() =>
    resolveRuntimeConfig({ plugins: { entries: { typesafe: { config: { baseUrl } } } } }),
  ).toThrow("baseUrl");
  expect(getPreparedPluginSecretInput).not.toHaveBeenCalled();
});

it("uses prepared plugin auth for a loopback API path without selecting local Kev mode", () => {
  vi.mocked(getPreparedPluginSecretInput).mockReturnValue({ revision: 1, value: "loopback-token" });
  const config = resolveRuntimeConfig({
    plugins: {
      entries: { typesafe: { config: { ...pluginEndpoint, baseUrl: "http://127.0.0.1:8009/v1" } } },
    },
  });
  expect(config.apiBaseUrl).toBe("http://127.0.0.1:8009/v1");
  expect(config.apiKey).toBe("loopback-token");
  expect(config.baseUrl).toBeUndefined();
});

it("rejects plugin credentials on remote HTTP before reading the prepared secret", () => {
  expect(() =>
    resolveRuntimeConfig({
      plugins: {
        entries: {
          typesafe: { config: { ...pluginEndpoint, baseUrl: "http://decision.example/v1" } },
        },
      },
    }),
  ).toThrow("HTTPS");
  expect(getPreparedPluginSecretInput).not.toHaveBeenCalled();
});
it("rejects legacy provider credentials on remote HTTP", () => {
  expect(() =>
    resolveRuntimeConfig({
      models: {
        providers: {
          typesafe: { baseUrl: "http://decision.example/v1", apiKey: "synthetic-key", models: [] },
        },
      },
    }),
  ).toThrow("HTTPS");
});
