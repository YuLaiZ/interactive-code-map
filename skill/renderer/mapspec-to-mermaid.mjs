/**
 * MapSpec → Mermaid flowchart DSL。
 *
 * 本模块只负责确定性文本转换；MapSpec 的结构、证据与隐私校验由
 * validate-map-spec.mjs 在调用前完成。
 */
import { encodeMermaidText, safeSubgraphId } from './mermaid-encoder.mjs';

function orderedSubgraphTexts(nodes) {
  const subgraphTexts = [];
  for (const node of nodes) {
    if (node.subgraph && !subgraphTexts.includes(node.subgraph)) {
      subgraphTexts.push(node.subgraph);
    }
  }
  return subgraphTexts;
}

function appendSubgraph(lines, displayText, id, nodes, indent, forceVerticalSteps) {
  lines.push(`${indent}subgraph ${id}["${encodeMermaidText(displayText)}"]`);
  if (forceVerticalSteps) lines.push(`${indent}  direction TB`);
  for (const node of nodes) {
    if (node.subgraph === displayText) {
      lines.push(`${indent}  ${node.id}["${encodeMermaidText(node.title)}"]:::icm-state-${node.claimState}`);
    }
  }
  lines.push(`${indent}end`);
}

function usableLayoutBands(spec, subgraphTexts) {
  const candidate = spec && spec.meta && spec.meta.layoutBands;
  if (!Array.isArray(candidate) || candidate.length === 0) return [];
  const known = new Set(subgraphTexts);
  const used = new Set();
  const bands = [];
  for (const band of candidate) {
    if (!band || typeof band !== 'object'
      || typeof band.title !== 'string' || !band.title
      || (band.direction !== 'LR' && band.direction !== 'RL')
      || !Array.isArray(band.subgraphs) || band.subgraphs.length === 0) return [];
    const subgraphs = [];
    for (const name of band.subgraphs) {
      if (typeof name !== 'string' || !known.has(name) || used.has(name)) return [];
      used.add(name);
      subgraphs.push(name);
    }
    bands.push({ title: band.title, direction: band.direction, subgraphs });
  }
  return used.size === known.size ? bands : [];
}

export function mapspecToMermaid(spec) {
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const edges = Array.isArray(spec.edges) ? spec.edges : [];
  const subgraphTexts = orderedSubgraphTexts(nodes);
  const subgraphs = safeSubgraphId(subgraphTexts);
  const layoutBands = usableLayoutBands(spec, subgraphTexts);
  const hasLayoutBands = layoutBands.length > 0;
  const layoutDirection = hasLayoutBands ? 'TD' : (spec?.meta?.layoutDirection === 'LR' ? 'LR' : 'TD');
  const lines = ['flowchart ' + layoutDirection];
  const nodeLine = (node, indent) => `${indent}${node.id}["${encodeMermaidText(node.title)}"]:::icm-state-${node.claimState}`;

  // 直接输出真实业务分组，保留真实的分流、汇合和跨阶段关系。只有 MapSpec 明确
  // 提供具业务语义的阶段带时才嵌套；不要自动注入纯排版的“布局分组”强行折蛇形。
  const emittedSubgraphs = new Set();
  for (let index = 0; index < layoutBands.length; index += 1) {
    const band = layoutBands[index];
    lines.push(`  subgraph icm_layout_band_${index + 1}["${encodeMermaidText(band.title)}"]`);
    lines.push(`    direction ${band.direction}`);
    for (const displayText of band.subgraphs) {
      appendSubgraph(lines, displayText, subgraphs.get(displayText), nodes, '    ', true);
      emittedSubgraphs.add(displayText);
    }
    lines.push('  end');
  }
  for (const [displayText, id] of subgraphs) {
    if (emittedSubgraphs.has(displayText)) continue;
    // 宏观 LR 表达业务阶段的横向推进；每个阶段内的业务步骤仍按 TB 阅读。
    appendSubgraph(lines, displayText, id, nodes, '  ', layoutDirection === 'LR');
  }

  for (const node of nodes) {
    if (!node.subgraph) lines.push(nodeLine(node, '  '));
  }

  for (const edge of edges) {
    const label = edge.label ? `|"${encodeMermaidText(edge.label)}"|` : '';
    lines.push(`  ${edge.from} -->${label} ${edge.to}`);
  }

  return lines.join('\n');
}
