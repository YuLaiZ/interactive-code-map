---
name: interactive-code-map
description: Turn a codebase directory and a business question into a single interactive HTML code map, or turn a described non-code business process into the same evidence-backed map. Use when the user asks to explain, map, or visualize code flows, architecture, modules, data models, or a business process.
---

# interactive-code-map

Use this skill to create a concise, evidence-backed interactive code map. It produces one HTML file and never opens a browser automatically. Besides a codebase, a described non-code business process can be mapped the same way.

> Chinese reading version: [SKILL.zh-CN.md](SKILL.zh-CN.md). This `SKILL.md` is the sole executable entry; if the two files differ, this file takes precedence.

## Workflow

1. Establish the input boundary. Obtain either a repository directory plus the question to answer, or a described non-code business process plus, when available, a directory of supporting documents. Ask for missing scope; do not infer facts outside the supplied directory or the user's description.
2. Confirm the optional interaction profile before generating. Ask: “Should keyboard operation and small-viewport usability be included in this HTML map’s acceptance scope? (Recommended)” An explicit preference already given by the user counts as confirmation. If the user does not confirm, continue with the map but treat these capabilities as out of scope for this delivery; do not claim or test them as accepted behavior. Do not remove renderer capabilities merely because they are unselected. The generated controls guide shows the primary commands: click a card for details, click a relationship line to pin or unpin its hover-identical highlight, `Tab` to select, `Enter` to open or pin, and `Esc` to close and clear pins; node button semantics also accept `Space` to open.
3. Choose the CDN delivery profile. Default to `global`; use `china-friendly` only when the user explicitly prefers China-mainland delivery or identifies that audience. Treat conversation language as a weak signal, not a location fact. Only use a live speed measurement when the current environment represents the target audience and the user agrees to network probing. Select only a bundled profile; never add arbitrary CDN URLs or bypass SRI. Report the selected profile and rationale.
4. Inspect only within that boundary: code for repository inputs, or the user's supplied documents and statements for business-process inputs. Mark every MapSpec claim as verified, inferred, or unconfirmed.
5. Form a MapSpec. Use [mapspec-v1.schema.json](references/mapspec-v1.schema.json) as the authoritative structure. Every verified evidence item needs a real relative path and an inspected line range resolved against `--repo-root`: code lines for repository inputs, or document lines (for example a requirements or process markdown file) for business-process inputs. A statement that comes only from the user's verbal description, with no inspectable file, must be marked inferred or unconfirmed — never verified.
   Set the optional `meta.uiLocale` deliberately for each delivered map: use `en` for the English Demo, and use `zh-CN` by default when the user is conversing in Chinese (unless they request English output). The fixed renderer UI copy—document language, graph region name, dependency-failure page, reading guide, relationship keys, condition marker, evidence-status caption, and controls guide—must consistently follow this value; never leave a mixed-language legend. Each node must expose its localized claim state with the renderer's small upper-left, legend-matched status dot as well as the border treatment. `languageProfile` describes the code or business source and does not select UI language. Preserve the supplied language of business node, group, and edge text; only translate business content when the user explicitly asks.
6. Read [visual-quality-contract.md](references/visual-quality-contract.md) before generating or revising a multi-group map. Apply its relationship semantics, routing limits, label placement, locale, and visual-acceptance rules. Do not repair a complex graph by repeatedly layering ad-hoc routing changes; retain Mermaid's node-to-node corridor and make only the documented local adjustments.
7. Validate and generate the artifact. First verify node --version is at least 20. If it is not, report that Node.js 20 or newer is required and retain the MapSpec for the user instead of attempting generation.
8. Report the generated relative HTML path, the evidence-state limits, the confirmed interaction and CDN profiles, and any manual browser verification performed. Do not report browser behavior as verified unless it was actually checked.

## Generation

Resolve <skill-root> from the SKILL.md file you read for this invocation. Do not assume the current directory contains skill/.

~~~bash
node "<skill-root>/renderer/build-html.mjs" \
  --in <mapspec.json> \
  --out <relative-output.html> \
  --repo-root <evidence-root> \
  --cdn-profile <global|china-friendly>
~~~

build-html.mjs resolves its own renderer assets using import.meta.url, so the command may run from any current working directory.

`--repo-root` is the evidence root: the repository root for code inputs, or the directory holding the user's supporting documents for business-process inputs. Verified evidence paths and line ranges are validated against this root in both cases; inferred and unconfirmed evidence needs only a valid relative path within the root — the file itself does not have to exist.

`--canonical-url <https-url>` is optional: when the map will be published at a known address, pass it so the generated HTML carries a matching `<link rel="canonical">` and `og:url`. Every generated map also includes a `meta description` taken from `meta.summary`, plus `og:` and Twitter summary card tags.

`global` uses jsDelivr → unpkg for every dependency. `china-friendly` uses npmmirror → staticfile → jsDelivr → unpkg → bootcdn for React and ReactDOM, and npmmirror → jsDelivr → unpkg for Mermaid. All sources are version-pinned, SRI-protected, limited to 8 seconds each, and fail closed after ordered fallback.

Create a temporary MapSpec with exclusive creation semantics when the environment supports it. The build command never deletes --in; after a successful build, only delete the exact temporary MapSpec that this invocation created. Never delete a user-supplied MapSpec.

## Optional browser smoke check

Run a browser smoke check only when the user asks for browser verification or it is part of an agreed acceptance task. Never open a browser automatically.

1. Inspect and use a browser or DevTools capability already available in the current client. Do not assume a particular plugin, MCP server, browser binary, or automation package exists.
2. When a suitable existing capability is available, open the generated local HTML and observe only the facts needed for the request, such as SVG rendering, dependency loading, and one node-detail interaction. Do not report browser behavior as verified unless it was observed.
3. When no suitable capability is available, complete build-only validation and say that interactive browser behavior remains unverified.
4. Treat Playwright browser installation as an optional follow-up, not part of generation. If full Playwright regression is needed but no compatible browser is available, explain that `npx playwright install chromium` downloads a managed Chromium browser and ask the user to confirm before running it. Never run that command, install a browser, or install a browser/DevTools plugin without explicit confirmation.

When browser verification is performed and `window.interactiveCodeMap` exists after rendering, call:

~~~javascript
window.interactiveCodeMap.repairSubgraphTitles()
~~~

Use this production self-check API without adding test-only globals to the generated HTML.

Report one completed validation level and the existing capability used:

- build-only: MapSpec validation and HTML generation passed;
- browser smoke: SVG, interaction, and dependency loading were observed;
- full regression: the repository's Playwright suite passed.

## Safety and evidence rules

- Output only relative paths within the evidence root. Do not put absolute local paths, credentials, .env files, private keys, or other sensitive values in the MapSpec or HTML.
- Do not state inferred or unconfirmed claims as facts.
- Keep the graph focused. If a request requires more than about 60 nodes, ask the user to narrow the question before generating a noisy map.
- MapSpec strings are rendered as text, but all input remains untrusted: never bypass validation or manually concatenate unescaped Mermaid DSL.
