/**
 * MapSpec v1 零依赖共享校验模块(可复现,不依赖 ajv/node_modules)。
 *
 * 校验逻辑的唯一实现,三个入口共用(v3.2.13 P0-2):
 *  - build-html.mjs:生成前校验(因此 build-html 保持零依赖);
 *  - tests/mapspec/validate.mjs:CLI 校验入口;
 *  - tests/mapspec/run-tests.mjs:零依赖测试运行器。
 *
 * 覆盖范围:
 *  - mapspec-v1.schema.json 的核心约束(结构、必填、枚举、类型、additionalProperties:false、
 *    detail.segments、行号范围),v3.2.14 补未知字段与 lineStart/lineEnd 整数类型;
 *  - mapspec-v1.build-rules.json 的可执行部分(路径段级规则、敏感路径/内容拒绝、
 *    三态汇总一致性、--repo-root 越界/symlink 逃逸、verified 证据真实性);
 *  - 对 MapSpec 内所有将被输出到 HTML/DSL 的用户字符串做递归敏感内容扫描
 *    (启发式防线;最终 HTML 二次扫描由 build-html 复用本模块导出的同一规则集)。
 *
 * --repo-root 的 verified 证据真实性(v3.2.14 P0):
 *   state=verified 的证据必须能回溯到已检查的代码或资料文档——提供 repoRoot 时:
 *   - 根必须真实存在且是目录;
 *   - evidence.path 必须解析到真实、位于根内的**普通文件**(目录/其他类型拒绝);
 *   - lineStart/lineEnd 必须落在该文件实际行数内(按 \n 计数,兼容 CRLF);
 *   - 文件不存在/不可读/symlink 逃逸均拒绝。
 *   inferred/unconfirmed 证据不要求文件存在(它们本来就不是"已证实"),
 *   但路径仍须通过相对路径与敏感规则。
 *
 * 注意:这是零依赖的有限预检,不以"与 ajv 完全等价"自居;完整严格校验
 * (ajv-cli + --strict-required,锁定版)由开发/CI 另行执行,见
 * mapspec-v1.build-rules.json 的 strictValidationCommand。实施阶段以 lockfile
 * 固定 ajv 后,对全部 fixture 做"Schema 校验 vs 本模块"差分测试兜底。
 */
import { realpathSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const CLAIM_STATES = ['verified', 'inferred', 'unconfirmed'];
export const MAX_NODES = 100; // schema hard cap
// 代码摘录必须可读且可审查；单段的总字符数属于跨数组项约束，由运行时校验。
export const MAX_CODE_SEGMENT_ROWS = 80;
export const MAX_CODE_CELL_CHARS = 500;
export const MAX_CODE_SEGMENT_CHARS = 12000;

// 敏感路径/文件名(与 build-rules.sensitiveDataRejection 同步,含 .envrc, v3.2.14):命中即拒绝
const SENSITIVE_PATH_PATTERNS = [
  /(^|\/)\.[a-zA-Z0-9_-]*env([^a-zA-Z0-9_-]|$)/, // .env, .env.local, .env.production, .envrc
  /(^|\/)\.envrc\b/,
  /(^|\/)id_rsa($|\.)/, // 私钥
  /(^|\/)id_ed25519($|\.)/,
  /(^|\/)\.ssh($|\/)/,
  /(^|\/)credentials($|\/)/,
  /(^|\/)\.aws($|\/)/,
  /(^|\/)secrets?($|\/)/,
  /(^|\/)\.pem$/,
  /(^|\/)\.p12$/,
  /(^|\/)\.key$/,
];
// 敏感内容模式(详情/摘要/标题/符号等任何输出字段中出现即拒绝;
// v3.2.14 扩充 sk-proj- 形态)。这是**启发式预警**,不表述为绝对防泄漏。
const SENSITIVE_CONTENT_PATTERNS = [
  /(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)/, // 私钥内容
  /(AKIA[0-9A-Z]{16})/, // AWS access key
  /(gh[pousr]_[A-Za-z0-9]{36,})/, // GitHub token
  /(sk-[A-Za-z0-9]{20,})/, // OpenAI key(字母数字形态)
  /(sk-proj-[A-Za-z0-9_-]{20,})/, // OpenAI project key(含连字符/下划线, v3.2.14)
];

/**
 * evidence.path 路径合法性:相对路径、无盘符/UNC、无反斜杠、无 '..'/'.' 段、无 NUL。
 * 对应 schema pattern + build-rules.pathValidation 的段级规则。
 */
export function pathOk(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (p.includes('\u0000')) return false; // NUL 会让 path.resolve/realpath 抛异常,直接拒绝
  if (!/^(?!\/)(?!\\)(?![A-Za-z]:[\\/]).+$/.test(p)) return false;
  if (p.includes('\\')) return false;
  return !p.split('/').some((seg) => seg === '..' || seg === '.');
}

export function isSensitivePath(p) {
  return typeof p === 'string' && SENSITIVE_PATH_PATTERNS.some((re) => re.test(p));
}

export function isSensitiveContent(s) {
  return typeof s === 'string' && SENSITIVE_CONTENT_PATTERNS.some((re) => re.test(s));
}

/**
 * 输出字段不得携带用户本机绝对路径。evidence.path 另有更严格的相对路径规则；
 * 这里覆盖最终会展示在 HTML 中的常见 Unix/macOS 用户目录/系统目录、Windows 盘符和 UNC。
 * URL（例如 https://example.test/a）不匹配。
 */
export function containsAbsoluteFilesystemPath(s) {
  if (typeof s !== 'string') return false;
  return /(?:^|[\s"'`([{:;,=<])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|root|private|Volumes|var|etc|tmp|opt|Library|usr|bin|sbin|dev|proc|sys|run|boot|mnt|media|srv|System|Applications|Network)(?:\/|$))/.test(s);
}

/**
 * --allow-test-fixture 的目录隔离(v3.2.14 P1-3 修订,替代路径片段正则):
 * 以**真实 fixture 根目录**做 containment 判定——被校验文件 realpath 后必须
 * 落在任一 fixtureRoot 的 realpath 内,且相对路径含 fixtures 段。
 * 纯字符串匹配可被 /tmp/tests/anything/fixtures/x.json 之类伪装绕过,已废弃。
 */
export function isFixturePath(filePath, fixtureRoots) {
  if (typeof filePath !== 'string' || filePath.length === 0) return false;
  if (!Array.isArray(fixtureRoots) || fixtureRoots.length === 0) return false;
  let fileReal;
  try {
    fileReal = realpathSync(filePath);
  } catch {
    return false; // 文件不存在/不可读,不构成 fixture
  }
  for (const root of fixtureRoots) {
    let rootReal;
    try {
      rootReal = realpathSync(root);
    } catch {
      continue;
    }
    if (fileReal !== rootReal && !fileReal.startsWith(rootReal + path.sep)) continue;
    const rel = path.relative(rootReal, fileReal).split(path.sep).join('/');
    if (/(^|\/)fixtures\//.test(rel)) return true; // 相对根下含 fixtures 目录段
  }
  return false;
}

/**
 * 递归收集对象/数组内所有字符串,返回 [路径, 值] 列表,用于启发式敏感扫描。
 * 路径形如:meta.title、nodes[0].title、nodes[0].detail.segments[0].rows[0][1]。
 */
function walkStrings(value, prefix, out) {
  if (typeof value === 'string') {
    out.push([prefix, value]);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, `${prefix}[${i}]`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      walkStrings(value[k], prefix ? `${prefix}.${k}` : k, out);
    }
  }
}

// Schema additionalProperties:false 的允许键表(v3.2.14 P1-2)
const ALLOWED_KEYS = {
  root: ['schemaVersion', 'meta', 'nodes', 'edges'],
  meta: ['title', 'question', 'scope', 'languageProfile', 'uiLocale', 'summary', 'layoutDirection', 'layoutBands'],
  layoutBand: ['title', 'direction', 'subgraphs'],
  node: ['id', 'title', 'category', 'subgraph', 'claimState', 'evidence', 'detail'],
  edge: ['from', 'to', 'label', 'labelKind', 'claimState', 'evidence'],
  evidence: ['path', 'lineStart', 'lineEnd', 'symbol', 'note', 'state'],
  detail: ['summary', 'segments'],
  segment: ['kind', 'title', 'subtitle', 'headers', 'rows'],
};

function checkExtraKeys(obj, kind, tag, errors) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_KEYS[kind].includes(k)) errors.push(`${tag} 不允许额外字段: ${k}`);
  }
}

