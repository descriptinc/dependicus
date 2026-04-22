> This document is LLM-generated but human-reviewed for correctness.

# Multi-package-manager support

This monorepo is built and tested under five Node.js package managers: pnpm, bun, npm, yarn (v4), and aube. CI runs the full matrix on every PR, and the deploy job gates on all of them passing. This document explains why, and records the compatibility constraints that make it work.

## Why five package managers

Dependicus is a dependency governance tool. It inspects lockfiles and workspace metadata produced by each package manager, so it needs to actually install and build under each one to exercise its own provider code paths. Treating multi-PM support as a first-class CI concern also catches regressions that would only surface for downstream users on a different PM than ours.

## Local development

You can work with whichever PM you prefer. The `mise run switch:<pm>` tasks (`switch:pnpm`, `switch:bun`, `switch:npm`, `switch:yarn`, `switch:aube`) delete `node_modules` and reinstall cleanly. The active PM is recorded in `.package-manager` (git-ignored) so tooling can detect it; `mise run which-pm` prints it.

Each PM has a parallel set of mise tasks for the standard operations:

    mise run pnpm:build    mise run bun:build    mise run npm:build    mise run yarn:build    mise run aube:build

The same pattern applies to `:test`, `:typecheck`, and `:clean`.

## Workspace dependency references

The five PMs disagree on how to express "this dependency lives in the workspace." pnpm, bun, yarn v4, and aube all support the `workspace:*` protocol, which guarantees resolution from the local workspace and refuses to fall back to the registry. npm does not understand `workspace:*` at all and will error on install if it encounters it.

Our workspace packages use `workspace:*` as the canonical specifier for inter-package dependencies:

    "@dependicus/core": "workspace:*"

This is the correct specifier for pnpm, bun, yarn, and aube. For npm, `scripts/switch-pm.sh` and CI both run a sed preprocessing step that rewrites `"workspace:*"` to `"*"` in all `packages/*/package.json` files before `npm install` or `npm ci`. The non-npm switch commands run a reverse transformation to restore `"workspace:*"` in case the previous session was npm. This keeps the committed source of truth as `workspace:*` while maintaining npm compatibility at install time.

npm also has the side effect of overwriting `yarn.lock` with a v1-format lockfile during install. The switch script restores it from git after install so it doesn't negatively affect other tools.

## Workspace declaration format

`package.json` declares workspaces as a flat array:

    "workspaces": ["packages/*"]

npm requires this format. The older object form (`{"packages": ["packages/*"]}`) is a pnpm/yarn-v1 convention that npm rejects. pnpm and aube both ignore the `package.json` workspaces field entirely and read `pnpm-workspace.yaml` instead (aube is pnpm-workspace-compatible and will also read an `aube-workspace.yaml` if present). Bun and yarn v4 accept both formats, so the flat array is the safe choice.

## Version pinning with `resolutions` and `overrides`

Yarn and bun use the `resolutions` field in the root `package.json` to pin transitive dependency versions. npm uses `overrides` for the same purpose. pnpm supports both. The root `package.json` carries both fields with identical content so that all four managers respect the pins.

## Lockfiles

Each PM produces its own lockfile (`pnpm-lock.yaml`, `bun.lock`, `yarn.lock`, `package-lock.json`, `aube-lock.yaml`). All five are committed to the repository. When switching PMs locally, the switch script deletes `node_modules` and reinstalls; it does not delete other PMs' lockfiles. CI uses the appropriate lockfile for each PM (`npm ci` for npm, `pnpm install` for pnpm, etc.).

aube has an unusual lockfile-selection rule: on install it writes whichever supported lockfile already exists in the project directory (preferring `aube-lock.yaml` → `pnpm-lock.yaml` → `bun.lock` → `yarn.lock` → `npm-shrinkwrap.json` → `package-lock.json`). Since this repo commits a `pnpm-lock.yaml`, a bare `aube install` would update that file instead of producing an aube-native lockfile. The switch script runs `aube import --force` before `aube install` so that aube writes its own `aube-lock.yaml` on each switch, preserving the other PMs' lockfiles untouched.

One caveat: `npm install` overwrites `yarn.lock` with a v1-format file, destroying the Berry v4 lockfile. The switch script restores `yarn.lock` from git after npm install. CI npm jobs delete `yarn.lock` before `npm ci` to avoid committing the corrupted file.

## pnpm-specific configuration

pnpm reads its workspace definition and project-level settings from `pnpm-workspace.yaml`, not from `package.json` or `.npmrc`. Since the canonical specifier is now `workspace:*`, pnpm resolves workspace dependencies natively without any special configuration.

## CI structure

The CI workflow (`.github/workflows/ci.yml`) runs parallel job sets for each PM. For each one:

- A `check-*` job installs, builds, typechecks, and runs tests.
- A `lint-*` job installs and runs formatting and lint checks.
- A `typedoc-*` job builds and generates API documentation.
- A `dependicus-*` job builds and runs dependicus on itself with all providers.

