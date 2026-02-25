# Mise

[Mise](https://mise.jdx.dev/) is a polyglot tool version manager. The mise provider tracks the tools declared in `mise.toml` (e.g. node, python, bun) as dependencies, letting you see which tools are outdated and what newer versions are available.

- **No publish dates.** Mise tools don't carry publish date metadata, so age-based columns in the dashboard are empty and date-based compliance policies do not apply.
- **Version data comes from mise-versions.** The provider fetches the version list from `https://mise-versions.jdx.dev/<tool>` to build the upgrade path between your current version and the latest.
- **Latest version comes from `mise outdated`.** The provider runs `mise outdated --json --bump` to determine the latest version of each tool.

The mise provider only includes tools whose configuration lives under the repo root (tools from global `~/.config/mise/config.toml` are excluded).

Mise is always detected via `mise.toml` presence (there is no runtime detection).
