/**
 * Mermaid sequenceDiagram 文本编码器（与 flowchart 的 mermaid-encoder.mjs 互不复用）。
 *
 * flowchart 编码器服务于引号标签上下文;sequence 的消息文本/参与者别名是裸
 * 语句上下文,复用它会把 `;` 语句分隔、`#` 实体前缀、`&amp;`/`&quot;` 实体、
 * `<br/>` 换行等结构走私进 DSL(已在 Mermaid 11.16.1 逐项复现)。
 *
 * 上下文分级(字面文本合同,逐项经 Mermaid 11.16.1 锁定版本验证):
 *  - 消息文本与参与者别名:`encodeSequenceLiteralText` — Mermaid `#code;` 实体
 *    语法,9 字符表,**单遍历字符映射**。链式 replace 会对自身输出中的 `#` 与
 *    `;` 二次转义,禁止。
 *  - 帧条件(loop/opt/alt/else 的条件文本):**纯文本直出**,不做实体编码——
 *    实体处于超过帧宽的连续长词内部时会被窄帧自动换行按字符拆出残片,且
 *    `sequence.wrap: false` 不可救。特殊字符与换行由 MapSpec 校验层拒绝,
 *    生成器另经 `assertSequenceFrameConditionText` 防御性断言(纵深防御)。
 *
 * 编码表与 skill/references/mapspec-v1.build-rules.json 的
 * sequenceDiagramContract.literalTextEncoding.entityMap 保持一致,由
 * tests/build/mermaid-sequence.test.mjs 锁定两者一致。
 *
 * 本模块会被 build-html.mjs 内联进单文件产物(stripModuleSyntax:仅允许单行
 * 命名 import 与 export function),不得引入浏览器不可用的语法。
 */

const SEQUENCE_ENTITY_MAP = new Map([
  ['&', '#38;'],
  [';', '#59;'],
  ['#', '#35;'],
  ['"', '#34;'],
  ['<', '#60;'],
  ['>', '#62;'],
  ['$', '#36;'],
  [':', '#58;'],
  ['%', '#37;'],
]);

// % 的威胁模型特殊:%%{…}%% 被 Mermaid removeDirectives 静默删除,不破坏结构、
// 不改变计数、不产生 foreignObject,只有「原文完整可见」断言能捕获。
export function sequenceEntityMap() {
  return SEQUENCE_ENTITY_MAP;
}

/**
 * 消息文本与参与者别名编码:9 字符单遍历映射为 `#code;` 实体。
 * 按 Unicode 码点迭代(for...of),代理对(emoji 等)作为整体保留。
 */
export function encodeSequenceLiteralText(text) {
  if (typeof text !== 'string') return '';
  let out = '';
  for (const ch of text) {
    out += SEQUENCE_ENTITY_MAP.has(ch) ? SEQUENCE_ENTITY_MAP.get(ch) : ch;
  }
  return out;
}

/**
 * 防御纵深:生成器在拼接任何用户文本前断言其单行(换行注入 DSL 语句)。
 * 校验层已拒绝,这里 fail closed——发现残留即抛错,绝不静默清洗。
 */
export function assertSequenceSingleLineText(text, fieldLabel) {
  if (typeof text !== 'string' || !/[\n\r]/.test(text)) return;
  throw new Error(`sequence ${fieldLabel} 含换行(显示文本必须单行): ${JSON.stringify(text)}`);
}

/**
 * 防御纵深:帧条件纯文本直出,拼接前断言无 9 个禁用字符与换行。
 * 实体会被窄帧 wrapLabel 拆坏、$ 触发数学渲染、: 被 wrap:/nowrap: 消费、
 * % 被指令预处理删除;校验层已拒绝,这里 fail closed。
 */
export function assertSequenceFrameConditionText(text, fieldLabel) {
  assertSequenceSingleLineText(text, fieldLabel);
  if (typeof text !== 'string') return;
  for (const ch of text) {
    if (SEQUENCE_ENTITY_MAP.has(ch)) {
      throw new Error(`sequence ${fieldLabel} 含帧条件禁用字符(${ch}): ${JSON.stringify(text)}`);
    }
  }
}
