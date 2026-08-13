/**
 * Mermaid DSL 文本编码器。
 *
 * 所有进入 Mermaid DSL 的用户文本都必须经过本模块；它保证输入仍可读，
 * 但不会形成新的 DSL 结构行、边语法或 Mermaid 指令。
 */
export function encodeMermaidText(text) {
  if (typeof text !== 'string') return '';

  let value = text;
  // 先转义 HTML 语义字符，后续添加的 Mermaid 可读实体不被二次转义。
  value = value.replace(/&/g, '&amp;');
  value = value.replace(/</g, '&lt;');
  value = value.replace(/>/g, '&gt;');
  // 破坏 Mermaid 的边语法。保留前两个连字符使文本视觉上仍容易辨认。
  value = value.replace(/-{3,}/g, (match) => `--${'&#45;'.repeat(match.length - 2)}`);
  value = value.replace(/\r?\n/g, '<br/>');
  value = value.replace(/%%\{/g, '%% {');
  value = value.replace(/"/g, '&quot;');
  return value;
}

/**
 * 将用户提供的 subgraph 显示文本映射为 Mermaid 内部 ID。
 * 相同显示文本稳定去重，编号取首次出现顺序。
 */
export function safeSubgraphId(userTexts) {
  const ids = new Map();
  let number = 1;
  for (const text of userTexts) {
    if (!ids.has(text)) ids.set(text, `sg${number++}`);
  }
  return ids;
}
