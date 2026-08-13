import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeMermaidText, safeSubgraphId } from '../../skill/renderer/mermaid-encoder.mjs';
import { mapspecToMermaid } from '../../skill/renderer/mapspec-to-mermaid.mjs';

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

function specWithInjection(field, text) {
  const spec = {
    schemaVersion: 1,
    meta: { title: 't', question: 'q', scope: 's', languageProfile: 'js', summary: 'a' },
    nodes: [{
      id: 'n1',
      title: 'normal',
      claimState: 'inferred',
      evidence: [{ path: 'a.js', state: 'inferred' }],
      detail: { summary: 's', segments: [] },
    }],
  };
  if (field === 'subgraph') {
    spec.nodes[0].subgraph = text;
    spec.nodes[0].title = text;
  } else if (field === 'nodeTitle') {
    spec.nodes[0].title = text;
  } else if (field === 'edgeLabel') {
    spec.edges = [{
      from: 'n1',
      to: 'n1',
      label: text,
      claimState: 'inferred',
      evidence: [{ path: 'a.js', state: 'inferred' }],
    }];
  }
  return spec;
}

console.log('== Mermaid DSL 注入向量(build-rules 7 条,对完整 DSL 断言) ==');
for (const vector of buildRules.mermaidDslInjectionValidation.acceptanceTestVectors) {
  const spec = specWithInjection(vector.field, vector.input);
  const dsl = mapspecToMermaid(spec);
  const subgraphOpen = (dsl.match(/^  subgraph /gm) || []).length;
  const subgraphClose = (dsl.match(/^  end$/gm) || []).length;
  const nodeCountInDsl = (dsl.match(/^\s+\w+\["/gm) || []).length;
  const edgeCountInDsl = (dsl.match(/-->/g) || []).length;
  const structureOk = subgraphOpen === subgraphClose
    && nodeCountInDsl === spec.nodes.length
    && edgeCountInDsl === (spec.edges || []).length;
  const encoded = encodeMermaidText(vector.input);
  const literalOk = dsl.includes(encoded);

  if (vector.assertions.includes('structurePreserved')) {
    assert(structureOk, `${vector.field} ${JSON.stringify(vector.input)} 结构保持`);
  }
  if (vector.assertions.includes('literalVisible')) {
    assert(literalOk, `${vector.field} ${JSON.stringify(vector.input)} 字面可见`);
  }
  if (vector.assertions.includes('safeSubgraphId')) {
    assert(/^  subgraph sg\d+\["/m.test(dsl), `${vector.field} 使用安全 subgraph ID`);
    const escaped = vector.input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert(!new RegExp(`^  subgraph ${escaped} `, 'm').test(dsl), `${vector.field} 用户文本未作为 subgraph ID`);
  }
}

console.log('\n== 编码正确性 ==');
assert(encodeMermaidText('普通标题') === '普通标题', '正常文本不变');
assert(!encodeMermaidText('a --> b').includes('-->'), '"-->" 被编码');
assert(!encodeMermaidText('a---b').includes('---'), '"---" 被编码');
assert(encodeMermaidText('a --> b').includes('&gt;'), '">" 编码为 &gt;');
assert(!/\n/.test(encodeMermaidText('a\nb')), '换行被编码');
assert(encodeMermaidText('a\nb').includes('a') && encodeMermaidText('a\nb').includes('b'), '换行两侧文本仍可见');
assert(!encodeMermaidText('%%{init}%%').includes('%%{'), 'Mermaid 指令前缀被破坏');

console.log('\n== 安全 subgraph ID ==');
const ids = safeSubgraphId(['Orders', 'Orders', 'Payments']);
assert(ids.get('Orders') === 'sg1' && ids.get('Payments') === 'sg2', '相同分组稳定去重并按首次出现编号');

console.log('\n== 阶段布局策略 ==');
const stageSpec = {
  nodes: [
    { id: 's1', title: 'A', subgraph: 'Stage A', claimState: 'verified' },
    { id: 's2', title: 'B', subgraph: 'Stage B', claimState: 'verified' },
    { id: 's3', title: 'C', subgraph: 'Stage C', claimState: 'verified' },
    { id: 's4', title: 'D', subgraph: 'Stage D', claimState: 'verified' },
  ],
  edges: [
    { from: 's1', to: 's2' },
    { from: 's1', to: 's3' },
    { from: 's2', to: 's4' },
  ],
};
const stageDsl = mapspecToMermaid(stageSpec);
assert(stageDsl.startsWith('flowchart TD'), '阶段图使用 Mermaid TD 分层布局');
assert(!stageDsl.includes('icm_layout_row_'), '阶段图不注入会改变边路由的布局容器');
assert(!stageDsl.includes('direction LR') && !stageDsl.includes('direction RL'), '阶段图不强制横向或蛇形方向');
const leftToRightDsl = mapspecToMermaid({
  ...stageSpec,
  meta: { layoutDirection: 'LR' },
});
assert(leftToRightDsl.startsWith('flowchart LR'), 'MapSpec 可显式选择主流程从左到右推进');
assert(leftToRightDsl.includes('direction TB'), '横向主流程中的分组步骤保持自上而下阅读');
const bandedDsl = mapspecToMermaid({
  ...stageSpec,
  meta: {
    layoutDirection: 'TD',
    layoutBands: [
      { title: 'Preparation', direction: 'LR', subgraphs: ['Stage A', 'Stage B'] },
      { title: 'Completion', direction: 'RL', subgraphs: ['Stage C', 'Stage D'] },
    ],
  },
});
assert(bandedDsl.startsWith('flowchart TD'), '语义阶段带保持外层 TD 分层');
assert(bandedDsl.includes('subgraph icm_layout_band_1["Preparation"]')
  && bandedDsl.includes('subgraph icm_layout_band_2["Completion"]'), '语义阶段带使用明确的父分组');
assert(bandedDsl.includes('    direction LR') && bandedDsl.includes('    direction RL'), '阶段带可分别表达左右阅读顺序');
assert((bandedDsl.match(/      direction TB/g) || []).length === 4, '阶段带内每个真实业务分组保持纵向步骤阅读');
assert(!bandedDsl.includes('icm_layout_row_'), '语义阶段带不注入无业务含义的蛇形布局容器');

console.log('\n== mapspecToMermaid 完整输出 ==');
{
  const spec = {
    schemaVersion: 1,
    meta: { title: 't', question: 'q', scope: 's', languageProfile: 'js', summary: 'a' },
    nodes: [
      { id: 'n1', title: 'A', subgraph: 'Group One', claimState: 'verified', evidence: [{ path: 'a.js', state: 'verified' }], detail: { summary: 's', segments: [] } },
      { id: 'n2', title: 'B', subgraph: 'Group One', claimState: 'inferred', evidence: [{ path: 'a.js', state: 'inferred' }], detail: { summary: 's', segments: [] } },
      { id: 'n3', title: 'C', claimState: 'unconfirmed', evidence: [{ path: 'a.js', state: 'unconfirmed' }], detail: { summary: 's', segments: [] } },
    ],
    edges: [{ from: 'n1', to: 'n2', label: 'calls', labelKind: 'action', claimState: 'verified', evidence: [{ path: 'a.js', state: 'verified' }], }],
  };
  const dsl = mapspecToMermaid(spec);
  assert(dsl.startsWith('flowchart TD'), 'DSL 以 flowchart TD 开头');
  assert(dsl.includes('subgraph sg1["'), '第一个 subgraph 使用 sg1');
  assert(dsl.includes('n1["A"]:::icm-state-verified'), '节点 n1 带 verified class');
  assert(dsl.includes('n1 -->|"calls"| n2'), '边 n1→n2 带标签');
  assert(dsl.includes('n3["C"]:::icm-state-unconfirmed'), '无 subgraph 节点输出在外层');
  assert(dsl.includes('icm-state-inferred'), 'inferred 状态 class 被输出');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
