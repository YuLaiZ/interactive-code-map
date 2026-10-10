/**
 * MapSpec → Mermaid sequenceDiagram DSL。
 *
 * 本模块只负责确定性文本转换;MapSpec 的结构、证据、文本合同与 activation
 * 配平校验由 validate-map-spec.mjs 在调用前完成。生成器对显示文本另行断言
 * (单行 + 帧条件字符合同),对结构畸形宽松降级——与 flowchart 生成器同风格,
 * 但用户文本一律经 mermaid-sequence-encoder.mjs,不存在第二处字符串组装。
 *
 * 参与者 ID 确定性映射(经 Mermaid 11.16.1 验证):现有节点 ID 正则的合法值可能与 sequence
 * 语法关键字冲突(end/loop/alt/autonumber/participant 直接作端点会解析失败),
 * 按声明序映射为内部安全 ID icm_p1、icm_p2…,participant 行与消息端点一律
 * 使用内部 ID;MapSpec、选择键、证据与详情面板全程只使用原始 id。
 *
 * activation 内联语法(经 Mermaid 11.16.1 验证):
 *   activatesTo   → `from->>+to:`(+ 前缀于 to 方,激活 to)
 *   deactivatesFrom → `from-->>-to:`(- 前缀于 to 方,但去激活的是 from 方——
 *     `B-->>-A` 报 Trying to inactivate an inactive participant (B) 即此语义)
 *   两布尔同真(A->>+-B)在锁定版本解析失败,校验层已拒绝。
 *   帧内禁带 activation;外层激活包住整帧是允许且推荐的建模。
 *
 * 本模块会被 build-html.mjs 内联进单文件产物(stripModuleSyntax:仅允许单行
 * 命名 import 与 export function)。
 */
import { encodeSequenceLiteralText, assertSequenceSingleLineText, assertSequenceFrameConditionText } from './mermaid-sequence-encoder.mjs';

const MAX_FRAME_DEPTH = 2;
const INDENT_UNIT = '    ';

function internalParticipantId(index) {
  return 'icm_p' + (index + 1);
}

function buildInternalIdMap(participants) {
  const ids = new Map();
  if (Array.isArray(participants)) {
    participants.forEach(function mapParticipant(participant, index) {
      if (participant && typeof participant.id === 'string' && !ids.has(participant.id)) {
        ids.set(participant.id, internalParticipantId(index));
      }
    });
  }
  return ids;
}

function appendMessage(lines, message, internalIds, indent, depth) {
  const from = internalIds.get(message.from) || message.from;
  const to = internalIds.get(message.to) || message.to;
  const arrow = message.arrowKind === 'dashed' ? '-->>' : '->>';
  // Mermaid 内联 activation 的语法位置(在 Mermaid 11.16.1 复现确认):
  //   activatesTo   → `from->>+to:`(+ 前缀于 to 方,激活 to)
  //   deactivatesFrom → `from-->>-to:`(- 前缀于 to 方,但**去激活的是 from 方**;
  //     `B-->>-A` 报 Trying to inactivate an inactive participant (B) 即此语义)
  // 两布尔同真(`A->>+-B`)在锁定版本解析失败,校验层已拒绝,这里同真时按 + 优先。
  const activatesTo = message.activation && message.activation.activatesTo === true;
  const deactivatesFrom = message.activation && message.activation.deactivatesFrom === true;
  const toPrefix = activatesTo ? '+' : (deactivatesFrom ? '-' : '');
  assertSequenceSingleLineText(message.label, "message '" + String(message.label) + "' 的 label");
  lines.push(indent + from + arrow + toPrefix + to + ': ' + encodeSequenceLiteralText(message.label));
  return depth;
}

function appendFrameCondition(lines, keyword, condition, indent) {
  if (condition === undefined || condition === null || condition === '') {
    lines.push(indent + keyword);
    return;
  }
  assertSequenceFrameConditionText(condition, "frame 条件 '" + String(condition) + "'");
  lines.push(indent + keyword + ' ' + condition);
}