function validateLayoutBands(meta, nodes, errors) {
  if (meta.layoutBands === undefined) return;
  if (!Array.isArray(meta.layoutBands) || meta.layoutBands.length === 0) {
    errors.push('meta.layoutBands 必须为非空数组');
    return;
  }
  if (meta.layoutDirection !== undefined && meta.layoutDirection !== 'TD') {
    errors.push('meta.layoutBands 只能与 layoutDirection=TD（或省略）组合');
  }

  const knownSubgraphs = new Set((Array.isArray(nodes) ? nodes : [])
    .map((node) => node && typeof node.subgraph === 'string' ? node.subgraph : '')
    .filter(Boolean));
  if (knownSubgraphs.size === 0) {
    errors.push('meta.layoutBands 需要至少一个节点分组');
  }
  const usedSubgraphs = new Set();
  const bandTitles = new Set();
  meta.layoutBands.forEach((band, index) => {
    const tag = `meta.layoutBands[${index}]`;
    if (band === null || typeof band !== 'object' || Array.isArray(band)) {
      errors.push(`${tag} 必须为对象`);
      return;
    }
    checkExtraKeys(band, 'layoutBand', tag, errors);
    if (typeof band.title !== 'string' || band.title.length === 0) {
      errors.push(`${tag}.title 缺失或为空`);
    } else {
      if (bandTitles.has(band.title)) errors.push(`${tag}.title '${band.title}' 重复`);
      if (knownSubgraphs.has(band.title)) errors.push(`${tag}.title 与节点分组重名: ${band.title}`);
      bandTitles.add(band.title);
    }
    if (band.direction !== 'LR' && band.direction !== 'RL') {
      errors.push(`${tag}.direction 必须为 LR 或 RL`);
    }
    if (!Array.isArray(band.subgraphs) || band.subgraphs.length === 0) {
      errors.push(`${tag}.subgraphs 必须为非空数组`);
      return;
    }
    const inBand = new Set();
    band.subgraphs.forEach((subgraph, subgraphIndex) => {
      const subgraphTag = `${tag}.subgraphs[${subgraphIndex}]`;
      if (typeof subgraph !== 'string' || subgraph.length === 0) {
        errors.push(`${subgraphTag} 必须为非空字符串`);
        return;
      }
      if (inBand.has(subgraph)) errors.push(`${subgraphTag} '${subgraph}' 在同一阶段带重复`);
      inBand.add(subgraph);
      if (!knownSubgraphs.has(subgraph)) errors.push(`${subgraphTag} '${subgraph}' 不属于任何节点分组`);
      else if (usedSubgraphs.has(subgraph)) errors.push(`${subgraphTag} '${subgraph}' 已被前一阶段带使用`);
      else usedSubgraphs.add(subgraph);
    });
  });
  for (const subgraph of knownSubgraphs) {
    if (!usedSubgraphs.has(subgraph)) errors.push(`meta.layoutBands 未覆盖节点分组: ${subgraph}`);
  }
}

// build-rules 三态汇总:verified=全 verified+≥1 位置;unconfirmed=无 verified;inferred=混合或强推断
function checkClaimStateConsistency(claimState, evidence, tag, errors) {
  const evStates = (evidence || []).map((e) => e && e.state);
  if (claimState === 'verified') {
    if (!evStates.length || evStates.some((s) => s !== 'verified')) {
      errors.push(`${tag} claimState=verified 但 evidence 非全 verified`);
    }
  } else if (claimState === 'unconfirmed') {
    if (evStates.some((s) => s === 'verified')) {
      errors.push(`${tag} claimState=unconfirmed 但存在 verified 证据(应无 verified)`);
    }
  } else if (claimState === 'inferred') {
    if (!evStates.length) errors.push(`${tag} claimState=inferred 但无 evidence`);
  }
}

