# interactive-code-map

> **English** | [简体中文](README.zh-CN.md)

A cross-client skill that turns codebase evidence into a single interactive HTML code map — or a described non-code business process into the same evidence-backed map — with explicit evidence states and a structured MapSpec that separates research from presentation.

## See it in action

![Interactive code map demo showing zoom, pan, relationship highlighting, click-to-pin, and line-level evidence](docs/assets/interactive-code-map-demo.gif)

## Online demos

- [English demo](https://yulaiz.github.io/interactive-code-map/en/)
- [简体中文演示](https://yulaiz.github.io/interactive-code-map/zh-CN/)

## Installation

The installable package is the repository's `skill/` directory. Keep it intact, including `SKILL.md`, `SKILL.zh-CN.md`, `renderer/`, and `references/`.

A complete [Chinese reading translation of the skill](skill/SKILL.zh-CN.md) is included for people who install the package. `skill/SKILL.md` remains the only executable entry.

### All supported agent clients

Paste this into Codex, ZCode, Claude Code, Claude Desktop Code, or WorkBuddy:

> Fetch `https://github.com/YuLaiZ/interactive-code-map`. Install its `skill/` directory as the `interactive-code-map` skill using this client's supported skill-install mechanism. Keep the directory intact, including `SKILL.md`, `SKILL.zh-CN.md`, `renderer/`, and `references/`. Confirm the skill is discoverable and can generate a relative HTML map. If this client cannot install skills itself, report the exact manual import step; do not guess an internal path or create a symlink.

Each client owns its installation location; there is no portable shared directory. This prompt is the preferred common path because it lets the client choose its supported installer without baking machine-specific paths into the project.

### Local or offline checkout

When an agent already has this repository as its workspace, replace the first sentence above with: `Install the current workspace's skill/ directory as the interactive-code-map skill.` The same package-integrity and fallback rules still apply.

Use a development symlink only when a client explicitly supports it and you want live edits to be visible. It is not the release installation contract.

## Manual HTML generation

Create a MapSpec from inspected code or supporting documents, then validate its verified evidence against the selected evidence root and build a relative output path:

~~~bash
node skill/renderer/build-html.mjs \
  --in path/to/mapspec.json \
  --out docs/code-map.html \
  --repo-root path/to/evidence-root \
  --cdn-profile global
~~~

`--repo-root` is the evidence root: the repository root for code maps, or the directory holding the user's supporting documents for a non-code business-process map. Verified evidence cites inspected lines in either case; statements that come only from a verbal description stay `inferred` or `unconfirmed`.

The builder validates the MapSpec, embeds the application code and CSS, and writes the output atomically. It never deletes the input MapSpec. The resulting HTML needs network access to load its pinned React, ReactDOM, and Mermaid runtime dependencies.

### CDN delivery profiles

- `global` (default): jsDelivr → unpkg for every dependency.
- `china-friendly`: npmmirror → staticfile → jsDelivr → unpkg → bootcdn for React and ReactDOM; Mermaid uses npmmirror → jsDelivr → unpkg.

Choose `china-friendly` only for an explicit China-mainland preference or audience. User language is not enough by itself; actual speed measurements are appropriate only when the build environment represents the target audience and the user agrees to network probing. Every configured source is HTTPS, version-pinned, SRI-protected, limited to 8 seconds, and used only as an ordered fallback.

Before generation, the agent asks whether keyboard operation and small-viewport usability should be included in this map’s acceptance scope. They are only promised and verified after the user confirms them; unselected capabilities do not block delivery.

### In-map controls

Each generated map has a fixed, localized guide with three labelled sections: reading guide, evidence status, and controls. Each node also exposes its evidence state directly with a small legend-matched dot in the card's upper-left corner; the border treatment provides a secondary cue. The controls section shows the primary interaction: click a card for details; click any relationship line to pin the exact hover animation (one pin at a time, hover behavior unchanged), cleared by clicking the line again, pressing `Esc`, or a blank-area click that is not a canvas drag; use `Tab` to reach cards and relationship lines, `Enter` to open or pin, and `Esc` to close the detail panel and clear the pin. Nodes also accept `Space` as the equivalent button action. The generated document language, graph region name, and dependency-failure page use the same locale. The generation-time confirmation above still determines whether keyboard and small-viewport behavior are in scope for acceptance.

For runnable original examples, see the [English MapSpec](examples/demo/expected-mapspec.json) and [Chinese MapSpec](examples/demo/expected-mapspec.zh-CN.json). They share the same source repository, graph structure, claim states, and evidence data; only reader-facing map copy and fixed UI are localized. The English demo uses `global`; the Chinese demo is explicitly for China-mainland visitors and uses `china-friendly`. Rebuild the checked-in HTML files with:

~~~bash
node skill/renderer/build-html.mjs \
  --in examples/demo/expected-mapspec.json \
  --out examples/demo/expected-output.html \
  --repo-root examples/demo/sample-repo
~~~

~~~bash
node skill/renderer/build-html.mjs \
  --in examples/demo/expected-mapspec.zh-CN.json \
  --out examples/demo/expected-output.zh-CN.html \
  --repo-root examples/demo/sample-repo \
  --cdn-profile china-friendly
~~~

## Principles

- Original implementation and examples only.
- MapSpec evidence is explicit: `verified`, `inferred`, or `unconfirmed`.
- Generated output must not include absolute local paths, credentials, or sensitive source material.
- Runtime dependencies are version-pinned and loaded with SRI-protected fallback sources.
- Keyboard navigation and small-viewport use are recommended options, not default acceptance requirements. The agent confirms whether to include them for each generated map.

## Development

Node.js 20 or newer is required.

~~~bash
npm install
npm run test:mapspec
npm run test:build
# Run only when a compatible browser is already available:
npm run test:browser
~~~

`npm test` runs all three suites in an already configured development or CI environment. For browser regression, first reuse a compatible browser already available to the Playwright configuration; on macOS this can include the installed Google Chrome binary. If no compatible browser is available, recommend `npx playwright install chromium` as a separate setup step, explain that it downloads Chromium, and wait for the user's confirmation before running it. The skill itself does not install browser tooling for a smoke check.

## Verification

- npm run test:mapspec checks the zero-dependency validator and Schema/validator containment.
- npm run test:build checks Mermaid encoding, dependency configuration, build safety, and atomic output behavior.
- npm run test:browser checks renderer regressions, including graph loading, optional keyboard and responsive capabilities, pan/zoom, CDN/SRI/timeout fallback, subgraph-title collision repair, and long htmlLabels fitting within their foreignObject bounds. It serves byte-for-byte, SRI-verified local UMD mirrors during tests; generated HTML itself still uses the pinned CDN sources.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability-reporting guidance.

## License

This project is licensed under the [MIT License](LICENSE).
