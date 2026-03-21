# Documentation index — `@fabric/core`
## Vision & first reads

| Doc | Audience | Purpose |
|-----|----------|---------|
| [../VISION.md](../VISION.md) | Everyone | **North star** — product vision, architecture snapshot, doc map |
| [../README.md](../README.md) | Everyone | Install, ecosystem table, API snippet |
| [../GOALS.md](../GOALS.md) | Contributors | Engineering principles and current goals |
| [../SUMMARY.md](../SUMMARY.md) | Navigation | Link hub to major docs (check paths under `guides/`) |
| [../QUICKSTART.md](../QUICKSTART.md) | New users | Minimal install → `fabric chat` |
| [../DEVELOPERS.md](../DEVELOPERS.md) | Contributors | Repo layout, tests, storage, core types |
| [../AGENTS.md](../AGENTS.md) | Service authors | Agent lifecycle, workers, safety |
| [PRODUCTION.md](PRODUCTION.md) | Operators | Node version, native deps, release gate |
| [../PRIVACY.md](../PRIVACY.md) | Operators | Threat model |
| [../SECURITY.md](../SECURITY.md) | Reporters | Process, disclosure |

## Protocol & reference

| Doc | Purpose |
|-----|---------|
| [../PROTOCOL.md](../PROTOCOL.md) | Wire format and message types |
| [../MESSAGES.md](../MESSAGES.md) | Message semantics |
| [../POLICY.md](../POLICY.md) | Relay and policy constants |
| [../API.md](../API.md) | Markdown API (run `npm run make:api`) |

## Generated output

After **`npm run make:docs`**: JSDoc HTML under **`docs/*.html`** (plus **`npm run make:api`** refreshes root **`API.md`**). Regenerate after changing public JSDoc on `types/` or `services/`.

## Downstream

**hub.fabric.pub** (rendezvous hub, HTTP bridge) and **@fabric/http** are separate repos; align versions per **[docs/RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)** and **[../DEVELOPERS.md](../DEVELOPERS.md)**.
