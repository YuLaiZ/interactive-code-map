import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMapSpec } from '../../skill/renderer/validate-map-spec.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const schema = path.join(repoRoot, 'skill', 'references', 'mapspec-v1.schema.json');
const fixtureRoots = [path.join(repoRoot, 'tests')];
const executable = process.platform === 'win32' ? 'ajv.cmd' : 'ajv';
const ajv = path.join(repoRoot, 'node_modules', '.bin', executable);

let pass = 0;
let fail = 0;

function assert(condition, message) {
  if (condition) {
    pass += 1;
    console.log('  ✓ ' + message);
  } else {
    fail += 1;
    console.error('  ✗ ' + message);
  }
}

function ajvAccepts(filePath) {
  try {
    execFileSync(
      ajv,
      ['validate', '-s', schema, '-d', filePath, '--strict=true', '--strict-required=true', '--spec=draft2020'],
      { stdio: 'pipe' },
    );
    return true;
  } catch {
    return false;
  }
}

// 结构反例必须同时被 Schema 与共享校验器拒绝。语义反例则证明共享校验器
// 在 Schema 之外仍收紧了隐私、证据状态和跨字段不变量。
const structuralInvalid = new Set([
  'missing-meta-summary.json',
  'missing-detail-segments.json',
  'edges-not-array.json',
  'root-null.json',
  'unknown-root-field.json',
  'unknown-node-field.json',
  'line-non-integer.json',
  'line-start-zero.json',
  'edge-line-start-zero.json',
  'missing-evidence-path.json',
]);
const semanticInvalid = new Set([
  'sensitive-content-key.json',
  'sensitive-path-env.json',
  'unconfirmed-with-verified-evidence.json',
  'edge-line-end-before-start.json',
  'absolute-display-path.json',
]);

function validSpecWithCode(rows) {
  return {
    schemaVersion: 1,
    meta: { title: 't', question: 'q', scope: 's', languageProfile: 'js', summary: 's' },
    nodes: [{
      id: 'n1',
      title: 'n',
      claimState: 'inferred',
      evidence: [{ path: 'a.js', state: 'inferred' }],
      detail: {
        summary: 's',
        segments: [{ kind: 'code', title: 'code', headers: ['code'], rows }],
      },
    }],
  };
}

function writeTemporary(name, spec) {
  const file = path.join(here, '.tmp-schema-diff-' + name + '.json');
  writeFileSync(file, JSON.stringify(spec));
  return file;
}

console.log('== Schema 与共享校验器差分测试（校验器覆盖 Schema 并扩展语义）==');

const invalidDirectory = path.join(here, 'fixtures', 'invalid');
for (const name of readdirSync(invalidDirectory).filter((file) => file.endsWith('.json')).sort()) {
  const file = path.join(invalidDirectory, name);
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const ajvOk = ajvAccepts(file);
  const validatorOk = validateMapSpec(spec).length === 0;

  // 关键单向包含：Schema 拒绝时共享校验器不得放行。
  if (!ajvOk) {
    assert(!validatorOk, name + ': Schema 拒绝时共享校验器也拒绝');
  }
  if (structuralInvalid.has(name)) {
    assert(!ajvOk && !validatorOk, name + ': 结构约束由两者共同拒绝');
  } else if (semanticInvalid.has(name)) {
    assert(ajvOk && !validatorOk, name + ': Schema 通过而共享校验器按附加语义拒绝');
  } else {
    assert(false, name + ': 未分类，必须登记其结构或语义归属');
  }
}

for (const [name, spec, expected] of [
  ['code-rows', validSpecWithCode(Array.from({ length: 81 }, () => ['x'])), 'both-reject'],
  ['code-cell', validSpecWithCode([['x'.repeat(501)]]), 'both-reject'],
  ['code-total', validSpecWithCode(Array.from({ length: 25 }, () => ['x'.repeat(500)])), 'validator-only'],
]) {
  const file = writeTemporary(name, spec);
  try {
    const ajvOk = ajvAccepts(file);
    const validatorOk = validateMapSpec(spec).length === 0;
    if (expected === 'both-reject') {
      assert(!ajvOk && !validatorOk, name + ': Schema 与共享校验器都拒绝');
    } else {
      assert(ajvOk && !validatorOk, name + ': 总字符上限由共享校验器额外拒绝');
    }
  } finally {
    unlinkSync(file);
  }
}

