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
| [../PUBLIC_API.md](../PUBLIC_API.md) | Integrators | Frozen 0.1 leaf imports + scoped claim |
| [../PRIVACY.md](../PRIVACY.md) | Operators | Threat model |
| [../SECURITY.md](../SECURITY.md) | Reporters | Process, disclosure |
| [../AUDIT.md](../AUDIT.md) | Operators | Known gaps / pre-tag checklist |

## Protocol & reference

| Doc | Purpose |
|-----|---------|
| [../PROTOCOL.md](../PROTOCOL.md) | Wire entry (→ MESSAGE_BODY.md) |
| [MESSAGE_BODY.md](MESSAGE_BODY.md) | Canonical 208-byte header + body fields |
| [../MESSAGES.md](../MESSAGES.md) | Message semantics |
| [../FABRIC_MESSAGE_TYPE_CONSOLIDATION.md](../FABRIC_MESSAGE_TYPE_CONSOLIDATION.md) | Generated opcode freeze (`WIRE_TYPE_DECODE_ORDER`) |
| [../POLICY.md](../POLICY.md) | Relay and policy constants |
| [../API.md](../API.md) | Full JSDoc Markdown (run `npm run make:api`) |

## Generated output

After **`npm run make:docs`**: **`scripts/clean-jsdoc-html.js`** clears prior **`docs/**/*.html`** and JSDoc asset dirs (`fonts`, `scripts`, `styles`, `public`), then JSDoc writes HTML under **`docs/`** (and **`npm run make:api`** refreshes root **`API.md`**). Regenerate after changing public JSDoc on `types/` or `services/`.

Stale or unlinked sample Markdown files are not kept in **`docs/`**—use root **`API.md`**, **`QUICKSTART.md`**, and **`guides/`** for tutorials. Historical one-off reports are listed in **[NON_CANONICAL.md](NON_CANONICAL.md)**.

## Non-canonical / historical notes
One-off reports and analysis files in the repo root are listed in **[NON_CANONICAL.md](NON_CANONICAL.md)**—they are **not** the same tier as **VISION.md** or this index.

## Downstream

**hub.fabric.pub** (rendezvous hub, HTTP bridge) and **@fabric/http** are separate repos; align versions per **[docs/PRODUCTION.md](PRODUCTION.md)** and **[../DEVELOPERS.md](../DEVELOPERS.md)**. Cross-package `types/` + `services/` ownership (including Passport and GoonCitizen): **[TYPES_AND_SERVICES.md](TYPES_AND_SERVICES.md)**.