function appendFrame(lines, frame, internalIds, indent, depth) {
  if (depth > MAX_FRAME_DEPTH) {
    throw new Error('sequence 帧嵌套深度超过上限 ' + MAX_FRAME_DEPTH);
  }
  const childIndent = indent + INDENT_UNIT;
  if (frame.kind === 'alt') {
    const branches = Array.isArray(frame.branches) ? frame.branches : [];
    branches.forEach(function appendBranch(branch, index) {
      const condition = branch && branch.label;
      if (index === 0) {
        appendFrameCondition(lines, 'alt', condition, indent);
      } else {
        appendFrameCondition(lines, 'else', condition, indent);
      }
      walkSequenceItems(lines, branch && branch.messages, internalIds, childIndent, depth + 1);
    });
    lines.push(indent + 'end');
    return;
  }
  const keyword = frame.kind === 'opt' ? 'opt' : 'loop';
  appendFrameCondition(lines, keyword, frame.label, indent);
  walkSequenceItems(lines, frame.messages, internalIds, childIndent, depth + 1);
  lines.push(indent + 'end');
}

function walkSequenceItems(lines, items, internalIds, indent, depth) {
  if (depth > MAX_FRAME_DEPTH + 1) {
    // 帧内容器允许处于 MAX_FRAME_DEPTH 层(深度 2 的帧内的消息),再深才是畸形。
    throw new Error('sequence 帧嵌套深度超过上限 ' + MAX_FRAME_DEPTH);
  }
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (item.frame === true) {
      appendFrame(lines, item, internalIds, indent, depth);
    } else {
      appendMessage(lines, item, internalIds, indent, depth);
    }
  }
}

/**
 * 生成 sequenceDiagram DSL 文本。autonumber 统一开启;mirrorActors/useMaxWidth
 * 由 render.js 的 mermaid.initialize sequence 配置注入,不进 DSL。
 */
export function mapspecToMermaidSequence(spec) {
  const participants = Array.isArray(spec.participants) ? spec.participants : [];
  const internalIds = buildInternalIdMap(participants);
  const lines = ['sequenceDiagram', INDENT_UNIT + 'autonumber'];
  for (const participant of participants) {
    if (!participant || typeof participant.id !== 'string') continue;
    assertSequenceSingleLineText(participant.title, "participant '" + participant.id + "' 的 title");
    lines.push(INDENT_UNIT + 'participant ' + internalIds.get(participant.id)
      + ' as ' + encodeSequenceLiteralText(participant.title));
  }
  walkSequenceItems(lines, spec.messages, internalIds, INDENT_UNIT, 0);
  return lines.join('\n');
}

/**
 * 递归展开后的声明消息顺序(深度优先),与渲染产物的消息记录按序一一对应。
 * key 是选择键的递归路径部分(1 起始):顶层第 i 个元素为 'i',其中第 j 条
 * 消息为 'i.j',嵌套帧内为 'i.j.k'。alt 的分支不占路径位,分支内消息在帧内
 * 按文档序连续编号。同一端点多条消息、嵌套帧内消息各自持有独立 key,选择与
 * 阅读位置互不串用。
 */
export function sequenceMessagesInOrder(spec) {
  const messages = [];
  const visitFrame = function visitFrame(frame, framePath) {
    let index = 0;
    const visitBranch = function visitBranch(items) {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        index += 1;
        const path = framePath + '.' + index;
        if (item.frame === true) visitFrame(item, path);
        else messages.push({ key: path, message: item });
      }
    };
    visitBranch(frame.messages);
    if (Array.isArray(frame.branches)) {
      for (const branch of frame.branches) {
        visitBranch(branch && branch.messages);
      }
    }
  };
  const visitTop = function visitTop(items) {
    if (!Array.isArray(items)) return;
    let index = 0;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      index += 1;
      const path = String(index);
      if (item.frame === true) visitFrame(item, path);
      else messages.push({ key: path, message: item });
    }
  };
  visitTop(spec && Array.isArray(spec.messages) ? spec.messages : []);
  return messages;
}
