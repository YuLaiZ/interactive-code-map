import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodeSequenceLiteralText,
  assertSequenceSingleLineText,
  assertSequenceFrameConditionText,
  sequenceEntityMap,
} from '../../skill/renderer/mermaid-sequence-encoder.mjs';
import { mapspecToMermaidSequence, sequenceMessagesInOrder } from '../../skill/renderer/mapspec-to-mermaid-sequence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const buildRules = JSON.parse(readFileSync(path.join(here, '..', '..', 'skill', 'references', 'mapspec-v1.build-rules.json'), 'utf8'));

let pass = 0;
let fail = 0;

function assert(condition, message) {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${message}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${message}`);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    fail += 1;
    console.error(`  ✗ ${message}(未抛错)`);
  } catch {
    pass += 1;
    console.log(`  ✓ ${message}`);
  }
}

function makeSpec({ participants, messages, meta }) {
  return {
    schemaVersion: 1,
    meta: { title: 't', question: 'q', scope: 's', languageProfile: 'en', summary: 's', diagramKind: 'sequence', ...meta },
    participants,
    messages,
  };
}

function participant(id, title) {
  return { id, title, claimState: 'verified', evidence: [{ path: 'a.js', lineStart: 1, lineEnd: 2, state: 'verified' }] };
}

function message(from, to, label, extra = {}) {
  return { from, to, label, claimState: 'verified', evidence: [{ path: 'a.js', lineStart: 1, lineEnd: 2, state: 'verified' }], ...extra };
}

// ---------- 编码表一致性 ----------
console.log('== 编码表与 build-rules 一致 ==');
{
  const declared = buildRules.sequenceDiagramContract.literalTextEncoding.entityMap;
  const actual = sequenceEntityMap();
  let ok = Object.keys(declared).length === actual.size;
  for (const [ch, entity] of Object.entries(declared)) {
    if (actual.get(ch) !== entity) ok = false;
  }
  assert(ok, 'build-rules entityMap 与编码器 9 字符表逐项一致');
}

// ---------- 单遍历字符映射 ----------
console.log('== 单遍历字符映射 ==');
assert(encodeSequenceLiteralText('普通文本') === '普通文本', '普通文本不变');
assert(encodeSequenceLiteralText('a & b') === 'a #38; b', '& → #38;');
assert(encodeSequenceLiteralText('x; y') === 'x#59; y', '; → #59;');
assert(encodeSequenceLiteralText('path#anchor') === 'path#35;anchor', '# → #35;');
assert(encodeSequenceLiteralText('q="value"') === 'q=#34;value#34;', '" → #34;');
assert(encodeSequenceLiteralText('a < b > c') === 'a #60; b #62; c', '< > 分别编码');
assert(encodeSequenceLiteralText('$$x$$') === '#36;#36;x#36;#36;', '$ → #36;(阻断数学渲染路径)');
assert(encodeSequenceLiteralText('wrap: retry') === 'wrap#58; retry', ': → #58;(阻断 wrap: 控制前缀)');
assert(encodeSequenceLiteralText('%%{init}%%') === '#37;#37;{init}#37;#37;', '% → #37;(阻断指令预处理删除)');
assert(encodeSequenceLiteralText('50% 完成率') === '50#37; 完成率', '普通百分比同样编码且文本保留');
assert(encodeSequenceLiteralText('&#38;') === '#38;#35;38#59;', '实体形态输入不会被二次转义(单遍历)');
assert(encodeSequenceLiteralText('a<b') === 'a#60;b', '字面 <br/> 前半编码');
assert(encodeSequenceLiteralText('<br/>') === '#60;br/#62;', '字面 <br/> 编码后不再成标签');
assert(encodeSequenceLiteralText('🎉') === '🎉', 'emoji(代理对)按码点整体保留');
assert(encodeSequenceLiteralText('：') === '：', '全角冒号不在表内、不受影响');

// ---------- 防御断言(fail closed) ----------
console.log('== 生成器防御断言 ==');
assertThrows(() => assertSequenceSingleLineText('a\nb', '测试'), '换行(\\n)触发断言抛错');
assertThrows(() => assertSequenceSingleLineText('a\rb', '测试'), '换行(\\r)触发断言抛错');
assertThrows(() => assertSequenceSingleLineText('a\r\nb', '测试'), '换行(\\r\\n)触发断言抛错');
assertThrows(() => assertSequenceFrameConditionText('a & b', '测试'), '帧条件含 & 触发断言抛错');
assertThrows(() => assertSequenceFrameConditionText('a%b', '测试'), '帧条件含 % 触发断言抛错');
assertThrows(() => assertSequenceFrameConditionText('a: b', '测试'), '帧条件含 : 触发断言抛错');
assertThrows(() => assertSequenceFrameConditionText('a\nparticipant C', '测试'), '帧条件换行注入触发断言抛错');

// ---------- DSL 生成:结构合同 ----------
console.log('== DSL 生成(结构合同) ==');
{
  const spec = makeSpec({
    participants: [participant('client', 'Client'), participant('end', 'Gateway')],
    messages: [
      message('client', 'end', 'Call'),
      message('end', 'client', 'Reply', { arrowKind: 'dashed' }),
      message('client', 'client', 'Self check'),
      message('client', 'end', 'Activate', { activation: { activatesTo: true } }),
      message('end', 'client', 'Deactivate', { arrowKind: 'dashed', activation: { deactivatesFrom: true } }),
    ],
  });
  const dsl = mapspecToMermaidSequence(spec);
  assert(dsl.startsWith('sequenceDiagram\n    autonumber'), 'DSL 以 sequenceDiagram + autonumber 开头');
  assert(dsl.includes('participant icm_p1 as Client'), '参与者按声明序映射 icm_p1');
  assert(dsl.includes('participant icm_p2 as Gateway'), '参与者按声明序映射 icm_p2');
  assert(dsl.includes('icm_p1->>icm_p2: Call'), 'solid 消息用 ->>');
  assert(dsl.includes('icm_p2-->>icm_p1: Reply'), 'dashed 消息用 -->>');
  assert(dsl.includes('icm_p1->>icm_p1: Self check'), '自消息合法');
  assert(dsl.includes('icm_p1->>+icm_p2: Activate'), 'activatesTo 生成 + 前缀于 to');
  assert(dsl.includes('icm_p2-->>-icm_p1: Deactivate'), 'deactivatesFrom 生成 - 前缀于 to(去激活 from)');
  assert(!/\bend\b->>/.test(dsl) && !/->>\s*end\b/.test(dsl), '关键字 id 不作为端点泄漏');
  assert(!dsl.includes('autonumber off'), 'autonumber 不被消息文本关闭');
}
{
  const spec = makeSpec({
    participants: [participant('a', 'A'), participant('b', 'B')],
    messages: [
      message('a', 'b', 'Start', { activation: { activatesTo: true } }),
      { frame: true, kind: 'loop', label: 'Retry up to three times', messages: [message('b', 'a', 'Tick')] },
      { frame: true, kind: 'opt', label: 'Only when flagged', messages: [message('b', 'a', 'Skip')] },
      {
        frame: true,
        kind: 'alt',
        branches: [
          { label: 'Success', messages: [message('b', 'a', 'OK', { arrowKind: 'dashed' })] },
          { label: 'Failure', messages: [message('b', 'a', 'Error', { arrowKind: 'dashed' })] },
        ],
      },
      message('b', 'a', 'Finish', { arrowKind: 'dashed', activation: { deactivatesFrom: true } }),
    ],
  });
  const dsl = mapspecToMermaidSequence(spec);
  assert(dsl.includes('    loop Retry up to three times\n') && dsl.includes('        icm_p2->>icm_p1: Tick'), 'loop 帧纯文本条件 + 缩进子消息');
  assert(dsl.includes('    opt Only when flagged\n'), 'opt 帧输出');
  assert(dsl.includes('    alt Success\n') && dsl.includes('    else Failure\n') && /\n    end/.test(dsl), 'alt/else/end 帧输出');
  assert((dsl.match(/\n    end/g) || []).length === 3, '三个帧各有一个 end');
  // 外层激活包帧:激活后、去激活前存在任意帧(端点均为内部安全 ID)。
  const lines = dsl.split('\n');
  const activateIndex = lines.findIndex((l) => l.includes('->>+icm_p2'));
  const deactivateIndex = lines.findIndex((l) => l.includes('-->>-icm_p1'));
  const frameIndex = lines.findIndex((l) => l.startsWith('    loop'));
  assert(activateIndex > -1 && frameIndex > activateIndex && deactivateIndex > frameIndex, '外层激活包住整帧(声明序)');
}
{
  // 嵌套帧一层(loop > alt)
  const spec = makeSpec({
    participants: [participant('a', 'A'), participant('b', 'B')],
    messages: [
      {
        frame: true,
        kind: 'loop',
        label: 'Outer',
        messages: [
          {
            frame: true,
            kind: 'alt',
            branches: [
              { label: 'Yes', messages: [message('a', 'b', 'Hi')] },
              { label: 'No', messages: [message('b', 'a', 'Bye')] },
            ],
          },
        ],
      },
    ],
  });
  const dsl = mapspecToMermaidSequence(spec);
  assert(dsl.includes('    loop Outer\n') && dsl.includes('        alt Yes\n') && dsl.includes('        else No\n'), '嵌套帧缩进一层');
}

// ---------- 消息注入向量(注入攻击固化:结构未变 + 编码后原文可见) ----------
console.log('== 消息文本注入向量(编码后拼接,结构合同) ==');
const injectionVectors = [
  { input: 'x; participant C', encoded: 'x#59; participant C' },
  { input: 'x; autonumber off', encoded: 'x#59; autonumber off' },
  { input: 'path#anchor', encoded: 'path#35;anchor' },
  { input: 'a & b', encoded: 'a #38; b' },
  { input: 'q="value"', encoded: 'q=#34;value#34;' },
  { input: 'a < b', encoded: 'a #60; b' },
  { input: '$$x$$', encoded: '#36;#36;x#36;#36;' },
  { input: 'wrap: retry', encoded: 'wrap#58; retry' },
  { input: '%%{init}%%', encoded: '#37;#37;{init}#37;#37;' },
  { input: '完成率 50%', encoded: '完成率 50#37;' },
];
for (const vector of injectionVectors) {
  const spec = makeSpec({
    participants: [participant('a', 'A'), participant('b', 'B')],
    messages: [message('a', 'b', vector.input)],
  });
  const dsl = mapspecToMermaidSequence(spec);
  const participantCount = (dsl.match(/^    participant /gm) || []).length;
  const lineCount = (dsl.match(/->>/g) || []).length;
  assert(participantCount === 2, `${JSON.stringify(vector.input)} 不新增参与者(结构未变)`);
  assert(lineCount === 1, `${JSON.stringify(vector.input)} 消息线数量不变`);
  assert(dsl.includes(vector.encoded), `${JSON.stringify(vector.input)} 以编码实体进入 DSL(原文经实体完整可见)`);
}

// ---------- 参与者别名注入向量 ----------
console.log('== 参与者别名注入向量 ==');
for (const vector of [
  { input: 'A&B', encoded: 'A#38;B' },
  { input: 'q="v"', encoded: 'q=#34;v#34;' },
  { input: 'wrap: retry', encoded: 'wrap#58; retry' },
  { input: '%%{init}%%', encoded: '#37;#37;{init}#37;#37;' },
]) {
  const spec = makeSpec({
    participants: [participant('a', vector.input), participant('b', 'B')],
    messages: [message('a', 'b', 'call')],
  });
  const dsl = mapspecToMermaidSequence(spec);
  assert(dsl.includes('participant icm_p1 as ' + vector.encoded), `参与者 title ${JSON.stringify(vector.input)} 编码后进入 DSL`);
  assert((dsl.match(/^    participant /gm) || []).length === 2, `参与者 title ${JSON.stringify(vector.input)} 不新增参与者语句`);
}

// ---------- 帧条件注入向量:防御断言拒绝 ----------
console.log('== 帧条件注入向量(生成器 fail closed) ==');
for (const vector of [
  { kind: 'loop', field: 'label', value: 'retry\nparticipant C' },
  { kind: 'loop', field: 'label', value: 'retry\nautonumber off' },
  { kind: 'loop', field: 'label', value: 'retry %%{init}%% visible' },
  { kind: 'opt', field: 'label', value: 'a & b' },
  { kind: 'opt', field: 'label', value: 'q="value"' },
]) {
  const spec = makeSpec({
    participants: [participant('a', 'A'), participant('b', 'B')],
    messages: [{
      frame: true,
      kind: vector.kind,
      [vector.field]: vector.value,
      messages: [message('a', 'b', 'call')],
    }],
  });
  assertThrows(() => mapspecToMermaidSequence(spec), `帧条件 ${JSON.stringify(vector.value)} 被生成器断言拒绝`);
}
for (const vector of [
  { label: 'branch\nparticipant C' },
  { label: 'branch; autonumber off' },
]) {
  const spec = makeSpec({
    participants: [participant('a', 'A'), participant('b', 'B')],
    messages: [{
      frame: true,
      kind: 'alt',
      branches: [
        { label: vector.label, messages: [message('a', 'b', 'call')] },
        { label: 'normal', messages: [message('a', 'b', 'call2')] },
      ],
    }],
  });
  assertThrows(() => mapspecToMermaidSequence(spec), `alt 分支条件 ${JSON.stringify(vector.label)} 被生成器断言拒绝`);
}

// ---------- 递归路径选择键 ----------
console.log('== 递归路径选择键 ==');
{
  const spec = makeSpec({
    participants: [participant('a', 'A'), participant('b', 'B')],
    messages: [
      message('a', 'b', 'one'),
      {
        frame: true,
        kind: 'alt',
        branches: [
          { label: 'yes', messages: [message('a', 'b', 'two'), { frame: true, kind: 'opt', label: 'inner', messages: [message('a', 'b', 'three')] }] },
          { label: 'no', messages: [message('a', 'b', 'four')] },
        ],
      },
      message('a', 'b', 'five'),
    ],
  });
  const keys = sequenceMessagesInOrder(spec).map((entry) => entry.key);
  assert(JSON.stringify(keys) === JSON.stringify(['1', '2.1', '2.2.1', '2.3', '3']), `路径制选择键为 ${JSON.stringify(keys)}`);
  const labels = sequenceMessagesInOrder(spec).map((entry) => entry.message.label);
  assert(JSON.stringify(labels) === JSON.stringify(['one', 'two', 'three', 'four', 'five']), '深度优先展开顺序与声明一致(分支不占路径位)');
}

// ---------- 编码器与 flowchart 编码器互不复用 ----------
console.log('== 与 flowchart 编码器隔离 ==');
{
  const flowchartDsl = (await import('../../skill/renderer/mermaid-encoder.mjs')).encodeMermaidText('a; b');
  assert(flowchartDsl === 'a; b', 'flowchart 编码器保持不动(分号不处理)');
  assert(encodeSequenceLiteralText('a; b') === 'a#59; b', 'sequence 编码器独立处理分号');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
