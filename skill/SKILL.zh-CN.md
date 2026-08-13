# interactive-code-map（中文阅读版）

> 本文件是 [`SKILL.md`](SKILL.md) 的中文阅读译本，不是客户端发现或执行入口。客户端应只加载 `SKILL.md`；若内容不一致，以 `SKILL.md` 为准。

使用此 skill 创建简洁、以证据为依据的交互式代码图谱。它生成一个 HTML 文件，且绝不自动打开浏览器。

## 工作流

1. 明确输入边界：获取仓库目录与需要回答的问题。缺少范围时询问；不得根据提供目录之外的内容推断代码事实。
2. 生成前确认可选交互配置。询问：“是否将键盘操作与小视口可用性纳入本次 HTML 图谱的验收范围？（推荐）”用户已经明确表达的偏好也视为确认。如果用户未确认，仍继续生成图谱，但把这些能力视为本次交付范围外；不得将其报告或测试为已验收行为。不得仅因未选择而移除渲染器能力。生成产物的操作说明会显示主要命令：点击卡片、`Tab` 选择、`Enter` 打开、`Esc` 关闭；节点也支持空格打开。
3. 选择 CDN 交付 profile。默认使用 `global`；只有用户明确偏好中国大陆访问，或明确目标受众位于中国大陆时，才使用 `china-friendly`。对话语言只是弱信号，不是位置事实。只有当前环境能代表目标用户、且用户同意联网探测时，才可采用实际测速。只能选择随包提供的 profile；不得自行添加 CDN URL 或绕过 SRI。报告所选 profile 及理由。
4. 仅在该边界内检查代码。将每项 MapSpec 断言标记为 verified、inferred 或 unconfirmed。
5. 形成 MapSpec。以 [`mapspec-v1.schema.json`](references/mapspec-v1.schema.json) 为权威结构。每条 verified 证据都必须具有真实的相对路径和已检查的行范围。
   对每个交付图谱明确设置可选字段 `meta.uiLocale`：英文 Demo 使用 `en`；用户以中文沟通且未要求英文产物时默认使用 `zh-CN`。阅读说明、关系图例、条件标记、证据状态与操作说明等 renderer 固定 UI 文案必须全部随此字段一致切换，禁止出现中英混杂。`languageProfile` 只描述代码或业务来源，不决定 UI 语言。节点、分组与边的业务原文保持输入语言，除非用户明确要求翻译业务内容。
6. 生成或修改多分组图谱前，阅读 [`visual-quality-contract.zh-CN.md`](references/visual-quality-contract.zh-CN.md)。按其中的关系语义、路由边界、标签放置、语言和视觉验收规则执行。不得通过不断叠加临时路由改动修补复杂图；保留 Mermaid 的节点到节点走廊，只做文档规定的局部处理。
7. 校验并生成产物。先检查 `node --version` 是否至少为 20；若不是，报告需要 Node.js 20 或更高版本，并为用户保留 MapSpec，不要尝试生成。
8. 报告生成的相对 HTML 路径、证据状态的限制、已确认的交互与 CDN profile，以及实际完成的任何浏览器人工验证。未实际检查时，不得报告浏览器行为已验证。

## 生成

从本次调用读取的 `SKILL.md` 文件解析 <skill-root>。不可假设当前目录包含 `skill/`。

~~~bash
node "<skill-root>/renderer/build-html.mjs" \
  --in <mapspec.json> \
  --out <relative-output.html> \
  --repo-root <repository-root> \
  --cdn-profile <global|china-friendly>
~~~

`build-html.mjs` 使用 `import.meta.url` 解析自身渲染器资源，因此命令可从任意当前工作目录运行。

`global` 对所有依赖使用 jsDelivr → unpkg。`china-friendly` 按已验证、参考 V2.1.4 排序的 React / ReactDOM 链路使用 staticfile → jsDelivr → unpkg → bootcdn。固定版本 Mermaid 尚无通过字节一致性验证的中国大陆镜像，因此继续使用 jsDelivr → unpkg。所有来源均固定版本、受 SRI 保护、单源超时为 8 秒，并在按序回退失败后安全失败。

当环境支持时，以独占创建语义创建临时 MapSpec。构建命令绝不删除 `--in`；成功构建后，只删除本次调用创建的确切临时 MapSpec。绝不删除用户提供的 MapSpec。

## 可选浏览器冒烟检查

仅当用户要求浏览器验证，或已将其纳入同意的验收任务时，才运行浏览器冒烟检查。绝不自动打开浏览器。

1. 检查并使用当前客户端已经具备的浏览器或 DevTools 能力。不得假设存在某个插件、MCP server、浏览器二进制文件或自动化包。
2. 有合适的现有能力时，打开生成的本地 HTML，并只观察本次请求需要的事实，例如 SVG 渲染、依赖加载和一次节点详情交互。未观察时，不得报告浏览器行为已验证。
3. 没有合适能力时，完成仅构建验证，并说明交互式浏览器行为仍未验证。
4. 将 Playwright 浏览器安装视为可选后续步骤，而不是生成的一部分。如果需要完整 Playwright 回归、但没有兼容浏览器，说明 `npx playwright install chromium` 会下载受管理的 Chromium 浏览器，并先请求用户确认。没有明确确认时，绝不运行该命令、安装浏览器，或安装浏览器 / DevTools 插件。

已执行浏览器验证、且渲染后存在 `window.interactiveCodeMap` 时，调用：

~~~javascript
window.interactiveCodeMap.repairSubgraphTitles()
~~~

使用此生产自检 API，不得向生成的 HTML 添加仅供测试的全局变量。

报告一项已完成的验证等级，以及使用的现有能力：

- 仅构建：MapSpec 校验和 HTML 生成通过；
- 浏览器冒烟：已观察 SVG、交互和依赖加载；
- 完整回归：仓库的 Playwright 套件通过。

## 安全与证据规则

- 只输出相对的仓库路径。不得在 MapSpec 或 HTML 中放入绝对本机路径、凭据、`.env` 文件、私钥或其他敏感值。
- 不得将 inferred 或 unconfirmed 断言表述为事实。
- 保持图谱聚焦。如果请求需要约 60 个以上节点，先请用户缩小问题范围，避免生成嘈杂图谱。
- MapSpec 字符串会被当作文本渲染，但所有输入仍不可信：绝不绕过校验，也不得手工拼接未转义的 Mermaid DSL。
