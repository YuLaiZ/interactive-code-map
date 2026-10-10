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
  collectMapSpecNotices,
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

// ---------- 7. sequence(diagramKind=sequence)专属校验 ----------
// 覆盖端点存在性、显示文本单行、帧条件字符合同、activation 配平
// (帧内禁变/外层包帧/线性配平)、递归计数与软限提示。
console.log('\n== 7. sequence 专属校验 ==');
{
  const verifiedEvidence = [{ path: 'a.js', lineStart: 1, lineEnd: 2, state: 'verified' }];
  const seqParticipant = (id, title, overrides = {}) => ({
    id, title, claimState: 'verified', evidence: verifiedEvidence, ...overrides,
  });
  const seqMessage = (from, to, label, overrides = {}) => ({
    from, to, label, claimState: 'verified', evidence: verifiedEvidence, ...overrides,
  });
  const seqSpec = (messages, participants) => ({
    schemaVersion: 1,
    meta: { title: 't', question: 'q', scope: 's', languageProfile: 'zh-CN', summary: 's', diagramKind: 'sequence' },
    participants: participants || [seqParticipant('client', '客户端'), seqParticipant('order', '订单服务'), seqParticipant('pay', '支付网关')],
    messages,
  });

  const happyPath = seqSpec([
    seqMessage('client', 'order', '提交订单', { activation: { activatesTo: true } }),
    {
      frame: true,
      kind: 'loop',
      label: '回调重试最多三次',
      messages: [
        seqMessage('order', 'pay', '请求支付'),
        {
          frame: true,
          kind: 'alt',
          branches: [
            { label: '重试未超上限', messages: [seqMessage('order', 'pay', '再次请求')] },
            { label: '已达重试上限', messages: [seqMessage('order', 'client', '返回失败', { arrowKind: 'dashed' })] },
          ],
        },
      ],
    },
    seqMessage('order', 'client', '订单完成', { arrowKind: 'dashed', activation: { deactivatesFrom: true } }),
    seqMessage('client', 'client', '本地校验'),
  ]);
  assert(validateMapSpec(happyPath).length === 0, 'sequence 正向:同步调用 + 外层激活包 loop 帧 + 双分支 alt + 自消息通过');

  const error = (spec) => validateMapSpec(spec);

  const missingParticipants = seqSpec([seqMessage('client', 'order', 'x')]);
  delete missingParticipants.participants;
  assert(error(missingParticipants).includes('participants 必须为非空数组'), '缺 participants → 拒绝');

  const unknownEndpoint = seqSpec([seqMessage('client', 'ghost', 'x')]);
  assert(error(unknownEndpoint).some((e) => e.includes("指向未声明的参与者")), '未知端点 → 拒绝');

  for (const [label, newline] of [
    ['\\n', 'a\nb'],
    ['\\r', 'a\rb'],
    ['\\r\\n', 'a\r\nb'],
  ]) {
    const newlineSpec = seqSpec([seqMessage('client', 'order', newline)]);
    assert(error(newlineSpec).some((e) => e.includes('含换行(sequence 显示文本必须单行)')), `label 换行(${label}) → 拒绝`);
  }
  const newlineTitle = seqSpec([seqMessage('client', 'order', 'x')], [seqParticipant('client', '甲\nparticipant C'), seqParticipant('order', '乙')]);
  assert(error(newlineTitle).some((e) => e.includes('participants[0].title 含换行')), 'participant.title 换行注入 → 拒绝');

  for (const [name, condition] of [
    ['&', 'a & b'],
    [';', 'a; b'],
    ['#', 'a #x'],
    ['<', 'a < b'],
    ['>', 'a > b'],
    ['"', 'a "b"'],
    ['$', 'a $x$'],
    [':', 'wrap: retry'],
    ['%', 'retry %%{init}%%'],
  ]) {
    const frameCharSpec = seqSpec([{ frame: true, kind: 'loop', label: condition, messages: [seqMessage('client', 'order', 'x')] }]);
    assert(error(frameCharSpec).some((e) => e.includes('含帧条件禁用字符')), `帧条件特殊字符 ${name} → 拒绝`);
  }
  const frameNewlineSpec = seqSpec([{ frame: true, kind: 'loop', label: 'retry\nautonumber off\nend', messages: [seqMessage('client', 'order', 'x')] }]);
  assert(error(frameNewlineSpec).some((e) => e.includes('帧条件必须单行')), '帧条件换行注入 → 拒绝');
  const branchNewlineSpec = seqSpec([{
    frame: true,
    kind: 'alt',
    branches: [
      { label: 'a\nparticipant C', messages: [seqMessage('client', 'order', 'x')] },
      { label: 'b', messages: [seqMessage('client', 'order', 'y')] },
    ],
  }]);
  assert(error(branchNewlineSpec).some((e) => e.includes('branches[0].label 含换行')), 'alt 分支条件换行 → 拒绝');

  const overHardLabel = seqSpec([seqMessage('client', 'order', 'x'.repeat(101))]);
  assert(error(overHardLabel).some((e) => e.includes('码点超过硬上限 100')), 'label 101 码点(硬限) → 拒绝');
  const surrogateWithin = seqSpec([seqMessage('client', 'order', '🎉'.repeat(51))]);
  assert(validateMapSpec(surrogateWithin).length === 0, '51 个 emoji(51 码点,102 UTF-16 code units)通过——码点计数,不用 .length');
  const surrogateOverHard = seqSpec([seqMessage('client', 'order', '🎉'.repeat(101))]);
  assert(error(surrogateOverHard).some((e) => e.includes('码点超过硬上限 100')), '101 个 emoji(101 码点) → 拒绝');

  const bothTrue = seqSpec([seqMessage('client', 'order', 'x', { activation: { activatesTo: true, deactivatesFrom: true } })]);
  assert(error(bothTrue).some((e) => e.includes('不得同真')), '两布尔同真 → 拒绝');
  // activation 布尔类型严格校验:字符串/数字/null 不做隐式转换,防止生成器
  // 只识别 === true 而静默丢掉激活声明。
  for (const [name, flag] of [['字符串 "true"', 'true'], ['数字 1', 1], ['null', null]]) {
    const badFlag = seqSpec([seqMessage('client', 'order', 'x', { activation: { activatesTo: flag } })]);
    assert(error(badFlag).some((e) => e.includes('activation.activatesTo 必须为布尔值')), `activation.activatesTo 为${name} → 拒绝`);
  }
  const explicitFalse = seqSpec([seqMessage('client', 'order', 'x', { activation: { activatesTo: false, deactivatesFrom: false } })]);
  assert(validateMapSpec(explicitFalse).length === 0, '显式 false 等价未激活 → 通过');
  // 帧条件可选字段的类型严格校验:可选只等于允许省略,存在即必须为非 null 字符串。
  for (const [name, value] of [['数字', 123], ['对象', { x: 1 }], ['数组', ['x']], ['null', null], ['布尔', true]]) {
    const badFrame = seqSpec([{ frame: true, kind: 'loop', label: value, messages: [seqMessage('client', 'order', 'x')] }]);
    assert(error(badFrame).some((e) => e.includes('messages[0].label 必须为字符串')), `帧条件为${name} → 拒绝`);
  }
  const frameWithoutLabel = seqSpec([{ frame: true, kind: 'loop', messages: [seqMessage('client', 'order', 'x')] }]);
  assert(validateMapSpec(frameWithoutLabel).length === 0, '帧条件省略(loop 无 label) → 通过');
  const frameEmptyLabel = seqSpec([{ frame: true, kind: 'loop', label: '', messages: [seqMessage('client', 'order', 'x')] }]);
  assert(validateMapSpec(frameEmptyLabel).length === 0, '帧条件空字符串(loop 语境等价省略) → 通过');
  const activationInFrame = seqSpec([{
    frame: true,
    kind: 'loop',
    label: 'l',
    messages: [seqMessage('client', 'order', 'x', { activation: { activatesTo: true } })],
  }]);
  assert(error(activationInFrame).some((e) => e.includes('帧内消息禁止携带 activation')), '帧内 activation → 拒绝');
  const dangling = seqSpec([seqMessage('client', 'order', 'x', { activation: { activatesTo: true } })]);
  assert(error(dangling).some((e) => e.includes('存在未配对的激活')), '悬空激活 → 拒绝');
  const repeatedActivation = seqSpec([
    seqMessage('client', 'order', 'x1', { activation: { activatesTo: true } }),
    seqMessage('client', 'order', 'x2', { activation: { activatesTo: true } }),
  ]);
  assert(error(repeatedActivation).some((e) => e.includes('重复激活')), '重复激活 → 拒绝');
  const deactivateInactive = seqSpec([seqMessage('client', 'order', 'x', { activation: { deactivatesFrom: true } })]);
  assert(error(deactivateInactive).some((e) => e.includes('去激活未激活的参与者')), '去激活未激活参与者 → 拒绝');

  const singleBranch = seqSpec([{ frame: true, kind: 'alt', branches: [{ label: 'a', messages: [seqMessage('client', 'order', 'x')] }] }]);
  assert(error(singleBranch).some((e) => e.includes('alt 分支必须为至少 2 段')), 'alt 单分支 → 拒绝');
  const altWithMessages = seqSpec([{
    frame: true,
    kind: 'alt',
    label: 'c',
    messages: [seqMessage('client', 'order', 'x')],
    branches: [
      { label: 'a', messages: [seqMessage('client', 'order', 'x')] },
      { label: 'b', messages: [seqMessage('client', 'order', 'y')] },
    ],
  }]);
  assert(error(altWithMessages).some((e) => e.includes('不允许同时携带 messages')), 'alt 同时携带 messages → 拒绝');
  const loopWithBranches = seqSpec([{
    frame: true,
    kind: 'loop',
    label: 'l',
    messages: [seqMessage('client', 'order', 'x')],
    branches: [
      { label: 'a', messages: [seqMessage('client', 'order', 'x')] },
      { label: 'b', messages: [seqMessage('client', 'order', 'y')] },
    ],
  }]);
  assert(error(loopWithBranches).some((e) => e.includes('只有 alt 允许 branches')), 'loop 携带 branches → 拒绝');

  const deepNesting = seqSpec([{
    frame: true,
    kind: 'loop',
    label: 'a',
    messages: [{
      frame: true,
      kind: 'opt',
      label: 'b',
      messages: [{
        frame: true,
        kind: 'opt',
        label: 'c',
        messages: [seqMessage('client', 'order', 'x')],
      }],
    }],
  }]);
  assert(error(deepNesting).some((e) => e.includes('帧嵌套深度超过上限 2')), '三层嵌套帧 → 拒绝');
  const twoLevelNesting = seqSpec([{
    frame: true,
    kind: 'loop',
    label: 'a',
    messages: [{
      frame: true,
      kind: 'opt',
      label: 'b',
      messages: [seqMessage('client', 'order', 'x')],
    }],
  }]);
  assert(validateMapSpec(twoLevelNesting).length === 0, '两层嵌套帧(深度 2) → 通过');

  const flowchartWithParticipants = baseSpec();
  flowchartWithParticipants.participants = [seqParticipant('client', '甲')];
  assert(error(flowchartWithParticipants).includes('participants 仅 diagramKind=sequence 有效'), 'flowchart 携带 participants → 拒绝');
  const sequenceWithNodes = seqSpec([seqMessage('client', 'order', 'x')]);
  sequenceWithNodes.nodes = [{ id: 'n', title: 't', claimState: 'inferred', evidence: verifiedEvidence, detail: { summary: 's', segments: [] } }];
  assert(error(sequenceWithNodes).some((e) => e.includes('diagramKind=sequence 禁止 nodes')), 'sequence 携带 nodes → 拒绝');
  const sequenceWithBands = seqSpec([seqMessage('client', 'order', 'x')]);
  sequenceWithBands.meta.layoutDirection = 'TD';
  assert(error(sequenceWithBands).some((e) => e.includes('仅 flowchart 有效')), 'sequence 携带 layoutDirection → 拒绝');

  const overHardCount = seqSpec(Array.from({ length: 61 }, (_unused, index) => seqMessage('client', 'order', 'm' + index)));
  assert(error(overHardCount).some((e) => e.includes('超过硬上限 60')), '消息总数 61(递归展开) → 拒绝');
  assert(collectMapSpecNotices(seqSpec(Array.from({ length: 31 }, (_unused, index) => seqMessage('client', 'order', 'm' + index))))
    .some((n) => n.includes('超过软限 30')), '消息总数 31 → 软限提示(非错误)');
  assert(collectMapSpecNotices(happyPath).length === 0, '软限内不产生提示');
  const overSoftLabel = seqSpec([seqMessage('client', 'order', 'x'.repeat(41))]);
  assert(collectMapSpecNotices(overSoftLabel).some((n) => n.includes('超过软限 40')), 'label 41 码点 → 软限提示(非错误)');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
