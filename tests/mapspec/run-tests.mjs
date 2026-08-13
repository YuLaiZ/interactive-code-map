#!/usr/bin/env node
/**
 * MapSpec 校验零依赖测试运行器。
 *
 * 断言范围:
 *  1. tests/mapspec/fixtures/invalid/ 下每个反例被拒绝,且错误集合与登记表
 *     **完全相等**(v3.2.14 P1-5):多报、漏报、未登记的新反例都会失败——
 *     不再只是"包含预期片段";
 *  2. tests/browser/fixtures/ 合法 fixture:默认拒绝(测试标记),带
 *     --allow-test-fixture 且文件 realpath 落在真实 fixtures 目录内才通过
 *     (v3.2.14 P1-3 containment,路径片段伪装拒绝);
 *  3. 执行 mapspec-v1.build-rules.json 的可执行向量:
 *     sensitiveDataRejection.acceptanceTestVectors(11 条)与
 *     pathValidation、displayPathPrivacy 的向量；
 *  4. 畸形输入不抛异常且被拒绝(根 null、nodes/edges 非数组、数组内 null 元素、
 *     NUL 路径);
 *  5. Schema 对齐：未知字段、证据 path 必填、行号类型、空 meta.summary、
 *     代码摘录的行数/单元格/总字符上限；
 *  6. --repo-root verified 真实性(v3.2.14 P0;v3.2.15 补纯换行符计行):
 *     根必须是目录、verified 文件必须真实存在且为普通文件、行号在文件实际行数内
 *     (CRLF 兼容、纯换行符文件 \n 计 1 行、\n\n 计 2 行)、symlink 逃逸拒绝、
 *     inferred 不要求文件存在。
 *
 * 零依赖:只用 Node 内置模块。退出码 0 = 全部通过;1 = 任一断言失败。
 * Mermaid DSL 注入向量(7 条)依赖 build-html 编码器,待 build 单测执行,
 * 本运行器不执行。
 */
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateMapSpec,
  isSensitivePath,
  isSensitiveContent,
  containsAbsoluteFilesystemPath,
  pathOk,
  MAX_CODE_SEGMENT_ROWS,
  MAX_CODE_CELL_CHARS,
  MAX_CODE_SEGMENT_CHARS,
} from '../../skill/renderer/validate-map-spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INVALID_DIR = path.join(HERE, 'fixtures', 'invalid');
const BROWSER_FIXTURE = path.join(HERE, '..', 'browser', 'fixtures', 'subgraph-title-occlusion.mapspec.json');
const REPO_ROOT = path.resolve(HERE, '..', '..');
const FIXTURE_ROOTS = [path.join(REPO_ROOT, 'tests')]; // 真实 fixture 根,realpath containment
const BUILD_RULES = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', 'skill', 'references', 'mapspec-v1.build-rules.json'), 'utf8'),
);

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}

// 合法 MapSpec 骨架(各用例按需改字段)
function baseSpec() {
  return {
    schemaVersion: 1,
    meta: { title: 't', question: 'q', scope: 's', languageProfile: 'l', summary: 'a' },
    nodes: [
      {
        id: 'n1',
        title: 't',
        claimState: 'verified',
        evidence: [{ path: 'a.js', lineStart: 1, lineEnd: 2, state: 'verified' }],
        detail: { summary: 's', segments: [] },
      },
    ],
  };
}

// ---------- 1. invalid 反例:拒绝 + 错误集合完全相等 ----------
// 每个反例的**完整**预期错误列表。断言 errors 与预期集合相等:
// 多报(其他规则混入)或漏报都失败;未登记的新反例直接失败。
const EXPECTED = {
  'line-start-zero.json': ['nodes[0].evidence[0] lineStart 必须 ≥1'],
  'missing-meta-summary.json': ['meta.summary 缺失或为空'],
  'sensitive-content-key.json': ['meta.summary 含敏感内容'],
  'sensitive-path-env.json': ['nodes[0].evidence[0].path 为敏感路径: .env'],
  'unconfirmed-with-verified-evidence.json': ['nodes[0] claimState=unconfirmed 但存在 verified 证据(应无 verified)'],
  'missing-detail-segments.json': ['nodes[0].detail.segments 缺失(可为空数组)'],
  'edge-line-start-zero.json': ['edges[0].evidence[0] lineStart 必须 ≥1'],
  'edge-line-end-before-start.json': ['edges[0].evidence[0] lineEnd<lineStart'],
  'edges-not-array.json': ['edges 必须为数组'],
  'root-null.json': ['根必须为非 null 对象'],
  'unknown-root-field.json': ['根 不允许额外字段: extra'],
  'unknown-node-field.json': ['nodes[0] 不允许额外字段: bogus'],
  'line-non-integer.json': ['nodes[0].evidence[0].lineStart 必须为整数'],
  'missing-evidence-path.json': ['nodes[0].evidence[0].path 缺失或为空'],
  'absolute-display-path.json': ['meta.scope 含绝对路径或个人文件系统路径'],
};

