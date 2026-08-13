# Contributing to interactive-code-map

> **English** | [简体中文](CONTRIBUTING.zh-CN.md)

Thanks for helping improve interactive-code-map. Contributions may include bug
reports, documentation improvements, tests, accessibility work, renderer
changes, and new examples.

## Before you start

- Search existing issues and pull requests before opening a new one.
- Open an issue first for a large feature, a change to the MapSpec contract, or
  a substantial visual redesign, so its scope and acceptance criteria can be
  discussed.
- Keep contributions original. Do not copy code, styles, examples, prompts, or
  documentation from other projects unless the licensing and attribution are
  explicitly reviewed and compatible.
- Do not include credentials, private keys, `.env` files, absolute local paths,
  or sensitive source material in issues, pull requests, fixtures, or examples.

## Development setup

Node.js 20 or newer is required.

~~~bash
npm ci
npm run test:mapspec
npm run test:build
~~~

Run browser regression only when a compatible browser is already available:

~~~bash
npm run test:browser
~~~

Do not install Playwright browsers as an implicit part of a contribution. If a
browser download is needed, explain the download and obtain the maintainer's
agreement first.

## Change expectations

- Keep the installable `skill/` directory self-contained. `tests/` and
  `examples/` support development and verification; they are not runtime
  dependencies of an installed skill.
- For MapSpec or validation changes, update the executable Schema, shared
  validator, build rules, and focused positive or negative tests together.
- For renderer or visual behavior changes, add a focused browser regression
  before the fix, regenerate the checked-in demo when it is affected, and run
  the full relevant test suite.
- When fixed UI copy or interaction behavior changes, update the English and
  Chinese README, both Skill reading files, the visual quality contract, and
  the affected acceptance coverage in the same change.
- For CDN profile changes, update the approved source order and SRI assertions,
  and keep browser fixtures verifying every profile source against the locked
  local UMD bytes. Never add an unverified CDN source.
- Preserve the evidence model: claims must remain `verified`, `inferred`, or
  `unconfirmed`, and verified evidence must be traceable to inspected relative
  paths and line ranges.
- Keep `README.md` and `README.zh-CN.md` semantically aligned. `SKILL.md` is
  the only executable skill entry; its Chinese counterpart is a reading
  translation and must not add discovery frontmatter.

## Pull requests

- Keep each pull request focused on one coherent change.
- Explain the problem, the proposed behavior, and the verification performed.
- Include screenshots or a short recording for visible UI changes when useful.
- Update affected documentation and generated demo output in the same pull
  request.
- Use a clear, imperative English commit subject without conventional-commit
  prefixes.

## Security issues

Do not report vulnerabilities in a public issue. Follow the instructions in
[SECURITY.md](SECURITY.md).