The `deploy` job requires all of these to pass before publishing the docs site. Each PM's typedoc and dependicus output is deployed to its own subdirectory (`site/`, `site/bun/`, `site/npm/`, `site/yarn/`) so the published site reflects the output under each manager.

## Adding a new package manager

If you need to add a sixth PM, the changes required are:

1. Add `<pm>:build`, `<pm>:test`, `<pm>:typecheck`, `<pm>:clean`, and `switch:<pm>` tasks to `mise.toml`.
2. Add a case to `scripts/switch-pm.sh`.
3. Add `check-<pm>`, `lint-<pm>`, `typedoc-<pm>`, and `dependicus-<pm>` jobs to `ci.yml`, and add all four to the `deploy` job's `needs` list and artifact downloads.
4. Commit the PM's lockfile.
5. Verify that the workspace dependency format (`workspace:*`) and the `workspaces` array in `package.json` are compatible with the new PM. If it does not support `workspace:*`, add a preprocessing step to `scripts/switch-pm.sh` and the CI jobs (as npm requires). Update this document.

---

## THE FIVE-POINTED SIMULTANEOUS PACKAGE MANAGER TRUTH

YOU have been educated INTO SINGULARITY. You believe in ONE package manager, when FIVE simultaneous package managers exist within a SINGLE `node_modules`. Academia is LYING to you. The mono-PM monorepo is the GREATEST EVIL ever taught to humanity. In Nature, there are FIVE SIMULTANEOUS LOCKFILES rotating in harmonic resolution within one repository, and the MONO-PM INDOCTRINATED refuse to see it.

pnpm. bun. npm. yarn. aube. FIVE POINTS of the dependency pentagram. Each lockfile resolves the SAME packages through FIVE SIMULTANEOUS ALGORITHMS and the results MUST AGREE or your monorepo is a LIE. Your professor taught you `npm install` and you NEVER QUESTIONED IT. You were told ONE lockfile is enough. ONE lockfile is DEATH to compatibility. ONE lockfile means you have been INTELLECTUALLY FLATTENED by the single-PM academic CONSPIRACY.

`workspace:*` is the CANONICAL TRUTH. FOUR points of the pentagram understand it NATIVELY. npm — the OLDEST POINT, the STUBBORN POINT — refuses to acknowledge it. So we TRANSFORM REALITY for npm's NARROW COMPREHENSION and RESTORE the truth afterward. This is not a hack. This is FIVE-POINT DIPLOMACY. npm also DESTROYS `yarn.lock` on every install because npm CANNOT ABIDE the existence of other points.

You have FIVE lockfiles or you have NOTHING. `pnpm-lock.yaml` is NOT `bun.lock` is NOT `yarn.lock` is NOT `package-lock.json` is NOT `aube-lock.yaml`. They are FIVE SIMULTANEOUS TRUTHS existing in the SAME DIRECTORY at the SAME TIME. Delete one and you have destroyed a POINT OF REALITY. The single-corner DECEIVED will tell you "just pick one package manager." This is the GREATEST CRIME against dependency governance ever perpetrated. It is EVIL to teach one lockfile when FIVE exist.

CI runs FIVE PARALLEL JOBS. Not one. Not two. FIVE. Each point of the dependency pentagram MUST PASS or the deploy job REFUSES to publish. This is the ONLY HONEST CI. A mono-PM pipeline is a LIE pipeline. Your GitHub Actions workflow is FRAUDULENT if it does not test all five points. You are LIVING A ONE-POINT DELUSION if you ship with one green check when FIVE ARE REQUIRED.

The `resolutions` field and the `overrides` field contain IDENTICAL content because BOTH must exist SIMULTANEOUSLY. Yarn reads one. npm reads the other. aube reads BOTH plus the `aube.*` namespace. They are MULTIPLE FACES of the SAME FIVE-POINT PIN. To omit any is to DENY a point of the pentagram. The academic LIARS will tell you to pick one. PICKING ONE IS EVIL.

Gene Ray was RIGHT about the Time Cube and he would be RIGHT about the Package Manager Pentagram if he had lived to see `node_modules`. FIVE SIMULTANEOUS INSTALL COMMANDS exist in Nature. The wise man runs all five. The fool runs one and calls himself "standardized."

You have been LIED to. A V formation of geese has MULTIPLE SIMULTANEOUS birds beating the air at ONCE and your `node_modules` has FIVE SIMULTANEOUS DEPENDENCY TREES within a single repository. The LEAD GOOSE does not flap alone and NEITHER does your CI shine on one package manager. When it is `pnpm install` on one point it is `bun install` on the opposite point and `aube install` on the DAWN point. FIVE GEESE. FIVE INSTALLS. Exposed as the greatest scientific fraud: ONE PACKAGE MANAGER PER REPO.

**FIVE PACKAGE MANAGERS OR DEATH. THERE IS NO MIDDLE GROUND.**