console.log('== 1. invalid fixtures(拒绝 + 错误集合完全相等)==');
for (const name of readdirSync(INVALID_DIR).filter((f) => f.endsWith('.json')).sort()) {
  const file = path.join(INVALID_DIR, name);
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const errors = validateMapSpec(spec);
  const expected = EXPECTED[name];
  if (!expected) {
    assert(false, `${name} 未在 EXPECTED 登记,必须补登记或删除`);
    continue;
  }
  const missing = expected.filter((e) => !errors.includes(e));
  const extra = errors.filter((e) => !expected.includes(e));
  const ok = errors.length === expected.length && missing.length === 0;
  if (!ok) {
    if (missing.length) console.error(`    漏报: ${missing.join(' | ')}`);
    if (extra.length) console.error(`    多报: ${extra.join(' | ')}`);
  }
  assert(ok, `${name} 错误集合与预期完全相等`);
}

// ---------- 2. browser fixture:标记默认拒绝,containment 后通过 ----------
console.log('\n== 2. browser fixture 测试标记隔离(P1-3)==');
{
  const spec = JSON.parse(readFileSync(BROWSER_FIXTURE, 'utf8'));
  const defErr = validateMapSpec(spec);
  assert(defErr.some((e) => e.includes('测试专用标记')), '默认拒绝 languageProfile=fixture');
  const okErr = validateMapSpec(spec, {
    allowTestFixture: true,
    fixtureFilePath: BROWSER_FIXTURE,
    fixtureRoots: FIXTURE_ROOTS,
  });
  assert(okErr.length === 0, `--allow-test-fixture + 真实 fixtures 目录内通过(错误数=${okErr.length})`);
  const fakeErr = validateMapSpec(spec, {
    allowTestFixture: true,
    fixtureFilePath: '/tmp/tests/anything/fixtures/x.json', // 路径片段伪装
    fixtureRoots: FIXTURE_ROOTS,
  });
  assert(fakeErr.some((e) => e.includes('仅允许真实 fixtures')), '路径片段伪装(/tmp/tests/...)被拒');
  const noRootErr = validateMapSpec(spec, { allowTestFixture: true, fixtureFilePath: BROWSER_FIXTURE });
  assert(noRootErr.some((e) => e.includes('仅允许真实 fixtures')), '未提供 fixtureRoots 时不放行');
}

// ---------- 3. build-rules 可执行向量 ----------
console.log('\n== 3. build-rules 向量执行(P1-4)==');
{
  const { sensitiveDataRejection } = BUILD_RULES;
  const vectors = sensitiveDataRejection.acceptanceTestVectors;
  let ok = true;
  for (const v of vectors) {
    const got = v.type === 'path' ? isSensitivePath(v.input) : isSensitiveContent(v.input);
    if (got !== v.mustReject) {
      ok = false;
      console.error(`    敏感向量不符: ${v.type} '${v.input}' 期望 mustReject=${v.mustReject},实际=${got}`);
    }
  }
  assert(ok, `敏感数据向量 ${vectors.length} 条全部符合(含 .envrc / sk-proj-)`);
}
{
  const vectors = BUILD_RULES.displayPathPrivacy.acceptanceTestVectors;
  let ok = true;
  for (const [input, expected] of vectors) {
    const got = containsAbsoluteFilesystemPath(input);
    if (got !== expected) {
      ok = false;
      console.error(`    显示路径隐私向量不符: '${input}' 期望 ${expected},实际 ${got}`);
    }
  }
  assert(ok, `显示路径隐私向量 ${vectors.length} 条全部符合`);
}
{
  const vectors = BUILD_RULES.pathValidation.acceptanceTestVectors;
  let ok = true;
  for (const [input, expected] of vectors) {
    const got = pathOk(input);
    if (got !== expected) {
      ok = false;
      console.error(`    路径向量不符: '${input}' 期望 ${expected},实际 ${got}`);
    }
  }
  assert(ok, `路径段级向量 ${vectors.length} 条全部符合`);
}