/**
 * verified 证据真实性(v3.2.14 P0):文件必须真实存在、是位于根内的普通文件,
 * 行号落在实际行数内。按 \n 计行(CRLF 兼容)。返回错误数组(空 = 通过)。
 */
function verifiedFileErrors(rootReal, evPath, lineStart, lineEnd) {
  let real;
  try {
    real = realpathSync(path.resolve(rootReal, evPath));
  } catch {
    return [`文件不存在或不可读: ${evPath}`];
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    return [`越出 --repo-root: ${evPath}`];
  }
  let st;
  try {
    st = statSync(real);
  } catch {
    return [`文件不可读: ${evPath}`];
  }
  if (!st.isFile()) return [`不是普通文件(目录/其他类型): ${evPath}`];
  let lineCount;
  try {
    lineCount = countLines(readFileSync(real, 'utf8'));
  } catch {
    return [`文件不可读: ${evPath}`];
  }
  if (Number.isInteger(lineEnd) && lineEnd > lineCount) {
    return [`lineEnd ${lineEnd} 超出文件实际行数 ${lineCount}: ${evPath}`];
  }
  return [];
}

/**
 * 行数统计:按 \n 计行(CRLF 兼容);文件内容尾部换行不产生额外空行,
 * 空文件计 1 行。例如 "a\nb\n" 计 2 行,"a\r\nb\r\n" 计 2 行,
 * 纯换行符文件 "\n" 计 1 行、"\n\n" 计 2 行(split 后移除尾部空串,
 * 余下段数即行数)。verified 证据的 lineEnd 须落在该行数内。
 */
function countLines(content) {
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

/**
 * 校验单条 evidence(节点/边共用):
 * 结构 + path 合法性 + 敏感路径 + 行号下限与范围 + 敏感内容 + --repo-root 越界 +
 * verified 真实性(文件存在/普通文件/行数)。
 */
function checkEvidence(ev, et, errors, rootReal) {
  // 非 null 对象防御(v3.2.14 P1-1):evidence 元素可能是 null/原始值
  if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) {
    errors.push(`${et} 必须为对象`);
    return;
  }
  checkExtraKeys(ev, 'evidence', et, errors);
  if (typeof ev.path !== 'string' || ev.path.length === 0) {
    errors.push(`${et}.path 缺失或为空`);
  } else {
    if (!pathOk(ev.path)) errors.push(`${et}.path 非法: ${ev.path}`);
    if (isSensitivePath(ev.path)) errors.push(`${et}.path 为敏感路径: ${ev.path}`);
  }
  if (!CLAIM_STATES.includes(ev.state)) errors.push(`${et}.state 非法`);
  if (ev.state === 'verified' && !(Number.isInteger(ev.lineStart) && Number.isInteger(ev.lineEnd))) {
    errors.push(`${et} verified 必须含 lineStart/lineEnd`);
  }
  // 行号存在时必须为整数(Schema type:integer,不限 verified,v3.2.14 P1-2)
  if (ev.lineStart !== undefined && !Number.isInteger(ev.lineStart)) {
    errors.push(`${et}.lineStart 必须为整数`);
  }
  if (ev.lineEnd !== undefined && !Number.isInteger(ev.lineEnd)) {
    errors.push(`${et}.lineEnd 必须为整数`);
  }
  if (Number.isInteger(ev.lineStart) && ev.lineStart < 1) errors.push(`${et} lineStart 必须 ≥1`);
  if (Number.isInteger(ev.lineEnd) && ev.lineEnd < 1) errors.push(`${et} lineEnd 必须 ≥1`);
  if (Number.isInteger(ev.lineStart) && Number.isInteger(ev.lineEnd) && ev.lineEnd < ev.lineStart) {
    errors.push(`${et} lineEnd<lineStart`);
  }
  if (ev.symbol !== undefined && typeof ev.symbol !== 'string') errors.push(`${et}.symbol 必须为字符串`);
  if (ev.note !== undefined && typeof ev.note !== 'string') errors.push(`${et}.note 必须为字符串`);
  // --repo-root:越界(realpath 防 symlink 逃逸)+ verified 真实性
  if (rootReal && typeof ev.path === 'string' && pathOk(ev.path)) {
    let within;
    try {
      within = isWithinRoot(rootReal, ev.path);
    } catch {
      within = false;
    }
    if (!within) errors.push(`${et}.path 越出 --repo-root 或无法解析: ${ev.path}`);
    else if (ev.state === 'verified') {
      errors.push(...verifiedFileErrors(rootReal, ev.path, ev.lineStart, ev.lineEnd));
    }
  }
}