{
  const browserFixture = path.join(repoRoot, 'tests', 'browser', 'fixtures', 'subgraph-title-occlusion.mapspec.json');
  const spec = JSON.parse(readFileSync(browserFixture, 'utf8'));
  const ajvOk = ajvAccepts(browserFixture);
  const validatorOk = validateMapSpec(spec, {
    allowTestFixture: true,
    fixtureFilePath: browserFixture,
    fixtureRoots,
  }).length === 0;
  assert(ajvOk && validatorOk, '浏览器 fixture：显式放行测试标记后两者都通过');
}

// ---------- sequence(diagramKind=sequence)差分 ----------
function validSequenceSpec() {
  const evidence = (state) => state === 'verified'
    ? [{ path: 'a.js', lineStart: 1, lineEnd: 2, state }]
    : [{ path: 'a.js', state }];
  return {
    schemaVersion: 1,
    meta: { title: 't', question: 'q', scope: 's', languageProfile: 'js', summary: 's', diagramKind: 'sequence' },
    participants: [
      { id: 'end', title: 'Gateway', claimState: 'verified', evidence: evidence('verified') },
      { id: 'a', title: 'Ledger', claimState: 'inferred', evidence: evidence('inferred') },
    ],
    messages: [
      { from: 'end', to: 'a', label: 'call', claimState: 'verified', evidence: evidence('verified') },
      {
        frame: true,
        kind: 'loop',
        label: 'RetryBudgetCheck',
        messages: [
          { from: 'a', to: 'end', label: 'tick', claimState: 'inferred', evidence: evidence('inferred') },
        ],
      },
    ],
  };
}

function writeSequenceTemporary(spec) {
  return writeTemporary('sequence', spec);
}