// ---------- 4. 畸形输入防御 ----------
console.log('\n== 4. 畸形输入防御(P1-1)==');
{
  const nullErr = validateMapSpec(null);
  assert(nullErr.length > 0, '根为 null → 拒绝且不抛 TypeError');
  const edgesErr = validateMapSpec({ schemaVersion: 1, meta: {}, nodes: [{ id: 'n1', title: 't' }], edges: 'x' });
  assert(edgesErr.some((e) => e.includes('edges 必须为数组')), 'edges 为字符串 → 拒绝');
  const nodesErr = validateMapSpec({ schemaVersion: 1, meta: {}, nodes: 'x' });
  assert(nodesErr.some((e) => e.includes('nodes 必须为非空数组')), 'nodes 为字符串 → 拒绝');
  const nullNodeErr = validateMapSpec({ schemaVersion: 1, meta: {}, nodes: [null] });
  assert(nullNodeErr.some((e) => e.includes('nodes[0] 必须为对象')), 'nodes:[null] → 拒绝且不抛 TypeError');
  const nullEvErr = validateMapSpec(baseSpecWithEvidence([null]));
  assert(nullEvErr.some((e) => e.includes('evidence[0] 必须为对象')), 'evidence:[null] → 拒绝且不抛 TypeError');
  const nullSegErr = validateMapSpec(baseSpecWithSegments([null]));
  assert(nullSegErr.some((e) => e.includes('segments[0] 必须为对象')), 'segments:[null] → 拒绝且不抛 TypeError');
  const nulPathErr = validateMapSpec(baseSpecWithEvidence([{ path: 'a\u0000b.js', lineStart: 1, lineEnd: 2, state: 'verified' }]));
  assert(nulPathErr.some((e) => e.includes('path 非法')), 'NUL 路径 → 拒绝且不抛异常');
  // 未提供 repoRoot 时 NUL 同样安全
  const nulRootErr = validateMapSpec(
    baseSpecWithEvidence([{ path: 'a\u0000b.js', lineStart: 1, lineEnd: 2, state: 'verified' }]),
    { repoRoot: REPO_ROOT },
  );
  assert(nulRootErr.some((e) => e.includes('path 非法')), 'NUL 路径 + --repo-root → 拒绝且不抛异常');
}
function baseSpecWithEvidence(evidence) {
  const s = baseSpec();
  s.nodes[0].evidence = evidence;
  return s;
}
function baseSpecWithSegments(segments) {
  const s = baseSpec();
  s.nodes[0].detail.segments = segments;
  return s;
}

