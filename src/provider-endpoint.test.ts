import { afterEach, expect, it, vi } from "vitest";
import { getPreparedPluginSecretInput } from "openclaw/plugin-sdk/secret-input-runtime";
import { providerBaseUrl, localBaseUrl } from "./config.js";
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
it("provider credentials own the route without inheriting plugin secrets", () => {
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
    plugins: {
      entries: {
        typesafe: {
          config: {
            apiKey: { source: "env", provider: "default", id: "unused" },
          },
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