console.log('== sequence 分支差分（Schema 与共享校验器共同拒绝/校验器收紧）==');
{
  const validSpec = validSequenceSpec();
  const file = writeSequenceTemporary(validSpec);
  try {
    const ajvOk = ajvAccepts(file);
    const validatorOk = validateMapSpec(validSpec).length === 0;
    assert(ajvOk && validatorOk, '合法 sequence(含关键字 id/loop 帧):两者都通过');
  } finally {
    unlinkSync(file);
  }

  const mixed = validSequenceSpec();
  mixed.nodes = [{ id: 'n', title: 'n', claimState: 'inferred', evidence: [{ path: 'a.js', state: 'inferred' }], detail: { summary: 's', segments: [] } }];
  const mixedFile = writeSequenceTemporary(mixed);
  try {
    assert(!ajvAccepts(mixedFile) && validateMapSpec(mixed).length > 0, 'sequence 携带 nodes:两者都拒绝');
  } finally {
    unlinkSync(mixedFile);
  }

  const flowchartMixed = validSequenceSpec();
  // flowchart(diagramKind 缺省)仍声明 nodes,但携带 participants:互斥由
  // Schema(else 分支 not)与共享校验器双重拒绝。
  flowchartMixed.meta = { title: 't', question: 'q', scope: 's', languageProfile: 'js', summary: 's' };
  flowchartMixed.nodes = [{ id: 'n', title: 'n', claimState: 'inferred', evidence: [{ path: 'a.js', state: 'inferred' }], detail: { summary: 's', segments: [] } }];
  const flowchartMixedFile = writeSequenceTemporary(flowchartMixed);
  try {
    assert(!ajvAccepts(flowchartMixedFile) && validateMapSpec(flowchartMixed).length > 0, 'flowchart 携带 participants:两者都拒绝');
  } finally {
    unlinkSync(flowchartMixedFile);
  }

  const newlineLabel = validSequenceSpec();
  newlineLabel.messages[0].label = 'a\nb';
  const newlineFile = writeSequenceTemporary(newlineLabel);
  try {
    assert(!ajvAccepts(newlineFile) && validateMapSpec(newlineLabel).length > 0, 'label 换行:两者都拒绝');
  } finally {
    unlinkSync(newlineFile);
  }

  const frameSpecialChar = validSequenceSpec();
  frameSpecialChar.messages[1].label = 'cond $x$';
  const frameSpecialFile = writeSequenceTemporary(frameSpecialChar);
  try {
    assert(!ajvAccepts(frameSpecialFile) && validateMapSpec(frameSpecialChar).length > 0, '帧条件特殊字符($):两者都拒绝');
  } finally {
    unlinkSync(frameSpecialFile);
  }

  // 帧条件字符合同 9 字符逐项 × 帧条件与分支条件两处上下文。
  for (const ch of ['&', ';', '#', '<', '>', '"', '$', ':', '%']) {
    const frameCondition = validSequenceSpec();
    frameCondition.messages[1].label = 'retry ' + ch + ' done';
    const frameFile = writeSequenceTemporary(frameCondition);
    try {
      assert(!ajvAccepts(frameFile) && validateMapSpec(frameCondition).length > 0, `帧条件含 '${ch}':两者都拒绝`);
    } finally {
      unlinkSync(frameFile);
    }
    const branchCondition = validSequenceSpec();
    branchCondition.messages[1] = {
      frame: true,
      kind: 'alt',
      branches: [
        { label: 'branch ' + ch + ' case', messages: [{ from: 'a', to: 'end', label: 'tick', claimState: 'inferred', evidence: [{ path: 'a.js', state: 'inferred' }] }] },
        { label: 'normal', messages: [{ from: 'a', to: 'end', label: 'tock', claimState: 'inferred', evidence: [{ path: 'a.js', state: 'inferred' }] }] },
      ],
    };
    const branchFile = writeSequenceTemporary(branchCondition);
    try {
      assert(!ajvAccepts(branchFile) && validateMapSpec(branchCondition).length > 0, `分支条件含 '${ch}':两者都拒绝`);
    } finally {
      unlinkSync(branchFile);
    }
  }

  const frameNonString = validSequenceSpec();
  frameNonString.messages[1].label = 123;
  const frameNonStringFile = writeSequenceTemporary(frameNonString);
  try {
    assert(!ajvAccepts(frameNonStringFile) && validateMapSpec(frameNonString).length > 0, '帧条件为数字:两者都拒绝');
  } finally {
    unlinkSync(frameNonStringFile);
  }
  const frameNull = validSequenceSpec();
  frameNull.messages[1].label = null;
  const frameNullFile = writeSequenceTemporary(frameNull);
  try {
    assert(!ajvAccepts(frameNullFile) && validateMapSpec(frameNull).length > 0, '帧条件为 null:两者都拒绝');
  } finally {
    unlinkSync(frameNullFile);
  }
  const activationNonBoolean = validSequenceSpec();
  activationNonBoolean.messages[0].activation = { activatesTo: 'true' };
  const activationNonBooleanFile = writeSequenceTemporary(activationNonBoolean);
  try {
    assert(!ajvAccepts(activationNonBooleanFile) && validateMapSpec(activationNonBoolean).length > 0, 'activation.activatesTo 为字符串:两者都拒绝');
  } finally {
    unlinkSync(activationNonBooleanFile);
  }

  const overHardLabel = validSequenceSpec();
  overHardLabel.messages[0].label = 'x'.repeat(101);
  const overHardFile = writeSequenceTemporary(overHardLabel);
  try {
    assert(!ajvAccepts(overHardFile) && validateMapSpec(overHardLabel).length > 0, 'label 101 码点超硬限:两者都拒绝(JSON Schema maxLength 按码点计数)');
  } finally {
    unlinkSync(overHardFile);
  }

  const overHardCount = validSequenceSpec();
  overHardCount.messages = Array.from({ length: 61 }, (_unused, index) => ({
    from: 'end',
    to: 'a',
    label: 'm' + index,
    claimState: 'verified',
    evidence: [{ path: 'a.js', lineStart: 1, lineEnd: 2, state: 'verified' }],
  }));
  const overHardCountFile = writeSequenceTemporary(overHardCount);
  try {
    assert(ajvAccepts(overHardCountFile) && validateMapSpec(overHardCount).length > 0, '消息总数 61 条:Schema 放行,共享校验器按递归计数收紧');
  } finally {
    unlinkSync(overHardCountFile);
  }

  const activationInFrame = validSequenceSpec();
  activationInFrame.messages[1].messages[0].activation = { activatesTo: true };
  const activationInFrameFile = writeSequenceTemporary(activationInFrame);
  try {
    assert(ajvAccepts(activationInFrameFile) && validateMapSpec(activationInFrame).length > 0, '帧内 activation:Schema 放行,共享校验器收紧');
  } finally {
    unlinkSync(activationInFrameFile);
  }

  const deepNesting = validSequenceSpec();
  deepNesting.messages[1].messages = [{
    frame: true,
    kind: 'opt',
    label: 'inner',
    messages: [{
      frame: true,
      kind: 'opt',
      label: 'deepest',
      messages: [{ from: 'a', to: 'end', label: 'tick', claimState: 'inferred', evidence: [{ path: 'a.js', state: 'inferred' }] }],
    }],
  }];
  const deepFile = writeSequenceTemporary(deepNesting);
  try {
    assert(ajvAccepts(deepFile) && validateMapSpec(deepNesting).length > 0, '帧嵌套深度 3:Schema 放行,共享校验器收紧');
  } finally {
    unlinkSync(deepFile);
  }
}

