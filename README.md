# interactive-code-map

> **English** | [简体中文](README.zh-CN.md)

A cross-client skill that turns codebase evidence into a single interactive HTML code map, with explicit evidence states and a structured MapSpec that separates research from presentation.

## Online demo

Explore the original demo at [yulaiz.github.io/interactive-code-map](https://yulaiz.github.io/interactive-code-map/).

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

Create a MapSpec from inspected code, then validate its verified evidence against the selected repository root and build a relative output path:

~~~bash
node skill/renderer/build-html.mjs \
  --in path/to/mapspec.json \
  --out docs/code-map.html \
  --repo-root path/to/repository
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

The builder validates the MapSpec, embeds the application code and CSS, and writes the output atomically. It never deletes the input MapSpec. The resulting HTML uses pinned React, ReactDOM, and Mermaid CDN sources protected with SRI; it therefore needs network access when opened.

Before generation, the agent asks whether keyboard operation and small-viewport usability should be included in this map’s acceptance scope. They are only promised and verified after the user confirms them; unselected capabilities do not block delivery.

For a runnable original example, see [examples/demo/expected-mapspec.json](examples/demo/expected-mapspec.json), its small source repository, and [examples/demo/expected-output.html](examples/demo/expected-output.html). Rebuild the checked-in HTML with:

~~~bash
node skill/renderer/build-html.mjs \
  --in examples/demo/expected-mapspec.json \
  --out examples/demo/expected-output.html \
  --repo-root examples/demo/sample-repo
~~~

## Verification

- npm run test:mapspec checks the zero-dependency validator and Schema/validator containment.
- npm run test:build checks Mermaid encoding, dependency configuration, build safety, and atomic output behavior.
- npm run test:browser checks renderer regressions, including graph loading, optional keyboard and responsive capabilities, pan/zoom, CDN/SRI fallback, subgraph-title collision repair, and long htmlLabels fitting within their foreignObject bounds. It serves byte-for-byte, SRI-verified local UMD mirrors during tests; generated HTML itself still uses the pinned CDN sources.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability-reporting guidance.

## License

This project is licensed under the [MIT License](LICENSE).