/**
 * --repo-root 越界判定:把相对路径按证据根目录解析后做 realpath,
 * 防 symlink 逃逸——对"最深存在的祖先"realpath,剩余不存在的段拼回。
 * 根内 symlink 指向根外即解析出根外真实路径,拒绝。
 */
function isWithinRoot(rootReal, relPath) {
  const abs = path.resolve(rootReal, relPath);
  let cur = abs;
  const tail = [];
  for (;;) {
    try {
      const r = realpathSync(cur);
      const target = path.join(r, ...tail);
      return target === rootReal || target.startsWith(rootReal + path.sep);
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      const parent = path.dirname(cur);
      if (parent === cur) return true; // 无法判定(到文件系统根仍不存在):按字面路径处理
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * 校验 MapSpec,返回错误消息数组(空数组 = 通过)。
 *
 * @param {object} spec 解析后的 MapSpec(可为畸形结构,null 等)
 * @param {object} opts
 *   allowTestFixture: 是否放行测试专用标记(languageProfile==='fixture');
 *   fixtureFilePath:  被校验文件路径,allowTestFixture 时须落在 fixtureRoots 内;
 *   fixtureRoots:     真实 fixture 根目录列表(如 <仓库根>/tests),realpath containment 判定;
 *   repoRoot:         --repo-root 证据根目录(可选,代码仓库或业务资料目录),校验 evidence.path 越界 + verified 真实性。
 */
export function validateMapSpec(spec, { allowTestFixture = false, fixtureFilePath = null, fixtureRoots = null, repoRoot = null } = {}) {
  const errors = [];

  // 畸形输入防御:根必须是对象,否则直接拒绝,不抛 TypeError
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    errors.push('根必须为非 null 对象');
    return errors;
  }
  checkExtraKeys(spec, 'root', '根', errors);

  // schemaVersion
  if (spec.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');

  // --repo-root 预处理:根必须真实存在且是目录(v3.2.14 P0)
  let rootReal = null;
  if (repoRoot !== null && repoRoot !== undefined) {
    try {
      const st = statSync(repoRoot);
      if (!st.isDirectory()) {
        errors.push(`--repo-root 必须是目录: ${repoRoot}`);
      } else {
        rootReal = realpathSync(repoRoot);
      }
    } catch {
      errors.push(`--repo-root 不存在或不可读: ${repoRoot}`);
    }
  }

  // 测试专用标记(languageProfile==='fixture' 是测试标记,生产 build-html 必须拒绝;
  // --allow-test-fixture 仅放行 fixtureRoots 内的文件,v3.2.14 P1-3 realpath containment)
  if (spec.meta && typeof spec.meta === 'object' && spec.meta.languageProfile === 'fixture') {
    if (!allowTestFixture) {
      errors.push('languageProfile=\'fixture\' 是测试专用标记,生产 build-html 必须拒绝(防仿写绕过)');
    } else if (!isFixturePath(fixtureFilePath, fixtureRoots)) {
      errors.push('--allow-test-fixture 仅允许真实 fixtures 目录(tests/<任意子目录>/fixtures/)下的文件携带测试标记');
    }
  }

  // meta
  const meta = spec.meta || {};
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    errors.push('meta 必须为对象');
  } else {
    checkExtraKeys(meta, 'meta', 'meta', errors);
    for (const k of ['title', 'question', 'scope', 'languageProfile', 'summary']) {
      if (typeof meta[k] !== 'string' || meta[k].length === 0) errors.push(`meta.${k} 缺失或为空`);
    }
    if (meta.layoutDirection !== undefined && meta.layoutDirection !== 'TD' && meta.layoutDirection !== 'LR') {
      errors.push('meta.layoutDirection 必须为 TD 或 LR');
    }
    if (meta.uiLocale !== undefined && meta.uiLocale !== 'en' && meta.uiLocale !== 'zh-CN') {
      errors.push('meta.uiLocale 必须为 en 或 zh-CN');
    }
    validateLayoutBands(meta, spec.nodes, errors);
  }

  // nodes
  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) errors.push('nodes 必须为非空数组');
  if (Array.isArray(spec.nodes) && spec.nodes.length > MAX_NODES) {
    errors.push(`nodes 数量 ${spec.nodes.length} 超过硬上限 ${MAX_NODES}`);
  }
  const ids = new Set();
  if (Array.isArray(spec.nodes)) {
    spec.nodes.forEach((n, i) => {
      const tag = `nodes[${i}]`;
      // 非 null 对象防御(v3.2.14 P1-1):nodes 元素可能是 null/原始值
      if (n === null || typeof n !== 'object' || Array.isArray(n)) {
        errors.push(`${tag} 必须为对象`);
        return;
      }
      checkExtraKeys(n, 'node', tag, errors);
      if (typeof n.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(n.id)) errors.push(`${tag}.id 非法`);
      else if (ids.has(n.id)) errors.push(`${tag}.id '${n.id}' 重复`);
      else ids.add(n.id);
      if (typeof n.title !== 'string' || !n.title.length) errors.push(`${tag}.title 缺失`);
      if (n.category !== undefined && typeof n.category !== 'string') errors.push(`${tag}.category 必须为字符串`);
      if (n.subgraph !== undefined && typeof n.subgraph !== 'string') errors.push(`${tag}.subgraph 必须为字符串`);
      if (!CLAIM_STATES.includes(n.claimState)) errors.push(`${tag}.claimState 非法: ${n.claimState}`);
      // evidence
      if (!Array.isArray(n.evidence) || n.evidence.length === 0) errors.push(`${tag} 缺 evidence`);
      if (Array.isArray(n.evidence)) {
        n.evidence.forEach((e, j) => checkEvidence(e, `${tag}.evidence[${j}]`, errors, rootReal));
      }
      // 三态汇总一致性
      checkClaimStateConsistency(n.claimState, n.evidence, tag, errors);
      // detail(必须含 summary + segments;segments 可为空数组,Schema required)
      if (!n.detail || typeof n.detail !== 'object' || Array.isArray(n.detail)) {
        errors.push(`${tag}.detail 必须为对象`);
      } else {
        checkExtraKeys(n.detail, 'detail', `${tag}.detail`, errors);
        if (typeof n.detail.summary !== 'string' || n.detail.summary.length === 0) errors.push(`${tag}.detail.summary 缺失或为空`);
        if (!Array.isArray(n.detail.segments)) errors.push(`${tag}.detail.segments 缺失(可为空数组)`);
        else {
          n.detail.segments.forEach((seg, si) => {
            const st = `${tag}.detail.segments[${si}]`;
            // 非 null 对象防御(v3.2.14 P1-1)
            if (seg === null || typeof seg !== 'object' || Array.isArray(seg)) {
              errors.push(`${st} 必须为对象`);
              return;
            }
            checkExtraKeys(seg, 'segment', st, errors);
            if (typeof seg.kind !== 'string' || !['value', 'schema', 'code'].includes(seg.kind)) {
              errors.push(`${st}.kind 非法`);
            }
            if (typeof seg.title !== 'string' || !seg.title.length) errors.push(`${st}.title 缺失`);
            if (seg.subtitle !== undefined && typeof seg.subtitle !== 'string') errors.push(`${st}.subtitle 必须为字符串`);
            if (!Array.isArray(seg.headers) || !seg.headers.length) errors.push(`${st}.headers 缺失`);
            else if (seg.headers.some((h) => typeof h !== 'string')) errors.push(`${st}.headers 元素必须为字符串`);
            if (!Array.isArray(seg.rows)) errors.push(`${st}.rows 缺失`);
            else {
              let codeChars = 0;
              if (seg.kind === 'code' && seg.rows.length > MAX_CODE_SEGMENT_ROWS) {
                errors.push(`${st}.rows 超过代码摘录行数上限 ${MAX_CODE_SEGMENT_ROWS}`);
              }
              seg.rows.forEach((r, ri) => {
                if (!Array.isArray(r) || r.some((c) => typeof c !== 'string')) {
                  errors.push(`${st}.rows[${ri}] 必须为字符串数组`);
                  return;
                }
                if (seg.kind === 'code') {
                  r.forEach((cell, ci) => {
                    codeChars += cell.length;
                    if (cell.length > MAX_CODE_CELL_CHARS) {
                      errors.push(`${st}.rows[${ri}][${ci}] 超过代码单元格字符上限 ${MAX_CODE_CELL_CHARS}`);
                    }
                  });
                }
              });
              if (seg.kind === 'code' && codeChars > MAX_CODE_SEGMENT_CHARS) {
                errors.push(`${st}.rows 代码摘录字符总数超过上限 ${MAX_CODE_SEGMENT_CHARS}`);
              }
            }
          });
        }
      }
    });
  }

  // edges(引用完整性 + 结构 + 行号;非数组直接报错,不抛 TypeError)
  if (spec.edges !== undefined && !Array.isArray(spec.edges)) {
    errors.push('edges 必须为数组');
  }
  if (Array.isArray(spec.edges)) {
    spec.edges.forEach((e, i) => {
      const et = `edges[${i}]`;
      // 非 null 对象防御(v3.2.14 P1-1)
      if (e === null || typeof e !== 'object' || Array.isArray(e)) {
        errors.push(`${et} 必须为对象`);
        return;
      }
      checkExtraKeys(e, 'edge', et, errors);
      if (!ids.has(e.from)) errors.push(`${et}.from '${e.from}' 指向不存在节点`);
      if (!ids.has(e.to)) errors.push(`${et}.to '${e.to}' 指向不存在节点`);
      if (e.label !== undefined && typeof e.label !== 'string') errors.push(`${et}.label 必须为字符串`);
      if (e.labelKind !== undefined && e.labelKind !== 'action' && e.labelKind !== 'condition') {
        errors.push(`${et}.labelKind 必须为 action 或 condition`);
      }
      if (!CLAIM_STATES.includes(e.claimState)) errors.push(`${et}.claimState 非法`);
      if (!Array.isArray(e.evidence) || e.evidence.length === 0) errors.push(`${et} 缺 evidence`);
      if (Array.isArray(e.evidence)) {
        e.evidence.forEach((ev, j) => checkEvidence(ev, `${et}.evidence[${j}]`, errors, rootReal));
      }
      checkClaimStateConsistency(e.claimState, e.evidence, et, errors);
    });
  }

  // 启发式敏感内容扫描:对 MapSpec 内所有字符串递归扫描(meta 全字段、节点
  // title/category/subgraph、evidence.symbol/note、detail 全文、边 label 等所有
  // 会被输出到 HTML/DSL 的字段)。这是启发式预警,不表述为绝对防泄漏;最终
  // HTML 二次扫描由 build-html 复用本模块导出的同一规则集。
  const strings = [];
  walkStrings(spec, '', strings);
  for (const [p, s] of strings) {
    if (isSensitiveContent(s)) errors.push(`${p} 含敏感内容`);
    // evidence.path 已由 pathOk 给出更精确的错误，避免同一问题重复报错。
    if (!p.endsWith('.path') && containsAbsoluteFilesystemPath(s)) {
      errors.push(`${p} 含绝对路径或个人文件系统路径`);
    }
  }

  return errors;
}