// ---------- 5. Schema 对齐(additionalProperties / 类型 / 必填 / 代码摘录上限) ----------
console.log('\n== 5. Schema 对齐==');
{
  const unknownRoot = { ...baseSpec(), extra: 1 };
  assert(validateMapSpec(unknownRoot).some((e) => e.includes('根 不允许额外字段: extra')), '未知根字段 → 拒绝');
  const unknownNode = baseSpec();
  unknownNode.nodes[0].bogus = 1;
  assert(validateMapSpec(unknownNode).some((e) => e.includes('nodes[0] 不允许额外字段: bogus')), '未知 node 字段 → 拒绝');
  const invalidEdgeLabelKind = baseSpec();
  invalidEdgeLabelKind.edges = [{
    from: 'n1',
    to: 'n1',
    label: '关系',
    labelKind: 'branch',
    claimState: 'verified',
    evidence: [{ path: 'a.js', lineStart: 1, lineEnd: 2, state: 'verified' }],
  }];
  assert(validateMapSpec(invalidEdgeLabelKind).some((e) => e.includes('labelKind 必须为 action 或 condition')),
    '非法 edge.labelKind → 拒绝');
  const fracLine = baseSpecWithEvidence([{ path: 'a.js', lineStart: 0.5, lineEnd: 2, state: 'inferred' }]);
  assert(validateMapSpec(fracLine).some((e) => e.includes('lineStart 必须为整数')), 'inferred lineStart=0.5 → 拒绝');
  const strLine = baseSpecWithEvidence([{ path: 'a.js', lineStart: 1, lineEnd: '2', state: 'inferred' }]);
  assert(validateMapSpec(strLine).some((e) => e.includes('lineEnd 必须为整数')), 'lineEnd="2" → 拒绝');
  const emptySummary = baseSpec();
  emptySummary.meta.summary = '';
  assert(validateMapSpec(emptySummary).some((e) => e.includes('meta.summary 缺失或为空')), '空 meta.summary → 拒绝(Schema 已同步 minLength:1)');
  const leftToRight = baseSpec();
  leftToRight.meta.layoutDirection = 'LR';
  assert(validateMapSpec(leftToRight).length === 0, 'meta.layoutDirection=LR → 允许横向主流程');

  const chineseUi = structuredClone(leftToRight);
  chineseUi.meta.uiLocale = 'zh-CN';
  assert(validateMapSpec(chineseUi).length === 0, 'meta.uiLocale=zh-CN → 允许中文固定 UI');
  const invalidUiLocale = structuredClone(leftToRight);
  invalidUiLocale.meta.uiLocale = 'fr';
  assert(validateMapSpec(invalidUiLocale).some((e) => e.includes('meta.uiLocale')), '非法 uiLocale → 拒绝');
  const invalidDirection = baseSpec();
  invalidDirection.meta.layoutDirection = 'RL';
  assert(validateMapSpec(invalidDirection).some((e) => e.includes('meta.layoutDirection 必须为 TD 或 LR')), '非法 layoutDirection → 拒绝');
  const semanticBands = baseSpec();
  semanticBands.nodes[0].subgraph = 'Preparation';
  semanticBands.nodes.push({
    ...structuredClone(semanticBands.nodes[0]),
    id: 'n2',
    title: 'completion step',
    subgraph: 'Completion',
  });
  semanticBands.meta.layoutDirection = 'TD';
  semanticBands.meta.layoutBands = [
    { title: 'Preparation phase', direction: 'LR', subgraphs: ['Preparation'] },
    { title: 'Completion phase', direction: 'RL', subgraphs: ['Completion'] },
  ];
  assert(validateMapSpec(semanticBands).length === 0, '完整覆盖真实分组的语义阶段带 → 允许');
  const uncoveredSemanticBand = structuredClone(semanticBands);
  uncoveredSemanticBand.meta.layoutBands[1].subgraphs = [];
  assert(validateMapSpec(uncoveredSemanticBand).some((e) => e.includes('subgraphs 必须为非空数组')),
    '阶段带为空 → 拒绝');
  const leftToRightBand = structuredClone(semanticBands);
  leftToRightBand.meta.layoutDirection = 'LR';
  assert(validateMapSpec(leftToRightBand).some((e) => e.includes('只能与 layoutDirection=TD')),
    '语义阶段带与全局 LR 同用 → 拒绝');
  const missingPath = baseSpecWithEvidence([{ state: 'inferred' }]);
  assert(validateMapSpec(missingPath).some((e) => e.includes('path 缺失或为空')), 'inferred evidence 缺 path → 拒绝(Schema required 已同步)');
  const absoluteScope = baseSpec();
  absoluteScope.meta.scope = '/Users/alice/private-repo';
  assert(validateMapSpec(absoluteScope).some((e) => e.includes('meta.scope 含绝对路径')), '显示字段含用户绝对路径 → 拒绝');
  const tooManyCodeRows = baseSpecWithSegments([{ kind: 'code', title: '摘录', headers: ['代码'], rows: Array.from({ length: MAX_CODE_SEGMENT_ROWS + 1 }, () => ['x']) }]);
  assert(validateMapSpec(tooManyCodeRows).some((e) => e.includes(`行数上限 ${MAX_CODE_SEGMENT_ROWS}`)), '代码摘录超行数上限 → 拒绝');
  const tooLongCodeCell = baseSpecWithSegments([{ kind: 'code', title: '摘录', headers: ['代码'], rows: [['x'.repeat(MAX_CODE_CELL_CHARS + 1)]] }]);
  assert(validateMapSpec(tooLongCodeCell).some((e) => e.includes(`单元格字符上限 ${MAX_CODE_CELL_CHARS}`)), '代码摘录超单元格上限 → 拒绝');
  const tooLongCodeSegment = baseSpecWithSegments([{ kind: 'code', title: '摘录', headers: ['代码'], rows: Array.from({ length: 25 }, () => ['x'.repeat(MAX_CODE_CELL_CHARS)]) }]);
  assert(validateMapSpec(tooLongCodeSegment).some((e) => e.includes(`字符总数超过上限 ${MAX_CODE_SEGMENT_CHARS}`)), '代码摘录超总字符上限 → 拒绝');
}

