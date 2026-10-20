# TypeSafe AI for OpenClaw

Official external plugin for typed decisions with hosted TypeSafe AI Jev models
or a local Kev System One server.
It provides Choice, Score, and Boolean judgments through OpenClaw's shared
decision-model API. Core supplies the provider-neutral `decision_evaluate` agent
tool when the agent has an effective `decisionModel` selection, subject to normal
tool policy and harness capabilities. No separate tool enablement is required.

Requires OpenClaw and plugin API **2026.9.6 or later**. Released OpenClaw
2026.9.5 does not include the decision API.

```sh
openclaw plugins install @openclaw/typesafe
```

The ClawHub install spec is `clawhub:@openclaw/typesafe`. First publication is
pending a supporting release. Enable the plugin, configure a protected TypeSafe credential, and select
`typesafe/jev-latest` as your agent's `decisionModel`. With that selection,
`decision_evaluate` sends supplied evidence to TypeSafe AI and incurs its normal
usage charges. Other providers route evidence according to their own configuration.

For local Kev, configure `plugins.entries.typesafe.config.baseUrl` with the
server's loopback origin, such as `http://127.0.0.1:8009`, omit `apiKey`, and select
`typesafe/kev-latest`. The plugin calls `/v1/systemone` without a hosted credential.
Start the server separately with your chosen checkpoint; the decision-model
selection labels requests and does not download or load a model.

See the [TypeSafe AI setup guide](https://docs.openclaw.ai/plugins/typesafe) and
[decision-model documentation](https://docs.openclaw.ai/concepts/decision-models)
for configuration, rubrics, and API semantics.

## Standalone fork and local development

This repository maintains TypeSafe as a standalone OpenClaw plugin. It targets
OpenClaw 2026.10.5 and loads the built `dist/index.js` entry. Use the pnpm release
declared in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm format
pnpm test
pnpm build
pnpm test:plugin-loader
```

## Custom System One provider

Configure API-root routing with `models.providers.typesafe`, independently of
the hosted plugin credential:

```json
{
  "models": {
    "providers": {
      "typesafe": {
        "baseUrl": "https://decision.example.com/typesafe/v1",
        "apiKey": {
          "source": "env",
          "provider": "default",
          "id": "SYSTEM_ONE_TOKEN"
        },
        "models": []
      }
    }
  },
  "plugins": { "entries": { "typesafe": { "enabled": true } } },
  "agents": { "defaults": { "decisionModel": "typesafe/jev-latest" } }
}
```

The adapter appends `/systemone`; origin-only URLs imply `/v1`. The host must
prepare the provider credential. An unavailable configured credential fails
closed, without inheriting the plugin key or falling back to hosted TypeSafe.
Legacy plugin `baseUrl` remains loopback-only and unauthenticated. Requests keep
HTTPS, exact-origin network policy, redirect rejection, deadlines, and strict
hosted answer validation.

This compatibility implementation supports API-root routing, prepared bearer
credentials, and provider timeouts. Advanced `request`, custom `headers`, and
`authHeader: false` overrides require a newer host SDK and are explicitly rejected.