for (const demoName of [
  'expected-mapspec.json',
  'expected-mapspec.zh-CN.json',
  'expected-mapspec.sequence.json',
  'expected-mapspec.sequence.zh-CN.json',
]) {
  const demoFixture = path.join(repoRoot, 'examples', 'demo', demoName);
  if (!existsSync(demoFixture)) {
    assert(false, demoName + '：demo fixture 缺失');
  } else {
    const spec = JSON.parse(readFileSync(demoFixture, 'utf8'));
    assert(
      ajvAccepts(demoFixture) && validateMapSpec(spec).length === 0,
      demoName + '：Schema 与共享校验器都通过',
    );
  }
}

{
  const english = JSON.parse(readFileSync(
    path.join(repoRoot, 'examples', 'demo', 'expected-mapspec.json'),
    'utf8',
  ));
  const chinese = JSON.parse(readFileSync(
    path.join(repoRoot, 'examples', 'demo', 'expected-mapspec.zh-CN.json'),
    'utf8',
  ));
  const evidenceShape = (evidence) => evidence.map(({ path: evidencePath, lineStart, lineEnd, symbol, state }) => ({
    path: evidencePath,
    lineStart,
    lineEnd,
    symbol,
    state,
  }));
  const nodeShape = (node) => ({
    id: node.id,
    claimState: node.claimState,
    evidence: evidenceShape(node.evidence),
  });
  const edgeShape = (edge) => ({
    from: edge.from,
    to: edge.to,
    labelKind: edge.labelKind,
    claimState: edge.claimState,
    evidence: evidenceShape(edge.evidence),
  });
  assert(
    JSON.stringify(english.nodes.map(nodeShape)) === JSON.stringify(chinese.nodes.map(nodeShape))
      && JSON.stringify(english.edges.map(edgeShape)) === JSON.stringify(chinese.edges.map(edgeShape)),
    '双语 demo 的节点、连线、状态与证据数据保持一致，仅本地化读者可见文案',
  );
}

{
  // sequence 双语 demo 的一致性:参与者与消息的结构、状态与证据数据一致,
  // 仅 title/label/文案本地化(frame.label 属读者可见文案,不参与比较)。
  const readSequence = (name) => JSON.parse(readFileSync(
    path.join(repoRoot, 'examples', 'demo', name),
    'utf8',
  ));
  const englishSequence = readSequence('expected-mapspec.sequence.json');
  const chineseSequence = readSequence('expected-mapspec.sequence.zh-CN.json');
  const evidenceShape = (evidence) => evidence.map(({ path: evidencePath, lineStart, lineEnd, symbol, state }) => ({
    path: evidencePath,
    lineStart,
    lineEnd,
    symbol,
    state,
  }));
  const participantShape = (participant) => ({
    id: participant.id,
    claimState: participant.claimState,
    evidence: evidenceShape(participant.evidence),
  });
  const messageShape = (message) => ({
    from: message.from,
    to: message.to,
    arrowKind: message.arrowKind,
    claimState: message.claimState,
    evidence: evidenceShape(message.evidence),
  });
  const structureShape = (items) => (Array.isArray(items) ? items.map((item) => {
    if (item.frame === true) {
      return {
        frame: true,
        kind: item.kind,
        messages: structureShape(item.messages),
        branches: Array.isArray(item.branches)
          ? item.branches.map((branch) => ({ messages: structureShape(branch.messages) }))
          : undefined,
      };
    }
    return messageShape(item);
  }) : undefined);
  assert(
    JSON.stringify(englishSequence.participants.map(participantShape)) === JSON.stringify(chineseSequence.participants.map(participantShape)),
    '双语时序 demo 的参与者、状态与证据数据保持一致',
  );
  assert(
    JSON.stringify(structureShape(englishSequence.messages)) === JSON.stringify(structureShape(chineseSequence.messages)),
    '双语时序 demo 的消息结构、激活配平与证据数据保持一致，仅本地化读者可见文案',
  );
}

console.log('\n结果: ' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