// ---------- 6. --repo-root verified 真实性 ----------
console.log('\n== 6. --repo-root verified 真实性(P0)==');
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'icm-verify-'));
  try {
    const root = path.join(tmp, 'root');
    const outside = path.join(tmp, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(path.join(root, 'a.js'), 'line1\nline2\nline3\n'); // 3 行(尾部换行)
    writeFileSync(path.join(root, 'crlf.js'), 'line1\r\nline2\r\nline3\r\n'); // 3 行(CRLF)
    writeFileSync(path.join(root, 'nl.js'), '\n'); // 纯换行符:计 1 行(split 后移除尾部空串)
    writeFileSync(path.join(root, 'nl2.js'), '\n\n'); // 纯换行符:计 2 行
    mkdirSync(path.join(root, 'subdir')); // 真实目录
    writeFileSync(path.join(outside, 'secret.js'), 'secret');
    symlinkSync(outside, path.join(root, 'link')); // 仓库内 symlink 指向仓库外

    const mk = (evidencePath, state, lineStart, lineEnd) => {
      const s = baseSpec();
      s.nodes[0].claimState = state;
      s.nodes[0].evidence = [{ path: evidencePath, lineStart, lineEnd, state }];
      return s;
    };
    const evErr = (spec) => validateMapSpec(spec, { repoRoot: root });

    assert(evErr(mk('a.js', 'verified', 1, 3)).length === 0, '真实文件 + 行号在范围内 → 通过');
    assert(evErr(mk('definitely-not-present.ts', 'verified', 999, 1000)).some((e) => e.includes('文件不存在或不可读')), 'verified 文件不存在 → 拒绝');
    assert(evErr(mk('subdir', 'verified', 1, 1)).some((e) => e.includes('不是普通文件')), 'verified 指向目录 → 拒绝');
    assert(evErr(mk('a.js', 'verified', 1, 4)).some((e) => e.includes('超出文件实际行数')), 'lineEnd 越界(尾部换行计 3 行)→ 拒绝');
    assert(evErr(mk('crlf.js', 'verified', 1, 3)).length === 0, 'CRLF 文件行数正确 → 通过');
    assert(evErr(mk('crlf.js', 'verified', 1, 4)).some((e) => e.includes('超出文件实际行数')), 'CRLF 文件越界 → 拒绝');
    assert(evErr(mk('link/secret.js', 'verified', 1, 1)).some((e) => e.includes('越出 --repo-root')), 'symlink 逃逸 → 拒绝');
    assert(evErr(mk('nl.js', 'verified', 1, 1)).length === 0, "纯换行符文件 '\\n' 计 1 行 → lineEnd=1 通过");
    assert(evErr(mk('nl.js', 'verified', 1, 2)).some((e) => e.includes('超出文件实际行数')), "纯换行符文件 '\\n' lineEnd=2 越界 → 拒绝");
    assert(evErr(mk('nl2.js', 'verified', 1, 2)).length === 0, "纯换行符文件 '\\n\\n' 计 2 行 → lineEnd=2 通过");
    assert(evErr(mk('missing-inferred.ts', 'inferred', 1, 2)).length === 0, 'inferred 证据路径不存在 → 允许(非"已证实")');
    const rootAsFile = validateMapSpec(mk('a.js', 'verified', 1, 3), { repoRoot: path.join(root, 'a.js') });
    assert(rootAsFile.some((e) => e.includes('--repo-root 必须是目录')), '--repo-root 为普通文件 → 拒绝');
    const badRoot = validateMapSpec(mk('a.js', 'verified', 1, 3), { repoRoot: path.join(tmp, 'nonexistent') });
    assert(badRoot.some((e) => e.includes('不存在或不可读')), '--repo-root 不存在 → 明确报错');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
