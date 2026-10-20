# TypeSafe AI for OpenClaw

## Fork provenance and version

This repository is an independently maintained fork of the
[`extensions/typesafe` directory in OpenClaw v2026.10.5](https://github.com/openclaw/openclaw/tree/v2026.10.5/extensions/typesafe),
maintained under `ani6439walc`. It is not the official OpenClaw distribution.

- **Upstream baseline:** OpenClaw `v2026.10.5`.
- **Upstream commit:** `1b58cb9a1b4f4353e1add63c8506db4d890962e8`.
- **Current plugin version:** `2026.10.5`, inherited unchanged from upstream `package.json`.
- **Fork release:** No separate fork release or version tag has been published yet.

The initial import preserved all 24 upstream files byte-for-byte. Subsequent fork
changes are recorded in this repository's Git history. Retain the upstream
copyright notice when maintaining or redistributing this fork.

## Overview

The upstream plugin provides typed decisions with hosted TypeSafe AI Jev models
or a local Kev System One server.
It provides Choice, Score, and Boolean judgments through OpenClaw's shared
decision-model API. Core supplies the provider-neutral `decision_evaluate` agent
tool when the agent has an effective `decisionModel` selection, subject to normal
tool policy and harness capabilities. No separate tool enablement is required.

This fork targets OpenClaw **2026.10.5**.

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

Configure the endpoint and its credential directly in the plugin settings.
No `models.providers.typesafe` entry is required:

```json
{
  "plugins": {
    "entries": {
      "typesafe": {
        "enabled": true,
        "config": {
          "baseUrl": "https://decision.example.com/typesafe/v1",
          "apiKey": {
            "source": "env",
            "provider": "default",
            "id": "SYSTEM_ONE_TOKEN"
          }
        }
      }
    }
  },
  "agents": { "defaults": { "decisionModel": "typesafe/jev-latest" } }
}
```

The adapter appends `/systemone`; origin-only URLs imply `/v1`. Authenticated non-loopback API roots must use HTTPS. HTTP with a credential
is allowed only for `localhost`, `127.0.0.1`, or `[::1]`; `localhost` resolution
is pinned to loopback addresses. `apiKey` accepts a SecretRef prepared by the host, never a
plaintext key. An unavailable configured credential fails closed. Omitting
`apiKey` supports an unauthenticated custom endpoint without inheriting a key
from another route. `timeoutMs` controls the plugin request timeout.

Bare loopback origins retain the local Kev behavior described above: no
credential is sent and local answer conversion is used. To use an authenticated
API with hosted Jev response semantics on loopback, include its API path, such as
`http://127.0.0.1:8009/v1`.

Explicit plugin `baseUrl` or `apiKey` takes priority over the legacy
`models.providers.typesafe` entry; endpoint and credentials are never merged
across those settings. The provider entry remains a compatibility fallback when
both plugin fields are absent. It supports API-root routing, prepared bearer
credentials, and provider timeouts. Advanced `request`, custom `headers`, and
`authHeader: false` provider overrides require a newer host SDK and are rejected.

Requests retain exact-origin network policy, redirect rejection, deadlines,
response-size limits, and strict answer validation. Custom API roots bypass
ambient `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` settings; default hosted
requests retain trusted environment-proxy handling.

## GitHub checks and Jules review

CI runs formatting, type checks, Vitest, review-script tests, build, loader checks,
and a package dry run on Node.js 24 and 26 for PRs targeting `main` and pushes to
`main`.

Jules review runs when a same-repository PR is opened, updated, or reopened by
the owner or a trusted collaborator. It posts an advisory review comment; it does
not approve or merge the PR.

To enable it:

1. Connect this repository through the Jules GitHub app so it appears in the
   [Jules Sources API](https://jules.google/docs/api/reference/sources/).
2. Add `JULES_API_KEY` as a repository Actions secret using your
   [Jules API key](https://jules.google/docs/api/reference/authentication/).
3. Ensure GitHub Actions is enabled and permits the workflow's contents and
   issue-comment write permissions, then update or reopen the PR.

A missing key or disconnected repository fails with a setup message. Large diffs
use a temporary `temp/pr-<number>-diff-<run-id>-<attempt>` branch that is removed after the review.
The workflow checks out the event's PR head and constructs every diff from the
pinned base/head commits, without querying the mutable PR diff API. It waits for
a reviewable session state and reads all activity pages. The completed review is saved to the Actions step summary before posting
the PR comment, so a delivery failure does not hide the result.
It does not call undocumented pause/archive endpoints; workflow cancellation or
timeout does not terminate the remote Jules session. Inspect the session link
when a run times out.
