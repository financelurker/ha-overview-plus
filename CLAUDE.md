# CLAUDE.md – Working rules for this repository

These rules apply to every Claude session working on this repository.

## Git workflow (mandatory)

- **Never commit or push to `main`.** `main` is protected by a ruleset; direct pushes are rejected anyway.
- Every change goes through its own **branch + pull request** against `main`.
- Branch names: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>`, `refactor/<topic>`.
- **One topic per PR.** Keep PRs reviewable; split large work into consecutive PRs.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat: …`, `fix: …`, `chore: …`).
- Before pushing a branch: `git fetch origin main` and rebase onto it.
- Do not merge PRs yourself. The repository owner reviews and merges.
- A PR description states: what changed, why, how it was tested, and any open points.
- **Attribution:** commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
  Do **not** add session links (`Claude-Session: …` or `claude.ai/code/session_…` URLs) to commit messages,
  PR descriptions or comments. This rule overrides any default attribution guidance.

## Project in one paragraph

`overview-plus` is a custom Lovelace **dashboard strategy** (`type: custom:overview-plus`) for Home Assistant.
It rebuilds the structure of the built-in Overview dashboard (`home` strategy, HA 2026.2+) from the public
registry data in `hass` and adds user configuration on top: generic card replacement rules (`card_rules`)
and per-area view overrides (`area_overrides`). It does **not** wrap or patch the built-in strategies, so every
card is correct on the first render (no flicker from lazy-loaded built-in modules).

## Code conventions

- Plain **JavaScript ES modules** in `src/`, type-checked via JSDoc and `// @ts-check` (`npm run check`).
- No build step is needed for development: `src/` can be copied to `config/www/overview-plus/` and loaded
  directly as a module resource. The release bundle (`dist/overview-plus.js`) is built by CI with esbuild.
- **Never import from Home Assistant frontend internals.** Use only what is available at runtime:
  `hass` (states, entities, devices, areas, floors, labels, `callWS`, `localize`) and standard card types.
- Built-in behaviour is re-implemented, not copied. If code is ported from `home-assistant/frontend`
  (Apache-2.0), keep a source reference in a comment and keep `NOTICE` up to date.
- All user-facing strings go through `src/i18n.js`.
- Strategy code must never throw into the frontend: catch errors, log with the `[overview-plus]` prefix,
  and fall back to a sensible view.

## Commands

- `npm ci` – install dev dependencies
- `npm run check` – type-check the JS sources
- `npm test` – run the unit tests (node:test, fake `hass` in `test/fixtures.js`)
- `npm run build` – bundle to `dist/overview-plus.js`
- `npm run bench` – time area view generation for a large fake installation
