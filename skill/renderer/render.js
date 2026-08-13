/*
 * 浏览器端渲染器。
 *
 * 这个文件作为普通 script 内联到产物中。React、ReactDOM 与 Mermaid 都在
 * depsLoader 成功后才读取，避免依赖失败时脚本求值阶段就抛异常。
 */
(function () {
  'use strict';

  const GROUP_TITLE_HORIZONTAL_INSET_PX = 8;
  const GROUP_TITLE_VERTICAL_INSET_PX = 10;
  const GROUP_TITLE_NODE_GAP_PX = 12;
  const EDGE_LABEL_TITLE_GAP_PX = 16;
  const EDGE_LABEL_CLUSTER_GAP_PX = 8;
  const EDGE_LABEL_DOWNSTREAM_GAP_PX = 12;
  const CROSS_GROUP_EDGE_LABEL_GAP_PX = 8;
  const CROSS_GROUP_LABEL_BOX_SAFETY_PX = 4;
  const EDGE_LABEL_AMBIGUITY_PATH_GAP_PX = 12;
  const EDGE_LABEL_AMBIGUITY_OFFSET_PX = 18;
  const EDGE_LABEL_AMBIGUITY_MAX_OFFSET_PX = 34;
  const EDGE_LABEL_AMBIGUITY_DIAGONAL_OFFSET_PX = 24;
  // 条件仍贴在自己的边上、且附近没有别的边时，直接贴线反而最清楚，不需要补一根
  // 装饰性引线。只有真正离开所属边后，才要求条件框与所有边留出可见净空。
  const EDGE_LABEL_NATURAL_FOREIGN_PATH_GAP_PX = 12;
  const EDGE_LABEL_DETACHED_PATH_GAP_PX = 7;
  const EDGE_LABEL_AMBIGUITY_LEADER_MIN_LENGTH_PX = 18;
  // 条件胶囊有描边和阴影。引线只停在 geometry 的边界时，视觉上会像还差一截；
  // 让末端轻微进入可见边缘，确保“线确实接到条件框”这一关系不留歧义。
  const EDGE_LABEL_LEADER_TERMINAL_OVERLAP_PX = 1.5;
  // 条件标签从交叉区移开后，引线锚点也必须落在独占的边段上。否则即使有圆点，
  // 圆点仍可能恰好压在分叉/交叉处，读者无法判断它究竟属于哪一条边。
  const EDGE_LABEL_ANCHOR_FOREIGN_PATH_CLEARANCE_PX = 18;
  const EDGE_LABEL_LEADER_FOREIGN_PATH_CLEARANCE_PX = 10;
  const EDGE_LABEL_PATH_SAMPLE_SPACING_PX = 6;
  const EDGE_LABEL_PATH_SAMPLE_MAX_COUNT = 160;
  const OFFSET_EPSILON_PX = 0.01;

  let selectedNodeId = null;
  let lastFocusedNodeEl = null;
  let boundNodeElements = [];
  let reactRoot = null;
  const selectedListeners = new Set();

  function notifySelection(id) {
    for (const listener of selectedListeners) listener(id);
  }

  function syncSelectedNodeAttributes() {
    for (const nodeEl of boundNodeElements) {
      nodeEl.setAttribute('aria-pressed', String(nodeEl.getAttribute('data-node-id') === selectedNodeId));
      nodeEl.classList.toggle('icm-node-selected', nodeEl.getAttribute('data-node-id') === selectedNodeId);
    }
  }

  function setSelected(id, nodeEl) {
    selectedNodeId = id;
    if (nodeEl) lastFocusedNodeEl = nodeEl;
    syncSelectedNodeAttributes();
    notifySelection(id);
  }

  function onSelectedChange(listener) {
    selectedListeners.add(listener);
    return function unsubscribe() {
      selectedListeners.delete(listener);
    };
  }

  function clearSelection() {
    const previous = lastFocusedNodeEl;
    selectedNodeId = null;
    syncSelectedNodeAttributes();
    notifySelection(null);
    if (previous && typeof previous.focus === 'function') previous.focus();
  }

  function showFailPage() {
    const failure = document.getElementById('fail-page');
    const viewport = document.getElementById('graph-viewport');
    const app = document.getElementById('app');
    if (failure) failure.hidden = false;
    if (viewport) viewport.hidden = true;
    if (app) app.hidden = true;
  }

  function loadScript(source) {
    return new Promise(function load(resolve, reject) {
      if (!source || !source.url || !source.integrity || source.crossorigin !== 'anonymous') {
        reject(new Error('依赖源缺少 URL、SRI 或匿名跨域配置'));
        return;
      }
      if (!Number.isSafeInteger(source.timeoutMs) || source.timeoutMs < 1_000 || source.timeoutMs > 30_000) {
        reject(new Error('依赖源超时配置无效'));
        return;
      }
      const script = document.createElement('script');
      let settled = false;
      let timeoutId = null;
      function cleanup(removeScript) {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        script.onload = null;
        script.onerror = null;
        if (removeScript) script.remove();
      }
      function succeed() {
        if (settled) return;
        settled = true;
        cleanup(false);
        resolve();
      }
      function fail(message) {
        if (settled) return;
        settled = true;
        cleanup(true);
        reject(new Error(message));
      }
      script.src = source.url;
      script.integrity = source.integrity;
      script.crossOrigin = source.crossorigin;
      script.onload = succeed;
      script.onerror = function onError() { fail('网络或 SRI 校验失败'); };
      timeoutId = window.setTimeout(function onTimeout() {
        fail('加载超时(' + source.timeoutMs + 'ms)');
      }, source.timeoutMs);
      document.head.appendChild(script);
    });
  }

  function dependencyGlobalIsReady(name) {
    if (name === 'react') return typeof window.React !== 'undefined';
    if (name === 'react-dom') return typeof window.ReactDOM !== 'undefined' && typeof window.React !== 'undefined';
    if (name === 'mermaid') return typeof window.mermaid !== 'undefined';
    return true;
  }

  async function depsLoader(depsConfig) {
    if (!Array.isArray(depsConfig)) throw new Error('依赖配置无效');
    for (const dependency of depsConfig) {
      let loaded = false;
      const sources = Array.isArray(dependency.sources) ? dependency.sources : [];
      for (const source of sources) {
        try {
          await loadScript(source);
          if (!dependencyGlobalIsReady(dependency.name)) {
            throw new Error('脚本已加载但未暴露预期全局对象');
          }
          loaded = true;
          break;
        } catch (error) {
          console.warn('[icm] 依赖 ' + dependency.name + ' 源 ' + (source && source.url) + ' 加载失败(' + error.message + ')，尝试下一源');
        }
      }
      if (!loaded) {
        showFailPage();
        throw new Error('依赖 ' + dependency.name + ' 全部源加载失败');
      }
    }
  }

  async function renderGraph(spec, container) {
    if (!window.mermaid) throw new Error('Mermaid 依赖尚未加载');
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: true,
      flowchart: {
        useMaxWidth: false,
        // 让跨组连线的条件标签有独立的呼吸区，也为组内横向分支留出间距。
        rankSpacing: 76,
        nodeSpacing: 56,
        // 在布局阶段保留标题区，使标题与组内首节点天然分层，
        // 不依赖后续移动 SVG 元素来换取间距。
        subGraphTitleMargin: { top: 10, bottom: 52 },
      },
    });
    const rendered = await window.mermaid.render('icm-graph', mapspecToMermaid(spec));
    container.innerHTML = rendered.svg;
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('Mermaid 未生成 SVG');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', spec.meta.title);
    svg.setAttribute('data-icm-ui-locale', uiLocaleForSpec(spec));
    const hasLayoutBands = Array.isArray(spec.meta.layoutBands) && spec.meta.layoutBands.length > 0;
    svg.setAttribute('data-icm-stage-layout', hasLayoutBands ? 'banded' : (spec.meta.layoutDirection === 'LR' ? 'lr' : 'td'));
    return svg;
  }

  function normalizeSubgraphName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  // 图谱固定 UI 的语言与业务节点文本分离。生成 MapSpec 时由执行 AI 根据本次
  // 交付语言明确写 uiLocale；未提供时保持英文。旧产物的 zh-CN languageProfile
  // 仍按中文处理，避免已有中文图在升级 renderer 后突然变成混合语言。
  function uiLocaleForSpec(spec) {
    const meta = spec && spec.meta || {};
    if (meta.uiLocale === 'zh-CN') return 'zh-CN';
    if (meta.uiLocale === 'en') return 'en';
    return String(meta.languageProfile || '').trim().toLowerCase().replace(/_/g, '-') === 'zh-cn'
      ? 'zh-CN'
      : 'en';
  }

  function uiCopyForLocale(locale) {
    if (locale === 'zh-CN') {
      return {
        graphControls: '图谱控制', zoomIn: '放大', zoomOut: '缩小', fit: '全图', fitAriaLabel: '缩放至完整图谱', closeDetail: '关闭详情',
        interactionHint: '点击图中卡片查看详情', controls: '操作', tabAction: '选择', enterAction: '打开', escapeAction: '关闭',
        ariaLabel: '图谱阅读说明、证据状态与操作图例', reading: '阅读说明', group: '分组',
        condition: '条件', action: '动作关系', internal: '组内关系', evidence: '证据状态',
        verified: '已验证', inferred: '推断', unconfirmed: '待确认', emptyDetail: '暂无更多详情。',
      };
    }
    return {
      graphControls: 'Graph controls', zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit to screen', fitAriaLabel: 'Fit to screen', closeDetail: 'Close detail',
      interactionHint: 'Click a card for details', controls: 'Controls', tabAction: 'select', enterAction: 'open', escapeAction: 'close',
      ariaLabel: 'Graph reading guide, evidence status, and controls', reading: 'Reading guide', group: 'Group',
      condition: 'Condition', action: 'Action relationship', internal: 'Internal relationship', evidence: 'Evidence status',
      verified: 'verified', inferred: 'inferred', unconfirmed: 'unconfirmed', emptyDetail: 'No further details.',
    };
  }

  function claimStateLabel(locale, state) {
    const copy = uiCopyForLocale(locale);
    return copy[state] || state;
  }

  function buildSubgraphToneMap(spec) {
    const toneBySubgraph = new Map();
    for (const node of spec.nodes) {
      const name = normalizeSubgraphName(node.subgraph);
      if (!name || toneBySubgraph.has(name)) continue;
      toneBySubgraph.set(name, 'icm-subgraph-tone-' + ((toneBySubgraph.size % 6) + 1));
    }
    return toneBySubgraph;
  }

  function applySubgraphTones(svgEl, spec) {
    const toneBySubgraph = buildSubgraphToneMap(spec);
    const layoutBandTitles = new Set((Array.isArray(spec.meta.layoutBands) ? spec.meta.layoutBands : [])
      .map(function titleOf(band) { return normalizeSubgraphName(band && band.title); })
      .filter(Boolean));
    for (const cluster of svgEl.querySelectorAll('g.cluster')) {
      const label = cluster.querySelector(':scope > .cluster-label');
      const name = normalizeSubgraphName(label && label.textContent);
      if (layoutBandTitles.has(name)) {
        cluster.setAttribute('data-icm-layout-band', name);
        cluster.classList.add('icm-layout-band');
        if (label) {
          label.setAttribute('data-icm-layout-band', name);
          label.setAttribute('data-icm-label-kind', 'layout-band');
          label.classList.add('icm-layout-band');
        }
        continue;
      }
      const tone = toneBySubgraph.get(name);
      if (!tone) continue;
      cluster.setAttribute('data-subgraph', name);
      cluster.classList.add(tone);
      if (label) {
        label.setAttribute('data-subgraph', name);
        label.setAttribute('data-icm-label-kind', 'group-title');
        label.classList.add(tone);
        const titleContent = label.querySelector('foreignObject > div');
        if (titleContent) {
          titleContent.setAttribute('data-icm-label-kind', 'group-title');
        }
      }
    }
    return toneBySubgraph;
  }

  function extractNodeId(rawId, nodeElement, nodesById) {
    const dataId = nodeElement.getAttribute('data-id');
    if (dataId && nodesById.has(dataId)) return dataId;
    if (nodesById.has(rawId)) return rawId;
    // Mermaid 11.16.1 会给渲染 ID 加上本次 render 的前缀，例如
    // "icm-graph-flowchart-n1-0"；旧版则可能直接是 "flowchart-n1-0"。
    const match = /(?:^|-)flowchart-([A-Za-z][A-Za-z0-9_-]*)-(\d+)$/.exec(rawId);
    if (match && nodesById.has(match[1])) return match[1];
    return null;
  }

  function bindNodeEvents(svgEl, spec) {
    const nodesById = new Map(spec.nodes.map(function mapNode(node) {
      return [node.id, node];
    }));
    const toneBySubgraph = buildSubgraphToneMap(spec);
    boundNodeElements = [];
    for (const nodeElement of svgEl.querySelectorAll('g.node')) {
      const nodeId = extractNodeId(nodeElement.id || '', nodeElement, nodesById);
      if (!nodeId) continue;
      const node = nodesById.get(nodeId);
      boundNodeElements.push(nodeElement);
      nodeElement.setAttribute('data-node-id', nodeId);
      nodeElement.setAttribute('data-claim-state', node.claimState);
      nodeElement.setAttribute('tabindex', '0');
      nodeElement.setAttribute('role', 'button');
      nodeElement.setAttribute('aria-label', node.title);
      nodeElement.setAttribute('aria-pressed', 'false');
      nodeElement.classList.add('icm-node-state-' + node.claimState);
      if (node.category) {
        nodeElement.setAttribute('data-category', node.category);
      }
      const subgraphName = normalizeSubgraphName(node.subgraph);
      const tone = toneBySubgraph.get(subgraphName);
      if (tone) {
        nodeElement.setAttribute('data-subgraph', subgraphName);
        nodeElement.classList.add(tone);
      }
      nodeElement.addEventListener('click', function onClick() {
        setSelected(nodeId, nodeElement);
      });
      nodeElement.addEventListener('keydown', function onKeydown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setSelected(nodeId, nodeElement);
        }
      });
    }
  }

  function buildMermaidEdgeMap(spec) {
    const edgeByMermaidId = new Map();
    const countByPair = new Map();
    for (const edge of spec.edges) {
      const pair = edge.from + '\u0000' + edge.to;
      const previousCount = countByPair.get(pair) || 0;
      // Mermaid 为同一对节点的首条边编号 0，后续边从 2 起编号。
      const counter = previousCount === 0 ? 0 : previousCount + 1;
      const mermaidId = 'L_' + edge.from + '_' + edge.to + '_' + counter;
      edgeByMermaidId.set(mermaidId, edge);
      countByPair.set(pair, previousCount + 1);
    }
    return edgeByMermaidId;
  }

  function nodeCenterForId(svgEl, nodeId) {
    const node = Array.from(svgEl.querySelectorAll('g.node[data-node-id]')).find(function matchesNode(element) {
      return element.getAttribute('data-node-id') === nodeId;
    });
    if (!node) return null;
    const rect = rectFromElement(node);
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function edgeOrientation(svgEl, edge) {
    const from = nodeCenterForId(svgEl, edge.from);
    const to = nodeCenterForId(svgEl, edge.to);
    if (!from || !to) return 'vertical';
    return Math.abs(to.x - from.x) > Math.abs(to.y - from.y) ? 'horizontal' : 'vertical';
  }

  // Mermaid 为边标签内层 g 写入稳定的 data-id。利用它将 MapSpec 的跨分组关系
  // 映射回 SVG，并按 MapSpec 的 labelKind 把“业务条件”和“动作关系”分成两套
  // 视觉语义；缺省值保持 action，以兼容旧版 MapSpec。
  function annotateEdgeLabels(svgEl, spec) {
    const edgeByMermaidId = buildMermaidEdgeMap(spec);
    const nodesById = new Map(spec.nodes.map(function mapNode(node) {
      return [node.id, node];
    }));
    for (const edgeLabel of svgEl.querySelectorAll('g.edgeLabel')) {
      const label = edgeLabel.querySelector(':scope > g.label[data-id]') || edgeLabel.querySelector('g.label[data-id]');
      const mermaidId = label && label.getAttribute('data-id');
      const edge = mermaidId ? edgeByMermaidId.get(mermaidId) : null;
      if (!edge || !edge.label) continue;
      const fromSubgraph = normalizeSubgraphName(nodesById.get(edge.from)?.subgraph);
      const toSubgraph = normalizeSubgraphName(nodesById.get(edge.to)?.subgraph);
      const isHandoff = fromSubgraph !== toSubgraph;
      const labelKind = edge.labelKind === 'condition' ? 'condition' : 'action';
      edgeLabel.setAttribute('data-icm-edge-id', mermaidId);
      edgeLabel.setAttribute('data-icm-label-kind', labelKind);
      edgeLabel.setAttribute('data-icm-edge-role', isHandoff ? 'handoff' : 'internal');
      // 布局避让仍以“跨组”作为共同集合；condition/action 只负责各自的视觉表达，
      // 因而条件标签也会享受到引线、分组框和密集连线的防碰撞规则。
      edgeLabel.classList.toggle('icm-cross-group-edge-label', isHandoff);
      edgeLabel.classList.toggle('icm-action-edge-label', isHandoff && labelKind === 'action');
      edgeLabel.classList.toggle('icm-condition-edge-label', labelKind === 'condition');
      if (isHandoff) {
        edgeLabel.setAttribute('data-icm-edge-orientation', edgeOrientation(svgEl, edge));
      } else {
        edgeLabel.removeAttribute('data-icm-edge-orientation');
      }
    }
  }

  // 关系线不应只靠线条颜色来区分。在复杂图里，把任意边的标签、实际路径、命中
  // 带和必要的回指元素挂到同一个稳定 ID：鼠标无论落在动作关系、条件框或组内
  // 连线上，都能突出同一条业务关系。条件只是在此通用规则上保留专属的文字语义。
  function bindEdgeHover(svgEl) {
    const conditionLabels = Array.from(svgEl.querySelectorAll('g.edgeLabel[data-icm-label-kind="condition"]'));
    const conditionIds = new Set();
    for (const label of svgEl.querySelectorAll('g.edgeLabel[data-icm-edge-id]')) {
      const edgeId = label.getAttribute('data-icm-edge-id');
      if (!edgeId) continue;
      label.setAttribute('data-icm-hover-edge-id', edgeId);
      label.setAttribute('title', '悬停可突出显示所属关系线');
      if (conditionLabels.includes(label)) {
        conditionIds.add(edgeId);
        label.setAttribute('data-icm-condition-edge-id', edgeId);
      }
    }
    for (const record of edgePaths(svgEl)) {
      const isCondition = conditionIds.has(record.id);
      record.path.setAttribute('data-icm-hover-edge-id', record.id);
      record.path.classList.add('icm-edge-path');
      if (isCondition) {
        record.path.setAttribute('data-icm-condition-edge-id', record.id);
        record.path.classList.add('icm-condition-edge-path');
      }

      // 可见关系线本身较细，在缩小视图下很难准确悬停。覆盖一条完全透明的宽命中
      // 带，保持画面不变，同时让条件、动作和组内关系线都可稳定被悬停。
      let hitTarget = Array.from(record.path.parentNode.querySelectorAll(':scope > path.icm-edge-hit-target'))
        .find(function sameEdge(target) { return target.getAttribute('data-icm-hover-edge-id') === record.id; });
      if (!hitTarget) {
        hitTarget = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitTarget.setAttribute('class', 'icm-edge-hit-target');
        hitTarget.setAttribute('fill', 'none');
        hitTarget.setAttribute('stroke', 'transparent');
        hitTarget.setAttribute('stroke-width', '18');
        hitTarget.setAttribute('pointer-events', 'stroke');
        record.path.after(hitTarget);
      }
      hitTarget.setAttribute('d', record.path.getAttribute('d') || '');
      hitTarget.setAttribute('data-icm-hover-edge-id', record.id);
      hitTarget.classList.toggle('icm-condition-edge-hit-target', isCondition);
      if (isCondition) hitTarget.setAttribute('data-icm-condition-edge-id', record.id);
      else hitTarget.removeAttribute('data-icm-condition-edge-id');
    }
    for (const element of svgEl.querySelectorAll('[data-icm-edge-id]')) {
      const edgeId = element.getAttribute('data-icm-edge-id');
      if (edgeId) element.setAttribute('data-icm-hover-edge-id', edgeId);
    }

    if (svgEl.getAttribute('data-icm-edge-hover-bound') === 'true') return;
    svgEl.setAttribute('data-icm-edge-hover-bound', 'true');
    const edgeIdFor = function edgeIdFor(target) {
      if (!target || typeof target.closest !== 'function') return null;
      return target.closest('[data-icm-hover-edge-id]')?.getAttribute('data-icm-hover-edge-id') || null;
    };
    const setHovered = function setHovered(edgeId, hovered) {
      for (const element of svgEl.querySelectorAll('[data-icm-hover-edge-id]')) {
        const belongsToHoveredEdge = hovered && element.getAttribute('data-icm-hover-edge-id') === edgeId;
        element.classList.toggle('icm-edge-hovered', belongsToHoveredEdge);
        if (element.hasAttribute('data-icm-condition-edge-id')) {
          element.classList.toggle('icm-condition-edge-hovered', belongsToHoveredEdge);
        }
      }
      renderEdgeHoverOutline(svgEl, hovered ? edgeId : null);
    };
    svgEl.addEventListener('pointerover', function highlightEdge(event) {
      const edgeId = edgeIdFor(event.target);
      if (!edgeId || edgeIdFor(event.relatedTarget) === edgeId) return;
      setHovered(edgeId, true);
    });
    svgEl.addEventListener('pointerout', function clearEdgeHighlight(event) {
      const edgeId = edgeIdFor(event.target);
      if (!edgeId || edgeIdFor(event.relatedTarget) === edgeId) return;
      setHovered(edgeId, false);
    });
  }

  // Mermaid 的 edgeLabel 同时包含 HTML foreignObject 和一个矩形 labelBkg。仅靠
  // CSS 背景做动画会被后者遮住或裁成直角；把高亮圈作为 SVG 顶层元素绘制，才能
  // 精确贴合实际胶囊，并以可见的虚线流动表达“当前这一条关系被选中”。条件、
  // 跨组动作与组内关系均使用这一层，避免组内说明只有线条高亮而标签静止。
  function ensureEdgeHoverOutlineLayer(svgEl) {
    let layer = Array.from(svgEl.children).find(function isOutlineLayer(child) {
      return child.matches && child.matches('g.icm-edge-hover-outline-layer');
    });
    if (!layer) {
      layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      layer.setAttribute('class', 'icm-edge-hover-outline-layer');
      layer.setAttribute('aria-hidden', 'true');
      svgEl.appendChild(layer);
    }
    return layer;
  }

  function appendEdgeHoverOutline(svgEl, layer, edgeLabel) {
    const rect = visibleLabelBounds(edgeLabel);
    const topLeft = screenToLocal(svgEl, svgEl, rect.left - 3, rect.top - 3);
    const bottomRight = screenToLocal(svgEl, svgEl, rect.right + 3, rect.bottom + 3);
    const width = Math.max(0, bottomRight.x - topLeft.x);
    const height = Math.max(0, bottomRight.y - topLeft.y);
    if (width <= 0 || height <= 0) return;
    const radius = Math.max(5, height / 2);
    for (const className of ['icm-edge-hover-outline-glow', 'icm-edge-hover-outline-flow']) {
      const outline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      outline.setAttribute('class', className);
      outline.setAttribute('x', String(topLeft.x));
      outline.setAttribute('y', String(topLeft.y));
      outline.setAttribute('width', String(width));
      outline.setAttribute('height', String(height));
      outline.setAttribute('rx', String(radius));
      outline.setAttribute('ry', String(radius));
      layer.appendChild(outline);
    }
  }

  function renderEdgeHoverOutline(svgEl, edgeId) {
    const layer = ensureEdgeHoverOutlineLayer(svgEl);
    layer.replaceChildren();
    if (!edgeId) return;
    for (const edgeLabel of svgEl.querySelectorAll('g.edgeLabel[data-icm-hover-edge-id="' + edgeId + '"]')) {
      appendEdgeHoverOutline(svgEl, layer, edgeLabel);
    }
  }

  function nodeElementForId(svgEl, nodeId) {
    return Array.from(svgEl.querySelectorAll('g.node[data-node-id]')).find(function matchesNode(element) {
      return element.getAttribute('data-node-id') === nodeId;
    }) || null;
  }

  function edgeRecordForId(svgEl, edgeId) {
    return edgePaths(svgEl).find(function matchesEdge(record) {
      return record.id === edgeId;
    }) || null;
  }

  function screenPointAtPathEnd(path, atEnd) {
    if (!path || typeof path.getTotalLength !== 'function' || !path.getScreenCTM()) return null;
    const length = path.getTotalLength();
    if (!Number.isFinite(length)) return null;
    const localPoint = path.getPointAtLength(atEnd ? length : 0);
    const screenPoint = new DOMPoint(localPoint.x, localPoint.y).matrixTransform(path.getScreenCTM());
    return { x: screenPoint.x, y: screenPoint.y };
  }

  function nearestPointOnElementBorder(target, element) {
    if (!target || !element) return null;
    const frame = element.querySelector(':scope > rect') || element;
    const rect = rectFromElement(frame);
    if (!rect.width || !rect.height) return null;
    return nearestPointOnRect(target, rect);
  }

  function ensureHandoffNodePathLayer(svgEl) {
    const graphRoot = svgEl.querySelector('g.root');
    if (!graphRoot) throw new Error('Mermaid SVG 缺少根图层');
    let layer = Array.from(graphRoot.children).find(function isPathLayer(child) {
      return child.matches && child.matches('g.icm-handoff-node-path-layer');
    });
    if (!layer) {
      layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      layer.setAttribute('class', 'icm-handoff-node-path-layer');
      layer.setAttribute('aria-hidden', 'true');
      // Mermaid 的 edgePaths 位于嵌套分组之前，跨组路径穿进分组后会被其填充裁掉。
      // 这层把“同一条原路径”移到节点之后，外层标签随后重新置顶；不再另画补线。
      graphRoot.appendChild(layer);
      const outerLabels = graphRoot.querySelector(':scope > g.edgeLabels');
      if (outerLabels) graphRoot.appendChild(outerLabels);
    }
    return layer;
  }

  function movePathToHandoffLayer(layer, path) {
    if (path.closest('g.icm-handoff-node-path-layer')) return;
    const oldParent = path.parentNode;
    const oldParentMatrix = oldParent && oldParent.getScreenCTM && oldParent.getScreenCTM();
    const layerMatrix = layer.getScreenCTM && layer.getScreenCTM();
    if (!oldParentMatrix || !layerMatrix) return;
    const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    wrapper.setAttribute('class', 'icm-handoff-node-path');
    // path 的 d 是原 edgePaths 父层的局部坐标。移动到可见图层时保留这段父层
    // 变换，才能既避开分组填充，又不改变 Mermaid 已算好的中段曲线坐标。
    const preservedTransform = toDomMatrix(layerMatrix).inverse().multiply(toDomMatrix(oldParentMatrix));
    wrapper.setAttribute('transform', matrixText(preservedTransform));
    layer.appendChild(wrapper);
    wrapper.appendChild(path);
  }

  function elementCenter(element) {
    const rect = rectFromElement(element);
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function closestPathRatioToLabel(path, label) {
    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length <= OFFSET_EPSILON_PX) return 0.5;
    const labelRect = visibleLabelBounds(label);
    const labelCenter = { x: (labelRect.left + labelRect.right) / 2, y: (labelRect.top + labelRect.bottom) / 2 };
    const sampleCount = Math.max(32, Math.min(160, Math.ceil(length / EDGE_LABEL_PATH_SAMPLE_SPACING_PX)));
    let closest = { ratio: 0.5, distance: Infinity };
    const matrix = path.getScreenCTM();
    if (!matrix) return 0.5;
    for (let index = 0; index <= sampleCount; index += 1) {
      const ratio = index / sampleCount;
      const local = path.getPointAtLength(length * ratio);
      const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      const distance = Math.hypot(screen.x - labelCenter.x, screen.y - labelCenter.y);
      if (distance < closest.distance) closest = { ratio, distance };
    }
    return closest.ratio;
  }

  function placeEdgeLabelOnPathRatio(svgEl, label, path, ratio) {
    const length = path.getTotalLength();
    if (!Number.isFinite(length)) return;
    const local = path.getPointAtLength(length * ratio);
    const matrix = path.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    const labelRect = visibleLabelBounds(label);
    translateTitleByScreen(
      svgEl,
      label,
      labelRect,
      point.x - (labelRect.left + labelRect.right) / 2,
      point.y - (labelRect.top + labelRect.bottom) / 2,
    );
    label.setAttribute('data-icm-route-ratio', String(ratio));
  }

  function sampledRouteScreenPoints(path) {
    const length = path.getTotalLength();
    const matrix = path.getScreenCTM();
    if (!Number.isFinite(length) || !matrix) return [];
    const sampleCount = Math.max(8, Math.min(96, Math.ceil(length / 26)));
    const points = [];
    for (let index = 0; index <= sampleCount; index += 1) {
      const local = path.getPointAtLength(length * index / sampleCount);
      const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      const previous = points[points.length - 1];
      if (!previous || Math.hypot(screen.x - previous.x, screen.y - previous.y) > 1) {
        points.push({ x: screen.x, y: screen.y });
      }
    }
    return points;
  }

  function pointToLineDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const squaredLength = dx * dx + dy * dy;
    if (squaredLength <= OFFSET_EPSILON_PX) return Math.hypot(point.x - start.x, point.y - start.y);
    const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength));
    return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio));
  }

  // Mermaid 原路径提供的是可靠的避障走廊，但逐像素采样会把一条平滑曲线误解成
  // 数十个小折点。RDP 只保留真正的方向变化，使最终仍是一条连续、可读的路径。
  function simplifyRoutePoints(points, tolerance) {
    if (points.length <= 2) return points.slice();
    const keep = new Set([0, points.length - 1]);
    const simplifyRange = function simplifyRange(startIndex, endIndex) {
      let furthestIndex = -1;
      let furthestDistance = 0;
      for (let index = startIndex + 1; index < endIndex; index += 1) {
        const distance = pointToLineDistance(points[index], points[startIndex], points[endIndex]);
        if (distance > furthestDistance) {
          furthestDistance = distance;
          furthestIndex = index;
        }
      }
      if (furthestIndex >= 0 && furthestDistance > tolerance) {
        keep.add(furthestIndex);
        simplifyRange(startIndex, furthestIndex);
        simplifyRange(furthestIndex, endIndex);
      }
    };
    simplifyRange(0, points.length - 1);
    return Array.from(keep).sort(function sortByIndex(left, right) { return left - right; }).map(function at(index) {
      return points[index];
    });
  }

  function roundedCorridorPath(svgEl, path, screenPoints) {
    if (screenPoints.length < 2) return null;
    const points = screenPoints.map(function toPathLocal(point) {
      return screenToLocal(svgEl, path, point.x, point.y);
    });
    let d = 'M' + points[0].x + ',' + points[0].y;
    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = points[index - 1];
      const corner = points[index];
      const next = points[index + 1];
      const inbound = Math.hypot(corner.x - previous.x, corner.y - previous.y);
      const outbound = Math.hypot(next.x - corner.x, next.y - corner.y);
      const radius = Math.min(16, inbound / 3, outbound / 3);
      if (radius <= OFFSET_EPSILON_PX) {
        d += ' L' + corner.x + ',' + corner.y;
        continue;
      }
      const entry = {
        x: corner.x + (previous.x - corner.x) / inbound * radius,
        y: corner.y + (previous.y - corner.y) / inbound * radius,
      };
      const exit = {
        x: corner.x + (next.x - corner.x) / outbound * radius,
        y: corner.y + (next.y - corner.y) / outbound * radius,
      };
      d += ' L' + entry.x + ',' + entry.y + ' Q' + corner.x + ',' + corner.y + ' ' + exit.x + ',' + exit.y;
    }
    const last = points[points.length - 1];
    d += ' L' + last.x + ',' + last.y;
    return d;
  }

  function expandedRect(rect, padding) {
    return {
      left: rect.left - padding,
      top: rect.top - padding,
      right: rect.right + padding,
      bottom: rect.bottom + padding,
    };
  }

  function segmentIntersectsRect(start, end, rect) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let entry = 0;
    let exit = 1;
    for (const [origin, delta, low, high] of [
      [start.x, dx, rect.left, rect.right],
      [start.y, dy, rect.top, rect.bottom],
    ]) {
      if (Math.abs(delta) <= OFFSET_EPSILON_PX) {
        if (origin < low || origin > high) return false;
        continue;
      }
      let from = (low - origin) / delta;
      let to = (high - origin) / delta;
      if (from > to) [from, to] = [to, from];
      entry = Math.max(entry, from);
      exit = Math.min(exit, to);
      if (entry > exit) return false;
    }
    return true;
  }

  function nodeConnectionPorts(node) {
    const frame = node.querySelector(':scope > rect') || node;
    const rect = rectFromElement(frame);
    const centerX = (rect.left + rect.right) / 2;
    const centerY = (rect.top + rect.bottom) / 2;
    return [
      { x: rect.left, y: centerY },
      { x: rect.right, y: centerY },
      { x: centerX, y: rect.top },
      { x: centerX, y: rect.bottom },
    ];
  }

  function compactGridRoute(points) {
    if (points.length <= 2) return points;
    const compacted = [points[0]];
    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = compacted[compacted.length - 1];
      const current = points[index];
      const next = points[index + 1];
      const cross = (current.x - previous.x) * (next.y - current.y)
        - (current.y - previous.y) * (next.x - current.x);
      if (Math.abs(cross) > OFFSET_EPSILON_PX) compacted.push(current);
    }
    compacted.push(points[points.length - 1]);
    return compacted;
  }

  function findLocalNodeSafeGridRoute(start, end, blockers) {
    const cell = 24;
    const localBounds = {
      left: Math.min(start.x, end.x) - 84,
      right: Math.max(start.x, end.x) + 84,
      top: Math.min(start.y, end.y) - 84,
      bottom: Math.max(start.y, end.y) + 84,
    };
    const safeRects = blockers.map(function safeRect(node) { return expandedRect(rectFromElement(node), 14); }).filter(function isLocal(rect) {
      return rect.right >= localBounds.left && rect.left <= localBounds.right
        && rect.bottom >= localBounds.top && rect.top <= localBounds.bottom;
    });
    const bounds = [localBounds, { left: start.x, right: start.x, top: start.y, bottom: start.y }, { left: end.x, right: end.x, top: end.y, bottom: end.y }];
    const left = Math.floor((Math.min.apply(null, bounds.map(function value(rect) { return rect.left; })) - 64) / cell) * cell;
    const top = Math.floor((Math.min.apply(null, bounds.map(function value(rect) { return rect.top; })) - 64) / cell) * cell;
    const right = Math.ceil((Math.max.apply(null, bounds.map(function value(rect) { return rect.right; })) + 64) / cell) * cell;
    const bottom = Math.ceil((Math.max.apply(null, bounds.map(function value(rect) { return rect.bottom; })) + 64) / cell) * cell;
    const width = Math.max(1, Math.round((right - left) / cell));
    const height = Math.max(1, Math.round((bottom - top) / cell));
    const pointFor = function pointFor(x, y) { return { x: left + x * cell, y: top + y * cell }; };
    const keyFor = function keyFor(x, y) { return x + ',' + y; };
    const isClearSegment = function isClearSegment(first, second) {
      return !safeRects.some(function intersects(rect) { return segmentIntersectsRect(first, second, rect); });
    };
    const nearestVisibleCell = function nearestVisibleCell(anchor) {
      const centerX = Math.max(0, Math.min(width, Math.round((anchor.x - left) / cell)));
      const centerY = Math.max(0, Math.min(height, Math.round((anchor.y - top) / cell)));
      for (let radius = 0; radius <= 10; radius += 1) {
        for (let x = centerX - radius; x <= centerX + radius; x += 1) {
          for (let y = centerY - radius; y <= centerY + radius; y += 1) {
            if (x < 0 || x > width || y < 0 || y > height) continue;
            const point = pointFor(x, y);
            if (isClearSegment(anchor, point)) return { x, y, point };
          }
        }
      }
      return null;
    };
    const source = nearestVisibleCell(start);
    const target = nearestVisibleCell(end);
    if (!source || !target) return null;
    const open = [{ x: source.x, y: source.y, cost: 0, score: 0 }];
    const cameFrom = new Map();
    const bestCost = new Map([[keyFor(source.x, source.y), 0]]);
    while (open.length > 0) {
      open.sort(function lowScoreFirst(first, second) { return first.score - second.score; });
      const current = open.shift();
      if (current.x === target.x && current.y === target.y) {
        const points = [target.point];
        let key = keyFor(current.x, current.y);
        while (cameFrom.has(key)) {
          const previous = cameFrom.get(key);
          points.push(pointFor(previous.x, previous.y));
          key = keyFor(previous.x, previous.y);
        }
        points.reverse();
        return compactGridRoute([start].concat(points, [end]));
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = current.x + dx;
        const y = current.y + dy;
        if (x < 0 || x > width || y < 0 || y > height) continue;
        const from = pointFor(current.x, current.y);
        const to = pointFor(x, y);
        if (!isClearSegment(from, to)) continue;
        const nextCost = current.cost + 1;
        const key = keyFor(x, y);
        if (nextCost >= (bestCost.get(key) ?? Infinity)) continue;
        bestCost.set(key, nextCost);
        cameFrom.set(key, { x: current.x, y: current.y });
        open.push({
          x,
          y,
          cost: nextCost,
          score: nextCost + Math.abs(x - target.x) + Math.abs(y - target.y),
        });
      }
    }
    return null;
  }

  function endpointSideForReference(node, reference) {
    const rect = rectFromElement(node.querySelector(':scope > rect') || node);
    const candidates = [
      { side: 'left', point: { x: rect.left, y: (rect.top + rect.bottom) / 2 } },
      { side: 'right', point: { x: rect.right, y: (rect.top + rect.bottom) / 2 } },
      { side: 'top', point: { x: (rect.left + rect.right) / 2, y: rect.top } },
      { side: 'bottom', point: { x: (rect.left + rect.right) / 2, y: rect.bottom } },
    ];
    candidates.sort(function nearestSide(first, second) {
      return Math.hypot(first.point.x - reference.x, first.point.y - reference.y)
        - Math.hypot(second.point.x - reference.x, second.point.y - reference.y);
    });
    return candidates.map(function sideOf(candidate) { return candidate.side; });
  }

  function portPointOnSide(node, side, position) {
    const rect = rectFromElement(node.querySelector(':scope > rect') || node);
    const inset = 6;
    const ratio = Math.max(0.14, Math.min(0.86, position));
    if (side === 'left' || side === 'right') {
      return { x: side === 'left' ? rect.left : rect.right, y: rect.top + inset + (rect.height - inset * 2) * ratio };
    }
    return { x: rect.left + inset + (rect.width - inset * 2) * ratio, y: side === 'top' ? rect.top : rect.bottom };
  }

  // 同一节点的多入/多出边绝不再共用一个像素点。优先按原通道的方向选边；当该边
  // 已有两条关系时，自动分流到相邻边，消除截图中“星形汇入”的歧义。
  function allocateHandoffNodePorts(plans, endpoint) {
    const byNode = new Map();
    for (const plan of plans) {
      const node = endpoint === 'source' ? plan.fromNode : plan.toNode;
      const reference = endpoint === 'source' ? plan.route[0] : plan.route[plan.route.length - 1];
      if (!node || !reference) continue;
      const nodePlans = byNode.get(node) || [];
      nodePlans.push({ plan, node, reference });
      byNode.set(node, nodePlans);
    }
    for (const entries of byNode.values()) {
      const sideUsage = new Map();
      for (const entry of entries.slice().sort(function stableDirection(first, second) {
        return first.plan.edgeId.localeCompare(second.plan.edgeId);
      })) {
        const sides = endpointSideForReference(entry.node, entry.reference);
        let selected = sides[0];
        let bestScore = Infinity;
        for (let index = 0; index < sides.length; index += 1) {
          const side = sides[index];
          const usage = sideUsage.get(side) || 0;
          const score = index * 26 + usage * 74;
          if (score < bestScore) {
            selected = side;
            bestScore = score;
          }
        }
        entry.side = selected;
        sideUsage.set(selected, (sideUsage.get(selected) || 0) + 1);
      }
      const bySide = new Map();
      for (const entry of entries) {
        const list = bySide.get(entry.side) || [];
        list.push(entry);
        bySide.set(entry.side, list);
      }
      for (const [side, sideEntries] of bySide) {
        sideEntries.sort(function orderAlongSide(first, second) {
          const firstAxis = side === 'left' || side === 'right' ? first.reference.y : first.reference.x;
          const secondAxis = side === 'left' || side === 'right' ? second.reference.y : second.reference.x;
          return firstAxis - secondAxis || first.plan.edgeId.localeCompare(second.plan.edgeId);
        });
        sideEntries.forEach(function setPort(entry, index) {
          const port = portPointOnSide(entry.node, side, (index + 1) / (sideEntries.length + 1));
          entry.plan[endpoint + 'Port'] = port;
          entry.plan[endpoint + 'PortSide'] = side;
        });
      }
    }
  }

  function connectionIsClear(start, end, blockers) {
    return !blockers.some(function crossesNode(node) {
      return segmentIntersectsRect(start, end, expandedRect(rectFromElement(node), 8));
    });
  }

  function localAccessRoute(start, end, blockers) {
    if (connectionIsClear(start, end, blockers)) return [start, end];
    return findLocalNodeSafeGridRoute(start, end, blockers) || [start, end];
  }

  function joinRouteSegments(segments) {
    const points = [];
    for (const segment of segments) {
      for (const point of segment) {
        const previous = points[points.length - 1];
        if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.5) points.push(point);
      }
    }
    return simplifyRoutePoints(points, 10);
  }

  function renderHandoffPath(svgEl, plan) {
    const blockers = Array.from(svgEl.querySelectorAll('g.node[data-node-id]')).filter(function unrelatedNode(node) {
      const id = node.getAttribute('data-node-id');
      return id !== plan.edge.from && id !== plan.edge.to;
    });
    const sourceAccess = localAccessRoute(plan.sourcePort, plan.route[0], blockers);
    const targetAccess = localAccessRoute(plan.route[plan.route.length - 1], plan.targetPort, blockers);
    const route = joinRouteSegments([sourceAccess, plan.route, targetAccess]);
    const d = roundedCorridorPath(svgEl, plan.path, route);
    if (!d) return false;
    plan.path.setAttribute('d', d);
    plan.path.setAttribute('data-icm-route-kind', 'node-port-original-corridor');
    plan.path.setAttribute('data-icm-source-port-side', plan.sourcePortSide || '');
    plan.path.setAttribute('data-icm-target-port-side', plan.targetPortSide || '');
    return true;
  }

  function labelSlotCandidates(preferredRatio) {
    const ratios = new Set();
    const add = function addRatio(value) {
      if (value >= 0.14 && value <= 0.86) ratios.add(Number(value.toFixed(4)));
    };
    add(preferredRatio);
    for (const offset of [0.04, 0.08, 0.13, 0.19, 0.27, 0.36]) {
      add(preferredRatio - offset);
      add(preferredRatio + offset);
    }
    for (const fallback of [0.18, 0.28, 0.38, 0.5, 0.62, 0.72, 0.82]) add(fallback);
    return Array.from(ratios);
  }

  function labelBoundsAtPathRatio(label, path, ratio) {
    const length = path.getTotalLength();
    const matrix = path.getScreenCTM();
    if (!Number.isFinite(length) || !matrix) return null;
    const local = path.getPointAtLength(length * ratio);
    const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    const current = visibleLabelBounds(label);
    return {
      point,
      ratio,
      rect: rectAfterScreenTranslation(
        current,
        point.x - (current.left + current.right) / 2,
        point.y - (current.top + current.bottom) / 2,
      ),
    };
  }

  function placeHandoffLabelsInOpenSlots(svgEl) {
    const nodeRects = Array.from(svgEl.querySelectorAll('g.node[data-node-id]')).map(rectFromElement);
    const titleRects = Array.from(svgEl.querySelectorAll('.cluster-label[data-subgraph], .cluster-label[data-icm-layout-band]'))
      .map(rectFromElement);
    const paths = edgePaths(svgEl);
    const labels = Array.from(svgEl.querySelectorAll('g.edgeLabel[data-icm-edge-role="handoff"]'))
      .map(function toEntry(label) {
        const edgeId = label.getAttribute('data-icm-edge-id') || '';
        const record = edgeRecordForId(svgEl, edgeId);
        return { label, edgeId, path: record?.path || null };
      }).filter(function hasPath(entry) {
        return entry.path;
      }).sort(function conditionsFirst(left, right) {
        const leftKind = left.label.getAttribute('data-icm-label-kind') === 'condition' ? 0 : 1;
        const rightKind = right.label.getAttribute('data-icm-label-kind') === 'condition' ? 0 : 1;
        if (leftKind !== rightKind) return leftKind - rightKind;
        return left.edgeId.localeCompare(right.edgeId);
      });
    const occupied = [];
    for (const entry of labels) {
      const preferred = Number.parseFloat(entry.label.getAttribute('data-icm-route-ratio') || '0.5');
      const foreignPaths = paths.filter(function isForeign(record) { return record.path !== entry.path; });
      const candidates = labelSlotCandidates(Number.isFinite(preferred) ? preferred : 0.5)
        .map(function evaluateRatio(ratio) {
          const candidate = labelBoundsAtPathRatio(entry.label, entry.path, ratio);
          if (!candidate) return null;
          const collidesNode = nodeRects.some(function overlapsNode(rect) {
            return rectsOverlapOrAreTooClose(candidate.rect, rect, 8);
          });
          const collidesTitle = titleRects.some(function overlapsTitle(rect) {
            return rectsOverlapOrAreTooClose(candidate.rect, rect, EDGE_LABEL_TITLE_GAP_PX);
          });
          const collidesLabel = occupied.some(function overlapsLabel(rect) {
            return rectsOverlapOrAreTooClose(candidate.rect, rect, 6);
          });
          const foreignClearance = foreignPaths.length === 0
            ? Infinity
            : Math.min.apply(null, foreignPaths.map(function gapToForeign(record) {
              return pathDistanceToRect(record.path, candidate.rect);
            }));
          return {
            ...candidate,
            collidesNode,
            collidesTitle,
            collidesLabel,
            foreignClearance,
            travel: Math.abs(ratio - preferred),
          };
        }).filter(Boolean);
      const clear = candidates.filter(function leavesOwnOpenArea(candidate) {
        return !candidate.collidesNode && !candidate.collidesTitle && !candidate.collidesLabel;
      });
      const choices = clear.length > 0 ? clear : candidates;
      if (choices.length === 0) continue;
      const comfortablyClear = choices.filter(function leavesSpaceAroundOwnPath(candidate) {
        return candidate.foreignClearance >= EDGE_LABEL_NATURAL_FOREIGN_PATH_GAP_PX;
      });
      const preferredChoices = comfortablyClear.length > 0 ? comfortablyClear : choices;
      preferredChoices.sort(function preferNearestClearOwnSegment(left, right) {
        if (Math.abs(left.travel - right.travel) > OFFSET_EPSILON_PX) return left.travel - right.travel;
        return right.foreignClearance - left.foreignClearance;
      });
      const selected = preferredChoices[0];
      placeEdgeLabelOnPathRatio(svgEl, entry.label, entry.path, selected.ratio);
      entry.label.setAttribute('data-icm-open-slot', 'true');
      occupied.push(visibleLabelBounds(entry.label));
    }
  }

  // Mermaid 跨分组路由会在 cluster 边界生成多段折线；业务关系仍是 node → node。
  // 这里保留其避障通道、以平滑曲线接回节点；标签和避让都挂在同一条路径上。
  function renderSmoothHandoffPaths(svgEl, spec) {
    const edgeByMermaidId = buildMermaidEdgeMap(spec);
    const layer = ensureHandoffNodePathLayer(svgEl);
    const connected = new Set();
    const plans = [];
    for (const [edgeId, edge] of edgeByMermaidId) {
      const fromSubgraph = normalizeSubgraphName(spec.nodes.find(function findFrom(node) { return node.id === edge.from; })?.subgraph);
      const toSubgraph = normalizeSubgraphName(spec.nodes.find(function findTo(node) { return node.id === edge.to; })?.subgraph);
      if (fromSubgraph === toSubgraph) continue;
      const record = edgeRecordForId(svgEl, edgeId);
      if (!record) continue;
      const edgeLabel = svgEl.querySelector('g.edgeLabel[data-icm-edge-id="' + edgeId + '"]');
      // 标签在 Mermaid 原路径上的相对位置比绝对坐标更稳定。先记录该比例，再把它
      // 映射到新曲线，避免换路由后“线是曲线，条件还停在旧折线位置”的错位。
      const labelRatio = edgeLabel ? closestPathRatioToLabel(record.path, edgeLabel) : 0.5;
      const route = simplifyRoutePoints(sampledRouteScreenPoints(record.path), 9);
      const fromNode = nodeElementForId(svgEl, edge.from);
      const toNode = nodeElementForId(svgEl, edge.to);
      if (!fromNode || !toNode || route.length < 2) continue;
      movePathToHandoffLayer(layer, record.path);
      plans.push({ edgeId, edge, path: record.path, edgeLabel, labelRatio, route, fromNode, toNode });
    }
    allocateHandoffNodePorts(plans, 'source');
    allocateHandoffNodePorts(plans, 'target');
    for (const plan of plans) {
      if (!plan.sourcePort || !plan.targetPort || !renderHandoffPath(svgEl, plan)) continue;
      if (plan.edgeLabel) placeEdgeLabelOnPathRatio(svgEl, plan.edgeLabel, plan.path, plan.labelRatio);
      plan.path.setAttribute('data-icm-node-anchored', 'true');
      connected.add(plan.edgeId);
    }
    for (const edgeLabel of svgEl.querySelectorAll('g.edgeLabel[data-icm-edge-role="handoff"]')) {
      const edgeId = edgeLabel.getAttribute('data-icm-edge-id') || '';
      if (connected.has(edgeId)) edgeLabel.setAttribute('data-icm-node-anchored', 'true');
      else edgeLabel.removeAttribute('data-icm-node-anchored');
    }
    placeHandoffLabelsInOpenSlots(svgEl);
  }

  function replaceInitialMoveWithNodeExtension(d, sourcePort, originalStart) {
    const initialMove = /^\s*M\s*[-+]?\d*\.?\d+(?:e[-+]?\d+)?(?:[\s,]+)[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i;
    if (!initialMove.test(d)) return null;
    return d.replace(initialMove, 'M ' + sourcePort.x + ' ' + sourcePort.y
      + ' L ' + originalStart.x + ' ' + originalStart.y);
  }

  // Mermaid 的跨分组边有时在分组边界处截断。保留它已经避障的整段通道和原始
  // 标签位置，只将路径两端延伸到真实节点边缘。这里刻意不重排端口、不重写中段、
  // 不调整标签；这样可避免多轮几何后处理互相覆盖而使复杂业务图失去可读性。
  function reconnectHandoffPathsToNodes(svgEl, spec) {
    const edgeByMermaidId = buildMermaidEdgeMap(spec);
    const handoffLabels = Array.from(svgEl.querySelectorAll('g.edgeLabel[data-icm-edge-role="handoff"]'));
    if (handoffLabels.length === 0) return;
    const layer = ensureHandoffNodePathLayer(svgEl);
    for (const label of handoffLabels) {
      const edgeId = label.getAttribute('data-icm-edge-id');
      const edge = edgeId ? edgeByMermaidId.get(edgeId) : null;
      const record = edgeId ? edgeRecordForId(svgEl, edgeId) : null;
      if (!edge || !record || record.path.getAttribute('data-icm-route-kind') === 'native-corridor-node-extensions') continue;
      const sourceNode = nodeElementForId(svgEl, edge.from);
      const targetNode = nodeElementForId(svgEl, edge.to);
      const originalStartScreen = screenPointAtPathEnd(record.path, false);
      const originalEndScreen = screenPointAtPathEnd(record.path, true);
      if (!sourceNode || !targetNode || !originalStartScreen || !originalEndScreen) continue;
      const sourcePortScreen = nearestPointOnElementBorder(originalStartScreen, sourceNode);
      const targetPortScreen = nearestPointOnElementBorder(originalEndScreen, targetNode);
      if (!sourcePortScreen || !targetPortScreen) continue;

      movePathToHandoffLayer(layer, record.path);
      const length = record.path.getTotalLength();
      if (!Number.isFinite(length) || length <= 0 || !record.path.parentNode) continue;
      const originalStart = record.path.getPointAtLength(0);
      const sourcePort = screenToLocal(svgEl, record.path.parentNode, sourcePortScreen.x, sourcePortScreen.y);
      const targetPort = screenToLocal(svgEl, record.path.parentNode, targetPortScreen.x, targetPortScreen.y);
      const extended = replaceInitialMoveWithNodeExtension(record.path.getAttribute('d') || '', sourcePort, originalStart);
      if (!extended) continue;
      record.path.setAttribute('d', extended + ' L ' + targetPort.x + ' ' + targetPort.y);
      record.path.setAttribute('data-icm-route-kind', 'native-corridor-node-extensions');
      label.setAttribute('data-icm-node-anchored', 'true');
    }
  }

  function createPanZoom(viewportEl, canvasEl, svgEl) {
    let tx = 0;
    let ty = 0;
    let scale = 1;
    const minScale = 0.15;
    const maxScale = 4;
    const pointers = new Map();
    let panPointerId = null;
    let lastX = 0;
    let lastY = 0;
    let pinch = null;

    function clamp(value, low, high) {
      return Math.min(high, Math.max(low, value));
    }

    // 图例固定在画布右下角。Fit 若只按 viewport 尺寸缩放，最末一行节点和标签会
    // 被图例压住；这里把图例上方保留成一条安全阅读带，首次打开和点击 Fit 共用。
    function visibleFitArea() {
      const viewportRect = viewportEl.getBoundingClientRect();
      const base = { left: 0, top: 0, width: viewportEl.clientWidth, height: viewportEl.clientHeight };
      const legend = document.querySelector('.icm-legend');
      if (!legend || legend.hidden) return base;
      const legendRect = legend.getBoundingClientRect();
      const legendTop = legendRect.top - viewportRect.top;
      const overlapsViewport = legendRect.bottom > viewportRect.top
        && legendRect.top < viewportRect.bottom
        && legendRect.right > viewportRect.left
        && legendRect.left < viewportRect.right;
      if (!overlapsViewport || legendTop <= 48) return base;
      const safetyBottom = Math.max(0, legendTop - 12);
      return { ...base, height: Math.max(48, Math.min(base.height, safetyBottom)) };
    }

    function apply() {
      canvasEl.style.transformOrigin = '0 0';
      canvasEl.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
    }

    function zoomAt(clientX, clientY, factor) {
      const rect = viewportEl.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const nextScale = clamp(scale * factor, minScale, maxScale);
      const localX = (px - tx) / scale;
      const localY = (py - ty) / scale;
      tx = px - localX * nextScale;
      ty = py - localY * nextScale;
      scale = nextScale;
      apply();
    }

    function pointerPair() {
      return Array.from(pointers.values()).slice(0, 2);
    }

    function pairMetrics(pair) {
      return {
        x: (pair[0].x + pair[1].x) / 2,
        y: (pair[0].y + pair[1].y) / 2,
        distance: Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y),
      };
    }

    function beginPinch() {
      const pair = pointerPair();
      if (pair.length !== 2) return;
      const metrics = pairMetrics(pair);
      if (metrics.distance <= 0) return;
      const rect = viewportEl.getBoundingClientRect();
      pinch = {
        scale,
        localX: (metrics.x - rect.left - tx) / scale,
        localY: (metrics.y - rect.top - ty) / scale,
        distance: metrics.distance,
      };
    }

    function finishPointer(event) {
      try {
        viewportEl.releasePointerCapture(event.pointerId);
      } catch {
        // 合成 PointerEvent 不一定可捕获。
      }
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        const remaining = pointers.entries().next().value;
        panPointerId = remaining[0];
        lastX = remaining[1].x;
        lastY = remaining[1].y;
      } else {
        panPointerId = null;
        viewportEl.style.cursor = '';
      }
    }

    viewportEl.addEventListener('pointerdown', function onPointerDown(event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      // 让 SVG 节点保留原生 click 序列。若先在 viewport 捕获指针，
      // 浏览器会把 pointerup/click 重定向到 viewport，导致节点首击失效。
      if (event.target && typeof event.target.closest === 'function' && event.target.closest('g.node[data-node-id]')) {
        return;
      }
      try {
        viewportEl.setPointerCapture(event.pointerId);
      } catch {
        // 合成 PointerEvent 不一定可捕获。
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        panPointerId = event.pointerId;
        lastX = event.clientX;
        lastY = event.clientY;
        viewportEl.style.cursor = 'grabbing';
      } else if (pointers.size === 2) {
        beginPinch();
      }
    });

    viewportEl.addEventListener('pointermove', function onPointerMove(event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2 && pinch) {
        const metrics = pairMetrics(pointerPair());
        const rect = viewportEl.getBoundingClientRect();
        const nextScale = clamp(pinch.scale * (metrics.distance / pinch.distance), minScale, maxScale);
        tx = metrics.x - rect.left - pinch.localX * nextScale;
        ty = metrics.y - rect.top - pinch.localY * nextScale;
        scale = nextScale;
        apply();
      } else if (event.pointerId === panPointerId) {
        tx += event.clientX - lastX;
        ty += event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        apply();
      }
    });

    viewportEl.addEventListener('pointerup', finishPointer);
    viewportEl.addEventListener('pointercancel', finishPointer);
    // 浏览器会把在 SVG 文本上的拖动理解成框选文字。画布的唯一拖动语义是平移，
    // 因此在图谱视口内统一取消选择；右侧详情窗不在该视口内，仍可复制内容。
    viewportEl.addEventListener('selectstart', function preventGraphTextSelection(event) {
      event.preventDefault();
    });
    viewportEl.addEventListener('wheel', function onWheel(event) {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.1 : 0.9);
    }, { passive: false });

    apply();
    return {
      zoomIn: function zoomIn() {
        const rect = viewportEl.getBoundingClientRect();
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
      },
      zoomOut: function zoomOut() {
        const rect = viewportEl.getBoundingClientRect();
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.2);
      },
      fitToScreen: function fitToScreen() {
        const bbox = svgEl.getBBox();
        const visible = visibleFitArea();
        const width = visible.width;
        const height = visible.height;
        if (!bbox.width || !bbox.height || !width || !height) return;
        scale = clamp(Math.min(width / bbox.width, height / bbox.height) * 0.9, minScale, maxScale);
        tx = visible.left + (width - bbox.width * scale) / 2 - bbox.x * scale;
        ty = visible.top + (height - bbox.height * scale) / 2 - bbox.y * scale;
        apply();
      },
      focusNode: function focusNode(nodeId, options) {
        const node = Array.from(svgEl.querySelectorAll('g.node')).find(function matchNode(element) {
          return element.getAttribute('data-node-id') === nodeId;
        });
        if (!node) return;
        const viewportRect = viewportEl.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();
        let targetX = viewportEl.clientWidth / 2;
        if (options && options.avoidDetailPanel && window.matchMedia('(min-width: 769px)').matches) {
          const panel = document.getElementById('detail-panel');
          if (panel) {
            const panelRect = panel.getBoundingClientRect();
            const visibleWidth = clamp(panelRect.left - viewportRect.left, 0, viewportEl.clientWidth);
            if (visibleWidth > 0) targetX = visibleWidth / 2;
          }
        }
        const nodeCenterX = nodeRect.left - viewportRect.left + nodeRect.width / 2;
        const nodeCenterY = nodeRect.top - viewportRect.top + nodeRect.height / 2;
        tx += targetX - nodeCenterX;
        ty += viewportEl.clientHeight / 2 - nodeCenterY;
        apply();
      },
      getState: function getState() {
        return { tx, ty, scale };
      },
    };
  }

  function rectFromElement(element) {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  function unionRects(rects) {
    const nonEmpty = rects.filter(function nonEmptyRect(rect) {
      return rect && rect.width > 0 && rect.height > 0;
    });
    if (nonEmpty.length === 0) return null;
    return {
      left: Math.min.apply(null, nonEmpty.map(function leftOf(rect) { return rect.left; })),
      top: Math.min.apply(null, nonEmpty.map(function topOf(rect) { return rect.top; })),
      right: Math.max.apply(null, nonEmpty.map(function rightOf(rect) { return rect.right; })),
      bottom: Math.max.apply(null, nonEmpty.map(function bottomOf(rect) { return rect.bottom; })),
      get width() { return this.right - this.left; },
      get height() { return this.bottom - this.top; },
    };
  }

  // Mermaid 会给 edgeLabel 的外层 <g>/<foreignObject> 预留比实际内容更大的透明区域。
  // 该透明区不能参与碰撞或引线计算，否则线会接到“看不见的外框”而不是条件胶囊。
  // 只要存在真正绘制出来的 HTML 背景节点，就以它的 border box 为准；无 HTML 标签时
  // 才退回 SVG 容器本身。
  function visibleLabelBounds(label) {
    const candidates = Array.from(new Set(
      Array.from(label.querySelectorAll('foreignObject > div, .labelBkg')),
    )).map(rectFromElement).filter(function hasVisibleArea(rect) {
      return rect.width > 0 && rect.height > 0;
    });
    return unionRects(candidates) || rectFromElement(label);
  }

  function hasPositiveAreaOverlap(first, second) {
    return Math.min(first.right, second.right) - Math.max(first.left, second.left) > 0
      && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 0;
  }

  function needsTitleClearance(first, second) {
    if (hasPositiveAreaOverlap(first, second)) return true;
    const horizontalOverlap = Math.min(first.right, second.right) - Math.max(first.left, second.left) > 0;
    const verticalGap = Math.max(0, first.top - second.bottom, second.top - first.bottom);
    return horizontalOverlap && verticalGap < EDGE_LABEL_TITLE_GAP_PX;
  }

  function screenToLocal(svgEl, localSpaceEl, x, y) {
    const matrix = localSpaceEl.getScreenCTM();
    if (!matrix) throw new Error('无法取得 SVG 屏幕变换矩阵');
    // 部分嵌入式 Chromium 环境未暴露 SVGSVGElement#createSVGPoint；DOMPoint
    // 与浏览器的标准矩阵 API 等价，且已用于路径采样，避免标题修复在该环境静默中断。
    return new DOMPoint(x, y).matrixTransform(matrix.inverse());
  }

  function translateTitleByScreen(svgEl, label, labelRect, dxScreen, dyScreen) {
    // 自检 API 可重复调用。忽略亚像素浮点噪声，避免每次都把 transform 串上
    // 一点不可见位移，从而破坏幂等性。
    if (Math.abs(dxScreen) <= OFFSET_EPSILON_PX && Math.abs(dyScreen) <= OFFSET_EPSILON_PX) return;
    const before = screenToLocal(svgEl, label.parentNode, labelRect.left, labelRect.top);
    const after = screenToLocal(svgEl, label.parentNode, labelRect.left + dxScreen, labelRect.top + dyScreen);
    const current = elementTransformMatrix(label);
    label.setAttribute('transform', matrixText(current.multiply(new DOMMatrix().translate(
      after.x - before.x,
      after.y - before.y,
    ))));
  }

  function toDomMatrix(matrix) {
    if (!matrix) throw new Error('无法取得 SVG 变换矩阵');
    return new DOMMatrix([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]);
  }

  function elementTransformMatrix(element) {
    const transform = element.transform && element.transform.baseVal;
    const consolidated = transform && transform.consolidate();
    return consolidated ? toDomMatrix(consolidated.matrix) : new DOMMatrix();
  }

  function matrixText(matrix) {
    return 'matrix(' + matrix.a + ',' + matrix.b + ',' + matrix.c + ',' + matrix.d + ',' + matrix.e + ',' + matrix.f + ')';
  }

  function numericSvgAttribute(element, attributeName) {
    const value = Number.parseFloat(element.getAttribute(attributeName) || '');
    return Number.isFinite(value) ? value : 0;
  }

  function expandRectFromCenter(rect, widthDelta, heightDelta) {
    if (widthDelta > OFFSET_EPSILON_PX) {
      rect.setAttribute('x', String(numericSvgAttribute(rect, 'x') - widthDelta / 2));
      rect.setAttribute('width', String(numericSvgAttribute(rect, 'width') + widthDelta));
    }
    if (heightDelta > OFFSET_EPSILON_PX) {
      rect.setAttribute('y', String(numericSvgAttribute(rect, 'y') - heightDelta / 2));
      rect.setAttribute('height', String(numericSvgAttribute(rect, 'height') + heightDelta));
    }
  }

  // Mermaid 先按默认字体度量 foreignObject；主题字体改为较粗字重后，最后一两个
  // 字符可能超出原始宽度。渲染后以真实 DOM 尺寸补齐，并保持节点/条件标签中心不动。
  function ensureForeignObjectTextFits(svgEl) {
    for (const foreignObject of svgEl.querySelectorAll('foreignObject')) {
      const htmlLabel = foreignObject.querySelector(':scope > div') || foreignObject.querySelector('div');
      if (!htmlLabel) continue;
      const currentWidth = numericSvgAttribute(foreignObject, 'width');
      const currentHeight = numericSvgAttribute(foreignObject, 'height');
      const htmlWidth = Math.ceil(htmlLabel.getBoundingClientRect().width / foreignObjectScreenScale(foreignObject, 'x'));
      const htmlHeight = Math.ceil(htmlLabel.getBoundingClientRect().height / foreignObjectScreenScale(foreignObject, 'y'));
      // Mermaid 会为较长 edgeLabel 写入 max-width/width 行内样式；跨组关系又额外
      // 加入方向符、描边和内边距。以真实滚动尺寸和渲染尺寸的较大者重算，并保留
      // 一个安全像素带，避免最后一个字或右侧圆角落在 foreignObject 之外。
      const edgeLabel = foreignObject.closest('g.edgeLabel');
      const safety = edgeLabel && (edgeLabel.classList.contains('icm-cross-group-edge-label')
        || edgeLabel.classList.contains('icm-condition-edge-label'))
        ? CROSS_GROUP_LABEL_BOX_SAFETY_PX
        : 0;
      const targetWidth = Math.max(currentWidth, Math.ceil(htmlLabel.scrollWidth) + safety, htmlWidth + safety);
      const targetHeight = Math.max(currentHeight, Math.ceil(htmlLabel.scrollHeight) + safety, htmlHeight + safety);
      const widthDelta = targetWidth - currentWidth;
      const heightDelta = targetHeight - currentHeight;
      if (widthDelta <= OFFSET_EPSILON_PX && heightDelta <= OFFSET_EPSILON_PX) continue;

      foreignObject.setAttribute('width', String(targetWidth));
      foreignObject.setAttribute('height', String(targetHeight));

      const labelGroup = foreignObject.closest('g.label');
      if (labelGroup) {
        const current = elementTransformMatrix(labelGroup);
        labelGroup.setAttribute('transform', matrixText(current.multiply(new DOMMatrix().translate(
          -widthDelta / 2,
          -heightDelta / 2,
        ))));
      }

      const node = foreignObject.closest('g.node');
      if (node) {
        const nodeContainer = node.querySelector(':scope > rect');
        if (nodeContainer) expandRectFromCenter(nodeContainer, widthDelta, heightDelta);
      }

      if (edgeLabel) {
        const labelBackground = edgeLabel.querySelector('.labelBkg');
        if (labelBackground) expandRectFromCenter(labelBackground, widthDelta, heightDelta);
      }
    }
  }

  function clusterFrameBounds(cluster) {
    const frame = cluster.querySelector(':scope > rect');
    return rectFromElement(frame || cluster);
  }

  // Mermaid 会把跨分组边的路由空间一并计入 cluster 边框，导致只有一个节点的
  // 横切分组也被拉成整行大框。可见分组框只应描述“哪些节点属于这一组”，因此
  // 渲染后按同组节点的并集收紧边框；节点位置和所有关系路径均不移动。
  function compactClusterFramesToNodes(svgEl) {
    const nodesBySubgraph = new Map();
    for (const node of svgEl.querySelectorAll('g.node[data-subgraph]')) {
      const name = node.getAttribute('data-subgraph');
      if (!name) continue;
      const list = nodesBySubgraph.get(name) || [];
      list.push(node);
      nodesBySubgraph.set(name, list);
    }
    for (const cluster of svgEl.querySelectorAll('g.cluster[data-subgraph]')) {
      if (cluster.getAttribute('data-icm-frame-fit') === 'nodes') continue;
      const name = cluster.getAttribute('data-subgraph');
      const nodes = nodesBySubgraph.get(name) || [];
      const frame = cluster.querySelector(':scope > rect');
      if (!frame || nodes.length === 0) continue;
      const nodeBounds = unionRects(nodes.map(rectFromElement));
      if (!nodeBounds) continue;
      const target = {
        left: nodeBounds.left - 20,
        right: nodeBounds.right + 20,
        top: nodeBounds.top - 54,
        bottom: nodeBounds.bottom + 22,
      };
      const topLeft = screenToLocal(svgEl, cluster, target.left, target.top);
      const bottomRight = screenToLocal(svgEl, cluster, target.right, target.bottom);
      frame.setAttribute('x', String(topLeft.x));
      frame.setAttribute('y', String(topLeft.y));
      frame.setAttribute('width', String(Math.max(1, bottomRight.x - topLeft.x)));
      frame.setAttribute('height', String(Math.max(1, bottomRight.y - topLeft.y)));
      cluster.setAttribute('data-icm-frame-fit', 'nodes');
    }
  }

  function foreignObjectScreenScale(foreignObject, axis) {
    const matrix = foreignObject.getScreenCTM();
    if (!matrix) return 1;
    const scale = axis === 'y'
      ? Math.hypot(matrix.c, matrix.d)
      : Math.hypot(matrix.a, matrix.b);
    return scale > OFFSET_EPSILON_PX ? scale : 1;
  }

  // 分组名称永远是“组内顶部居中的阶段页签”，而不是首个节点的说明。页签按文字
  // 自然宽度收紧；只有长标题才在组内换行，绝不因保持单行而突破分组边界。
  function fitGroupTitleWithinCluster(label, clusterRect) {
    const foreignObject = label.querySelector('foreignObject');
    const content = foreignObject && (foreignObject.querySelector(':scope > div') || foreignObject.querySelector('div'));
    if (!foreignObject || !content) return;
    const availableScreenWidth = Math.max(28, clusterRect.width - GROUP_TITLE_HORIZONTAL_INSET_PX * 2);
    const xScale = foreignObjectScreenScale(foreignObject, 'x');
    // 先以不换行的本地 HTML 宽度测量标题，再转成屏幕坐标。这样短标题不会占满
    // 整个分组；超出可用空间的长标题则在下一步被限制在组内并换行。
    content.style.width = 'max-content';
    // 标题基础样式带有 !important，必须以同等优先级覆写，才能可靠得到不换行的
    // 自然宽度；否则短标题也会被 Mermaid 初始宽度影响。
    content.style.setProperty('white-space', 'nowrap', 'important');
    content.style.setProperty('overflow-wrap', 'normal', 'important');
    content.style.setProperty('word-break', 'normal', 'important');
    const naturalScreenWidth = Math.ceil(content.scrollWidth * xScale);
    const titleNeedsWrap = naturalScreenWidth > availableScreenWidth;
    const targetScreenWidth = Math.min(availableScreenWidth, Math.max(24, naturalScreenWidth));
    const nextWidth = Math.max(24, targetScreenWidth / xScale);
    foreignObject.setAttribute('width', String(nextWidth));
    content.style.width = '100%';
    content.style.setProperty('white-space', titleNeedsWrap ? 'normal' : 'nowrap', 'important');
    content.style.setProperty('overflow-wrap', titleNeedsWrap ? 'anywhere' : 'normal', 'important');
    content.style.setProperty('word-break', titleNeedsWrap ? 'break-word' : 'normal', 'important');
    // foreignObject 内 HTML 的 scrollHeight 已经是其本地坐标；不能再除以画布缩放，
    // 否则会留下一个不可见的高空白区，让碰撞检测误以为标题贴到了首节点。
    const contentHeight = Math.ceil(content.scrollHeight);
    // 高度按真实 HTML 内容（含页签底边）扩展。背景不再依靠会被 foreignObject
    // 裁掉的外部阴影，因此页签底部在任何缩放比例下都完整可见。
    foreignObject.setAttribute('height', String(Math.max(24, contentHeight)));
  }

  function centerTitleWithinCluster(svgEl, label) {
    const cluster = label.closest('g.cluster');
    if (!cluster) return;
    const clusterRect = clusterFrameBounds(cluster);
    if (!clusterRect.width || !clusterRect.height) return;
    fitGroupTitleWithinCluster(label, clusterRect);
    const labelRect = visibleLabelBounds(label);
    const minLeft = clusterRect.left + GROUP_TITLE_HORIZONTAL_INSET_PX;
    const maxLeft = Math.max(minLeft, clusterRect.right - GROUP_TITLE_HORIZONTAL_INSET_PX - labelRect.width);
    const centeredLeft = clusterRect.left + (clusterRect.width - labelRect.width) / 2;
    const targetLeft = Math.min(maxLeft, Math.max(minLeft, centeredLeft));
    const targetTop = clusterRect.top + GROUP_TITLE_VERTICAL_INSET_PX;
    translateTitleByScreen(svgEl, label, labelRect, targetLeft - labelRect.left, targetTop - labelRect.top);
    label.setAttribute('data-icm-title-placement', 'top-tab');
  }

  // 分组框先按节点收紧后，短标题的固定顶部留白足够；但长标题会在页签内换行，
  // 高度不能再用同一个常量估计。只在实际不够时向上扩展框体，让页签与首节点保留
  // 明确的阅读间距，节点和连线路由均保持原位。
  function expandClusterFramesForTitleClearance(svgEl, groupLabels) {
    for (const label of groupLabels) {
      const cluster = label.closest('g.cluster[data-subgraph]');
      const frame = cluster && cluster.querySelector(':scope > rect');
      const name = cluster && cluster.getAttribute('data-subgraph');
      if (!cluster || !frame || !name) continue;
      const groupNodes = Array.from(svgEl.querySelectorAll('g.node[data-subgraph]')).filter(function belongsToGroup(node) {
        return node.getAttribute('data-subgraph') === name;
      });
      if (groupNodes.length === 0) continue;
      const firstNodeTop = Math.min.apply(null, groupNodes.map(function topOf(node) {
        return rectFromElement(node).top;
      }));
      const titleRect = visibleLabelBounds(label);
      const frameRect = clusterFrameBounds(cluster);
      const requiredTop = firstNodeTop - GROUP_TITLE_VERTICAL_INSET_PX
        - titleRect.height - GROUP_TITLE_NODE_GAP_PX;
      if (requiredTop >= frameRect.top - OFFSET_EPSILON_PX) continue;
      const topLeft = screenToLocal(svgEl, cluster, frameRect.left, requiredTop);
      const bottomRight = screenToLocal(svgEl, cluster, frameRect.right, frameRect.bottom);
      frame.setAttribute('x', String(topLeft.x));
      frame.setAttribute('y', String(topLeft.y));
      frame.setAttribute('width', String(Math.max(1, bottomRight.x - topLeft.x)));
      frame.setAttribute('height', String(Math.max(1, bottomRight.y - topLeft.y)));
      cluster.setAttribute('data-icm-frame-title-clearance', 'true');
    }
  }

  function edgeLabelBounds(edgeLabel) {
    return visibleLabelBounds(edgeLabel);
  }

  function updateEdgeLabelAnchor(svgEl, edgeLabel, labelRect, force) {
    if (!force && edgeLabel.hasAttribute('data-icm-edge-anchor-x')) return;
    const labelCenter = { x: labelRect.left + labelRect.width / 2, y: labelRect.top + labelRect.height / 2 };
    const edgeId = edgeLabel.getAttribute('data-icm-edge-id');
    const paths = edgePaths(svgEl);
    const ownRecord = edgeId
      ? paths.find(function pathForThisEdge(record) { return record.id === edgeId; })
      : null;
    // Mermaid 的标签中心不保证恰好压在 path 上。更重要的是，复杂图中这个最近点
    // 可能刚好位于别的分支交叉处；选择所属边上离交叉区最近的“独占边段”作为锚点。
    const choice = ownRecord
      ? findUnambiguousEdgeAnchor(ownRecord.path, paths.filter(function foreign(record) {
        return record.id !== ownRecord.id;
      }), labelCenter, labelRect)
      : null;
    const screenAnchor = choice?.point || (ownRecord ? nearestScreenPointOnPath(ownRecord.path, labelCenter) : null) || labelCenter;
    // 引线统一放在 SVG 根坐标层，不能使用 edgeLabel.parentNode 的局部坐标；边线、
    // 标签和缩放可能分别位于不同 transform 链中，这是过去出现“有圆点但线断开”的根因。
    const anchor = screenToLocal(svgEl, svgEl, screenAnchor.x, screenAnchor.y);
    edgeLabel.setAttribute('data-icm-edge-anchor-x', String(anchor.x));
    edgeLabel.setAttribute('data-icm-edge-anchor-y', String(anchor.y));
    edgeLabel.setAttribute('data-icm-edge-anchor-screen-x', String(screenAnchor.x));
    edgeLabel.setAttribute('data-icm-edge-anchor-screen-y', String(screenAnchor.y));
    edgeLabel.setAttribute('data-icm-edge-anchor-mode', choice?.mode || 'nearest');
    if (choice && Number.isFinite(choice.foreignClearance)) {
      edgeLabel.setAttribute('data-icm-edge-anchor-clearance', String(choice.foreignClearance));
    }
    if (choice && Number.isFinite(choice.leaderClearance)) {
      edgeLabel.setAttribute('data-icm-edge-leader-clearance', String(choice.leaderClearance));
    }
  }

  function captureEdgeLabelAnchor(svgEl, edgeLabel, labelRect) {
    updateEdgeLabelAnchor(svgEl, edgeLabel, labelRect, false);
  }

  function markEdgeLabelDetached(svgEl, edgeLabel, labelRect) {
    captureEdgeLabelAnchor(svgEl, edgeLabel, labelRect);
    edgeLabel.setAttribute('data-icm-edge-label-detached', 'true');
  }

  function nearestPointOnRect(target, rect) {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = target.x - centerX;
    const deltaY = target.y - centerY;
    if (Math.abs(deltaX) <= OFFSET_EPSILON_PX && Math.abs(deltaY) <= OFFSET_EPSILON_PX) {
      return { x: centerX, y: centerY };
    }
    const scale = Math.min(
      (rect.width / 2) / Math.max(Math.abs(deltaX), OFFSET_EPSILON_PX),
      (rect.height / 2) / Math.max(Math.abs(deltaY), OFFSET_EPSILON_PX),
    );
    return { x: centerX + deltaX * scale, y: centerY + deltaY * scale };
  }

  function edgePaths(svgEl) {
    const paths = [];
    for (const path of svgEl.querySelectorAll('path[data-id], g.edgePath[data-id] path')) {
      const holder = path.matches('[data-id]') ? path : path.closest('[data-id]');
      const id = holder && holder.getAttribute('data-id');
      if (!id || paths.some(function alreadyCollected(record) { return record.path === path; })) continue;
      paths.push({ id, path });
    }
    return paths;
  }

  function pointToRectDistance(point, rect) {
    return Math.hypot(
      Math.max(rect.left - point.x, 0, point.x - rect.right),
      Math.max(rect.top - point.y, 0, point.y - rect.bottom),
    );
  }

  function rectConnectionPointTowards(target, rect) {
    const edge = nearestPointOnRect(target, rect);
    const dx = target.x - edge.x;
    const dy = target.y - edge.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= OFFSET_EPSILON_PX) return edge;
    // SVG 顶层引线在标签之上绘制。终点轻微进入胶囊描边，消除浏览器抗锯齿、
    // transform 和阴影造成的“明明有线却像断开”的可见缝隙，同时不触及文字区。
    const overlap = Math.min(EDGE_LABEL_LEADER_TERMINAL_OVERLAP_PX, distance / 2);
    return { x: edge.x - dx / distance * overlap, y: edge.y - dy / distance * overlap };
  }

  function nearestScreenPointOnPath(path, target) {
    const points = sampledScreenPointsOnPath(path);
    if (points.length === 0) return null;
    let nearest = null;
    let minimum = Infinity;
    for (const screenPoint of points) {
      const distance = Math.hypot(screenPoint.x - target.x, screenPoint.y - target.y);
      if (distance < minimum) {
        minimum = distance;
        nearest = screenPoint;
      }
    }
    return nearest;
  }

  function sampledScreenPointsOnPath(path) {
    if (!path || typeof path.getTotalLength !== 'function' || !path.getScreenCTM()) return [];
    const length = path.getTotalLength();
    if (!Number.isFinite(length)) return [];
    const sampleCount = Math.max(20, Math.min(
      EDGE_LABEL_PATH_SAMPLE_MAX_COUNT,
      Math.ceil(length / EDGE_LABEL_PATH_SAMPLE_SPACING_PX),
    ));
    const points = [];
    const matrix = path.getScreenCTM();
    for (let index = 0; index <= sampleCount; index += 1) {
      const localPoint = path.getPointAtLength(length * index / sampleCount);
      const screenPoint = new DOMPoint(localPoint.x, localPoint.y).matrixTransform(matrix);
      points.push({ x: screenPoint.x, y: screenPoint.y, index, lengthAt: length * index / sampleCount });
    }
    return points;
  }

  function pointDistanceToSamples(point, samples) {
    let minimum = Infinity;
    for (const sample of samples) {
      minimum = Math.min(minimum, Math.hypot(sample.x - point.x, sample.y - point.y));
    }
    return minimum;
  }

  function segmentDistanceToSamples(start, end, samples) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const squaredLength = dx * dx + dy * dy;
    let minimum = Infinity;
    for (const point of samples) {
      const projected = squaredLength <= OFFSET_EPSILON_PX
        ? 0
        : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength));
      const nearestX = start.x + dx * projected;
      const nearestY = start.y + dy * projected;
      minimum = Math.min(minimum, Math.hypot(point.x - nearestX, point.y - nearestY));
    }
    return minimum;
  }

  function pointBetween(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const squaredLength = dx * dx + dy * dy;
    if (squaredLength <= OFFSET_EPSILON_PX) return false;
    const ratio = ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength;
    return ratio >= 0 && ratio <= 1;
  }

  function classifyLabelEdgeRelationship(ownPath, foreignPaths, labelRect) {
    const ownPoints = sampledScreenPointsOnPath(ownPath);
    const ownGap = ownPoints.length === 0
      ? Infinity
      : Math.min.apply(null, ownPoints.map(function gapToOwnPath(point) {
        return pointToRectDistance(point, labelRect);
      }));
    const foreignGap = foreignPaths.length === 0
      ? Infinity
      : Math.min.apply(null, foreignPaths.map(function gapToForeignPath(record) {
        return pathDistanceToRect(record.path, labelRect);
      }));
    return {
      ownGap,
      foreignGap,
      // 条件框本来覆盖自己的边、且其它边没有侵入，标签本身就是最佳的关系说明；
      // 此时不生成虚线与圆点，避免把清楚的信息做复杂。
      naturallyReadable: ownGap <= OFFSET_EPSILON_PX
        && foreignGap >= EDGE_LABEL_NATURAL_FOREIGN_PATH_GAP_PX,
    };
  }

  // 选择锚点时同时考虑两件事：它必须仍在所属路径上，而且应该避开其它边的交叉段。
  // 引线的方向也参与评分：优先锚到标签“外侧”的上游/下游边段，避免从标签背面斜穿
  // 到目标节点汇合处。这样用户能直接沿着短引线读回对应条件线。
  function findUnambiguousEdgeAnchor(ownPath, foreignPaths, labelCenter, labelRect) {
    const ownSamples = sampledScreenPointsOnPath(ownPath);
    if (ownSamples.length === 0) return null;
    const foreignSamples = foreignPaths.map(function samplesFor(record) {
      return sampledScreenPointsOnPath(record.path);
    }).filter(function nonEmpty(samples) { return samples.length > 0; });
    const focus = ownSamples.reduce(function nearestToLabel(best, point) {
      const distance = Math.hypot(point.x - labelCenter.x, point.y - labelCenter.y);
      return !best || distance < best.distance ? { point, distance } : best;
    }, null);
    if (!focus) return null;
    const candidates = ownSamples.map(function scoreCandidate(point) {
      const foreignClearance = foreignSamples.length === 0
        ? Infinity
        : Math.min.apply(null, foreignSamples.map(function distanceToForeign(samples) {
          return pointDistanceToSamples(point, samples);
        }));
      const labelClearance = pointToRectDistance(point, labelRect);
      const labelEdge = rectConnectionPointTowards(point, labelRect);
      const leaderClearance = foreignSamples.length === 0
        ? Infinity
        : Math.min.apply(null, foreignSamples.map(function leaderDistanceToForeign(samples) {
          return segmentDistanceToSamples(point, labelEdge, samples);
        }));
      return {
        point,
        foreignClearance,
        labelClearance,
        leaderClearance,
        leaderLength: Math.hypot(point.x - labelEdge.x, point.y - labelEdge.y),
        // 避免引线从框内穿出：仅考虑 anchor 位于条件框外侧的一端。
        leaderIsExterior: !pointBetween(point, labelCenter, labelEdge),
        pathTravel: Math.abs(point.lengthAt - focus.point.lengthAt),
      };
    }).filter(function outsideVisibleLabel(candidate) {
      // 若锚点藏在原标签下面，圆点和引线的起点仍会被遮住；宁可沿本边走一点。
      return candidate.labelClearance >= 1;
    });
    const choices = candidates.length > 0 ? candidates : ownSamples.map(function fallback(point) {
      return {
        point,
        foreignClearance: foreignSamples.length === 0
          ? Infinity
          : Math.min.apply(null, foreignSamples.map(function distanceToForeign(samples) {
            return pointDistanceToSamples(point, samples);
          })),
        labelClearance: pointToRectDistance(point, labelRect),
        leaderClearance: foreignSamples.length === 0
          ? Infinity
          : Math.min.apply(null, foreignSamples.map(function leaderDistanceToForeign(samples) {
            return segmentDistanceToSamples(point, rectConnectionPointTowards(point, labelRect), samples);
          })),
        leaderLength: Math.hypot(
          point.x - rectConnectionPointTowards(point, labelRect).x,
          point.y - rectConnectionPointTowards(point, labelRect).y,
        ),
        leaderIsExterior: true,
        pathTravel: Math.abs(point.lengthAt - focus.point.lengthAt),
      };
    });
    const clearanceScore = function clearanceScore(candidate) {
      return Math.min(candidate.foreignClearance, candidate.leaderClearance);
    };
    const unambiguous = choices.filter(function enoughClearance(candidate) {
      return candidate.foreignClearance >= EDGE_LABEL_ANCHOR_FOREIGN_PATH_CLEARANCE_PX
        && candidate.leaderClearance >= EDGE_LABEL_LEADER_FOREIGN_PATH_CLEARANCE_PX
        && candidate.leaderLength >= EDGE_LABEL_AMBIGUITY_LEADER_MIN_LENGTH_PX
        && candidate.leaderIsExterior;
    });
    const upstream = function upstreamOfLabel(candidate) {
      return candidate.leaderIsExterior
        && candidate.point.lengthAt < focus.point.lengthAt - EDGE_LABEL_AMBIGUITY_LEADER_MIN_LENGTH_PX;
    };
    const upstreamUnambiguous = unambiguous.filter(upstream);
    const usableUpstream = choices.filter(function enoughFallbackClearance(candidate) {
      return upstream(candidate)
        && clearanceScore(candidate) >= EDGE_LABEL_DETACHED_PATH_GAP_PX
        && candidate.leaderLength >= EDGE_LABEL_AMBIGUITY_LEADER_MIN_LENGTH_PX;
    });
    // 条件表达的是从 source 流向 target 的边。若上游已有可读的独占段，永远优先
    // 从那里回指，避免把短引线拖到 target 汇入处的线束里。
    const preferred = upstreamUnambiguous.length > 0
      ? upstreamUnambiguous
      : (unambiguous.length > 0 ? unambiguous : (usableUpstream.length > 0 ? usableUpstream : choices));
    const usesFallback = unambiguous.length === 0;
    preferred.sort(function compareAnchor(left, right) {
      if (usesFallback) {
        const leftClearance = Math.min(left.foreignClearance, left.leaderClearance);
        const rightClearance = Math.min(right.foreignClearance, right.leaderClearance);
        if (Math.abs(leftClearance - rightClearance) > OFFSET_EPSILON_PX) return rightClearance - leftClearance;
      }
      if (left.leaderIsExterior !== right.leaderIsExterior) return left.leaderIsExterior ? -1 : 1;
      const leftHasUsefulLeader = Math.abs(left.point.lengthAt - focus.point.lengthAt)
        >= EDGE_LABEL_AMBIGUITY_LEADER_MIN_LENGTH_PX;
      const rightHasUsefulLeader = Math.abs(right.point.lengthAt - focus.point.lengthAt)
        >= EDGE_LABEL_AMBIGUITY_LEADER_MIN_LENGTH_PX;
      if (leftHasUsefulLeader !== rightHasUsefulLeader) {
        return leftHasUsefulLeader ? -1 : 1;
      }
      if (Math.abs(left.pathTravel - right.pathTravel) > OFFSET_EPSILON_PX) return left.pathTravel - right.pathTravel;
      if (Math.abs(left.foreignClearance - right.foreignClearance) > OFFSET_EPSILON_PX) {
        return right.foreignClearance - left.foreignClearance;
      }
      if (Math.abs(left.leaderClearance - right.leaderClearance) > OFFSET_EPSILON_PX) {
        return right.leaderClearance - left.leaderClearance;
      }
      return right.labelClearance - left.labelClearance;
    });
    const selected = preferred[0];
    return {
      point: { x: selected.point.x, y: selected.point.y },
      foreignClearance: selected.foreignClearance,
      leaderClearance: selected.leaderClearance,
      mode: unambiguous.length > 0 ? 'clear-upstream-segment' : 'best-available-upstream-segment',
    };
  }

  // Mermaid 的路线由 SVG path 和祖先变换共同决定，不能把 path 本地坐标直接与屏幕
  // 标签框比较。用屏幕坐标采样估算最近距离，精度足够用于“是否贴着另一条边”的判定。
  function pathDistanceToRect(path, rect) {
    if (!path || typeof path.getTotalLength !== 'function' || !path.getScreenCTM()) return Infinity;
    const length = path.getTotalLength();
    if (!Number.isFinite(length)) return Infinity;
    const sampleCount = Math.max(20, Math.min(180, Math.ceil(length / 5)));
    let minimum = Infinity;
    for (let index = 0; index <= sampleCount; index += 1) {
      const localPoint = path.getPointAtLength(length * index / sampleCount);
      const screenPoint = new DOMPoint(localPoint.x, localPoint.y).matrixTransform(path.getScreenCTM());
      minimum = Math.min(minimum, pointToRectDistance(screenPoint, rect));
      if (minimum <= OFFSET_EPSILON_PX) return 0;
    }
    return minimum;
  }

  function rectAfterScreenTranslation(rect, dx, dy) {
    return {
      left: rect.left + dx,
      top: rect.top + dy,
      right: rect.right + dx,
      bottom: rect.bottom + dy,
      width: rect.width,
      height: rect.height,
    };
  }

  function rectClearance(first, second) {
    return Math.hypot(
      Math.max(first.left - second.right, second.left - first.right, 0),
      Math.max(first.top - second.bottom, second.top - first.bottom, 0),
    );
  }

  function rectsOverlapOrAreTooClose(first, second, gap = 0) {
    return first.left < second.right + gap
      && first.right > second.left - gap
      && first.top < second.bottom + gap
      && first.bottom > second.top - gap;
  }

  // 由真实边路径判断主阅读方向。不能只看节点坐标：复杂分组图里节点与 path 各自
  // 带有 transform，只有屏幕坐标才代表用户实际看到的“右侧”。
  function edgeScreenDirection(path) {
    const samples = sampledScreenPointsOnPath(path);
    if (samples.length < 2) return null;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    if (Math.abs(dx) >= Math.abs(dy)) return { axis: 'horizontal', sign: dx >= 0 ? 1 : -1 };
    return { axis: 'vertical', sign: dy >= 0 ? 1 : -1 };
  }

  // 当条件框被上游分组挡住时，优先放到所属线的下游一侧。对常见 LR 流程即“放在
  // 线的右侧空白带”，比仅按最近距离向上/向左闪避更符合读者的阅读方向。
  function downstreamSideCandidates(svgEl, edgeLabel, labelRect) {
    const edgeId = edgeLabel.getAttribute('data-icm-edge-id');
    const ownPath = edgeId
      ? edgePaths(svgEl).find(function ownPathForLabel(record) { return record.id === edgeId; })?.path
      : null;
    if (!ownPath) return [];
    captureEdgeLabelAnchor(svgEl, edgeLabel, labelRect);
    const anchorX = Number.parseFloat(edgeLabel.getAttribute('data-icm-edge-anchor-screen-x') || '');
    const anchorY = Number.parseFloat(edgeLabel.getAttribute('data-icm-edge-anchor-screen-y') || '');
    const direction = edgeScreenDirection(ownPath);
    if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY) || !direction) return [];

    if (direction.axis === 'horizontal') {
      const left = direction.sign > 0
        ? anchorX + EDGE_LABEL_DOWNSTREAM_GAP_PX
        : anchorX - labelRect.width - EDGE_LABEL_DOWNSTREAM_GAP_PX;
      const centeredTop = anchorY - labelRect.height / 2;
      return [
        {
          dx: left - labelRect.left,
          dy: centeredTop - labelRect.top,
          direction: direction.sign > 0 ? 'right' : 'left',
          placement: 'downstream-side',
          index: 0,
        },
        // 遇到紧邻下游分组的窄通道时，优先仍留在下游侧，只将胶囊轻微抬高/放低。
        {
          dx: left - labelRect.left,
          dy: anchorY - labelRect.height - EDGE_LABEL_DOWNSTREAM_GAP_PX - labelRect.top,
          direction: direction.sign > 0 ? 'right' : 'left',
          placement: 'downstream-side-above',
          index: 1,
        },
        {
          dx: left - labelRect.left,
          dy: anchorY + EDGE_LABEL_DOWNSTREAM_GAP_PX - labelRect.top,
          direction: direction.sign > 0 ? 'right' : 'left',
          placement: 'downstream-side-below',
          index: 2,
        },
      ];
    }

    const top = direction.sign > 0
      ? anchorY + EDGE_LABEL_DOWNSTREAM_GAP_PX
      : anchorY - labelRect.height - EDGE_LABEL_DOWNSTREAM_GAP_PX;
    return [{
      dx: anchorX - labelRect.width / 2 - labelRect.left,
      dy: top - labelRect.top,
      direction: direction.sign > 0 ? 'down' : 'up',
      placement: 'downstream-side',
      index: 0,
    }];
  }

  function candidateAmbiguityOffset(svgEl, edgeLabel, labelRect, obstacles, foreignPaths) {
    const svgRect = rectFromElement(svgEl);
    const orientation = edgeLabel.getAttribute('data-icm-edge-orientation');
    const offsets = orientation === 'horizontal'
      ? [
        { dx: 0, dy: -EDGE_LABEL_AMBIGUITY_OFFSET_PX },
        { dx: 0, dy: EDGE_LABEL_AMBIGUITY_OFFSET_PX },
        { dx: 0, dy: -EDGE_LABEL_AMBIGUITY_MAX_OFFSET_PX },
        { dx: 0, dy: EDGE_LABEL_AMBIGUITY_MAX_OFFSET_PX },
      ]
      : [
        { dx: EDGE_LABEL_AMBIGUITY_OFFSET_PX, dy: 0 },
        { dx: -EDGE_LABEL_AMBIGUITY_OFFSET_PX, dy: 0 },
        { dx: EDGE_LABEL_AMBIGUITY_MAX_OFFSET_PX, dy: 0 },
        { dx: -EDGE_LABEL_AMBIGUITY_MAX_OFFSET_PX, dy: 0 },
      ];
    // 某些曲线正好在垂直两侧夹住标签；此时单轴移动仍会压到另一条边，补充四个
    // 斜向候选，让“短引线+标签”整体从交叉区抽离。
    offsets.push(
      { dx: EDGE_LABEL_AMBIGUITY_DIAGONAL_OFFSET_PX, dy: -EDGE_LABEL_AMBIGUITY_DIAGONAL_OFFSET_PX },
      { dx: -EDGE_LABEL_AMBIGUITY_DIAGONAL_OFFSET_PX, dy: -EDGE_LABEL_AMBIGUITY_DIAGONAL_OFFSET_PX },
      { dx: EDGE_LABEL_AMBIGUITY_DIAGONAL_OFFSET_PX, dy: EDGE_LABEL_AMBIGUITY_DIAGONAL_OFFSET_PX },
      { dx: -EDGE_LABEL_AMBIGUITY_DIAGONAL_OFFSET_PX, dy: EDGE_LABEL_AMBIGUITY_DIAGONAL_OFFSET_PX },
    );

    const candidates = offsets.map(function toCandidate(offset, index) {
      const rect = rectAfterScreenTranslation(labelRect, offset.dx, offset.dy);
      const withinSvg = rect.left >= svgRect.left && rect.right <= svgRect.right
        && rect.top >= svgRect.top && rect.bottom <= svgRect.bottom;
      const clearance = obstacles.length === 0
        ? Infinity
        : Math.min.apply(null, obstacles.map(function clearanceToObstacle(obstacle) {
          return rectClearance(rect, obstacle);
        }));
      const foreignPathGap = foreignPaths.length === 0
        ? Infinity
        : Math.min.apply(null, foreignPaths.map(function clearanceToForeignPath(record) {
          return pathDistanceToRect(record.path, rect);
        }));
      return { dx: offset.dx, dy: offset.dy, rect, withinSvg, clearance, foreignPathGap, index };
    }).filter(function withinVisibleGraph(candidate) {
      return candidate.withinSvg;
    });

    if (candidates.length === 0) return null;
    const nonOverlapping = candidates.filter(function avoidsObstacles(candidate) {
      return !obstacles.some(function overlaps(obstacle) { return hasPositiveAreaOverlap(candidate.rect, obstacle); });
    });
    const choices = nonOverlapping.length > 0 ? nonOverlapping : candidates;
    choices.sort(function compareCandidates(left, right) {
      const leftClearsForeignPath = left.foreignPathGap >= EDGE_LABEL_AMBIGUITY_PATH_GAP_PX;
      const rightClearsForeignPath = right.foreignPathGap >= EDGE_LABEL_AMBIGUITY_PATH_GAP_PX;
      if (leftClearsForeignPath !== rightClearsForeignPath) return leftClearsForeignPath ? -1 : 1;
      if (!leftClearsForeignPath && Math.abs(left.foreignPathGap - right.foreignPathGap) > OFFSET_EPSILON_PX) {
        return right.foreignPathGap - left.foreignPathGap;
      }
      const leftDistance = Math.hypot(left.dx, left.dy);
      const rightDistance = Math.hypot(right.dx, right.dy);
      if (Math.abs(leftDistance - rightDistance) > OFFSET_EPSILON_PX) return leftDistance - rightDistance;
      if (Math.abs(left.clearance - right.clearance) > OFFSET_EPSILON_PX) return right.clearance - left.clearance;
      return left.index - right.index;
    });
    return choices[0];
  }

  // 条件框若贴到“不是自己的另一条线”，读者会自然误认归属。只在这种密集穿插
  // 场景最小错开，并让短引线从原边锚点回到条件框，明确形成一对。
  function separateAmbiguousCrossGroupLabels(svgEl, titleObstacles) {
    const labels = Array.from(svgEl.querySelectorAll('g.edgeLabel.icm-cross-group-edge-label'));
    const paths = edgePaths(svgEl);
    for (const edgeLabel of labels) {
      if (edgeLabel.hasAttribute('data-icm-edge-label-detached')) continue;
      const edgeId = edgeLabel.getAttribute('data-icm-edge-id');
      if (!edgeId) continue;
      const labelRect = edgeLabelBounds(edgeLabel);
      const foreignPaths = paths.filter(function foreignPath(record) { return record.id !== edgeId; });
      const nearestForeignPath = foreignPaths
        .reduce(function closestDistance(minimum, record) {
          return Math.min(minimum, pathDistanceToRect(record.path, labelRect));
        }, Infinity);
      if (nearestForeignPath > EDGE_LABEL_AMBIGUITY_PATH_GAP_PX) continue;

      const obstacles = labels
        .filter(function otherLabel(candidate) { return candidate !== edgeLabel; })
        .map(edgeLabelBounds)
        .concat(titleObstacles.map(visibleLabelBounds))
        .concat(Array.from(svgEl.querySelectorAll('g.node')).map(rectFromElement));
      // 对穿插边的标签，候选位置还必须远离其它路径：只避开文字框仍可能把标签
      // 放到另一条曲线上，恰好重新制造用户要消除的归属歧义。
      const offset = candidateAmbiguityOffset(svgEl, edgeLabel, labelRect, obstacles, foreignPaths);
      if (!offset) continue;
      markEdgeLabelDetached(svgEl, edgeLabel, labelRect);
      translateTitleByScreen(svgEl, edgeLabel, labelRect, offset.dx, offset.dy);
      edgeLabel.setAttribute('data-icm-ambiguity-separated', 'true');
    }
  }

  // 只有条件标签因碰撞或连线歧义被移离原边时，短引线和锚点圆点才出现；默认标签
  // 留在 Mermaid 放置的原边上，避免让所有关系都平添噪声。
  function ensureEdgeLeaderLayer(svgEl) {
    let layer = Array.from(svgEl.children).find(function isLeaderLayer(child) {
      return child.matches && child.matches('g.icm-edge-label-leader-layer');
    });
    if (!layer) {
      layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      layer.setAttribute('class', 'icm-edge-label-leader-layer');
      layer.setAttribute('aria-hidden', 'true');
      // 放在 SVG 顶层末尾：不受 Mermaid edgeLabels 的局部 transform 影响，也不会被
      // 其它路径覆盖。线端精确落在条件框边界，因此不会画到条件文字上。
      svgEl.appendChild(layer);
    }
    return layer;
  }

  function renderDetachedEdgeLeaders(svgEl) {
    const layer = ensureEdgeLeaderLayer(svgEl);
    layer.replaceChildren();
    for (const edgeLabel of svgEl.querySelectorAll('g.edgeLabel[data-icm-edge-label-detached="true"]')) {
      const edgeId = edgeLabel.getAttribute('data-icm-edge-id');
      const ownPath = edgeId
        ? edgePaths(svgEl).find(function ownPathForLabel(record) { return record.id === edgeId; })?.path
        : null;
      const foreignPaths = edgePaths(svgEl).filter(function foreignPathForLabel(record) {
        return record.id !== edgeId;
      });
      const labelRect = edgeLabelBounds(edgeLabel);
      const relationship = ownPath
        ? classifyLabelEdgeRelationship(ownPath, foreignPaths, labelRect)
        : { naturallyReadable: false, ownGap: Infinity, foreignGap: Infinity };
      // 仅“连线歧义避让”允许回到无引线的自然贴边状态；被分组标题推开的标签即使
      // 此刻仍压着自己的边，也已经不在 Mermaid 原始位置，必须保留回指以免误读。
      const relocatedOntoOwnPath = edgeLabel.getAttribute('data-icm-title-relocated-on-path') === 'true';
      if (relationship.naturallyReadable
        && edgeLabel.getAttribute('data-icm-handoff-collision-separated') !== 'true'
        && (relocatedOntoOwnPath || edgeLabel.getAttribute('data-icm-title-separated') !== 'true')) {
        edgeLabel.setAttribute('data-icm-edge-leader-visible', 'false');
        edgeLabel.setAttribute('data-icm-edge-leader-suppressed-reason', 'naturally-readable');
        continue;
      }
      // 标签与其它边发生歧义时才从独占边段重新取锚点。标题避让导致的普通偏移保留
      // 原锚点，避免每次修复都把引线改指向另一段业务线。
      if (edgeLabel.getAttribute('data-icm-ambiguity-separated') === 'true' && ownPath) {
        // 这里允许强制重算：评分会避开交叉点、优先上游段，并保留足够可见长度。
        updateEdgeLabelAnchor(svgEl, edgeLabel, labelRect, true);
      }
      const anchorX = Number.parseFloat(edgeLabel.getAttribute('data-icm-edge-anchor-x') || '');
      const anchorY = Number.parseFloat(edgeLabel.getAttribute('data-icm-edge-anchor-y') || '');
      const anchorScreenX = Number.parseFloat(edgeLabel.getAttribute('data-icm-edge-anchor-screen-x') || '');
      const anchorScreenY = Number.parseFloat(edgeLabel.getAttribute('data-icm-edge-anchor-screen-y') || '');
      if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)
        || !Number.isFinite(anchorScreenX) || !Number.isFinite(anchorScreenY)) continue;
      const labelEdge = rectConnectionPointTowards({ x: anchorScreenX, y: anchorScreenY }, labelRect);
      if (Math.hypot(anchorScreenX - labelEdge.x, anchorScreenY - labelEdge.y) < 0.25) continue;
      edgeLabel.setAttribute('data-icm-edge-leader-visible', 'true');
      edgeLabel.removeAttribute('data-icm-edge-leader-suppressed-reason');
      const end = screenToLocal(svgEl, svgEl, labelEdge.x, labelEdge.y);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'icm-edge-label-leader');
      line.setAttribute('data-icm-edge-id', edgeLabel.getAttribute('data-icm-edge-id') || '');
      if (edgeLabel.getAttribute('data-icm-label-kind') === 'condition') {
        line.setAttribute('data-icm-condition-edge-id', edgeLabel.getAttribute('data-icm-edge-id') || '');
      }
      if (edgeLabel.getAttribute('data-icm-ambiguity-separated') === 'true') {
        line.setAttribute('data-icm-ambiguity-separated', 'true');
      }
      line.setAttribute('x1', String(anchorX));
      line.setAttribute('y1', String(anchorY));
      line.setAttribute('x2', String(end.x));
      line.setAttribute('y2', String(end.y));
      layer.appendChild(line);
      const anchor = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      anchor.setAttribute('class', 'icm-edge-label-anchor-dot');
      anchor.setAttribute('data-icm-edge-id', edgeLabel.getAttribute('data-icm-edge-id') || '');
      if (edgeLabel.getAttribute('data-icm-label-kind') === 'condition') {
        anchor.setAttribute('data-icm-condition-edge-id', edgeLabel.getAttribute('data-icm-edge-id') || '');
      }
      anchor.setAttribute('cx', String(anchorX));
      anchor.setAttribute('cy', String(anchorY));
      anchor.setAttribute('r', '2.5');
      layer.appendChild(anchor);
    }
  }

  // 多条跨组边汇入同一节点时，Mermaid 可能把关系标签落在同一位置。按边的主方向
  // 在垂直/水平方向错开，保持每条条件都可读，而不是让两个标签叠成一个词块。
  function separateOverlappingCrossGroupLabels(svgEl) {
    const svgRect = rectFromElement(svgEl);
    const labels = Array.from(svgEl.querySelectorAll('g.edgeLabel.icm-cross-group-edge-label'));
    const placed = [];
    for (const edgeLabel of labels) {
      let labelRect = edgeLabelBounds(edgeLabel);
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const previous = placed.find(function firstCollision(candidate) {
          return hasPositiveAreaOverlap(labelRect, edgeLabelBounds(candidate));
        });
        if (!previous) break;
        const previousRect = edgeLabelBounds(previous);
        const overlapWidth = Math.min(labelRect.right, previousRect.right) - Math.max(labelRect.left, previousRect.left);
        const overlapHeight = Math.min(labelRect.bottom, previousRect.bottom) - Math.max(labelRect.top, previousRect.top);
        if (overlapWidth <= 0 || overlapHeight <= 0) break;

        const orientation = edgeLabel.getAttribute('data-icm-edge-orientation');
        let dx = 0;
        let dy = 0;
        if (orientation === 'horizontal') {
          const required = overlapHeight + CROSS_GROUP_EDGE_LABEL_GAP_PX;
          const spaceAbove = labelRect.top - svgRect.top;
          const spaceBelow = svgRect.bottom - labelRect.bottom;
          const preferBelow = labelRect.top + labelRect.height / 2 >= previousRect.top + previousRect.height / 2;
          if (preferBelow && spaceBelow >= required) dy = required;
          else if (!preferBelow && spaceAbove >= required) dy = -required;
          else if (spaceBelow >= spaceAbove && spaceBelow >= required) dy = required;
          else if (spaceAbove >= required) dy = -required;
        } else {
          const required = overlapWidth + CROSS_GROUP_EDGE_LABEL_GAP_PX;
          const spaceLeft = labelRect.left - svgRect.left;
          const spaceRight = svgRect.right - labelRect.right;
          const preferRight = labelRect.left + labelRect.width / 2 >= previousRect.left + previousRect.width / 2;
          if (preferRight && spaceRight >= required) dx = required;
          else if (!preferRight && spaceLeft >= required) dx = -required;
          else if (spaceRight >= spaceLeft && spaceRight >= required) dx = required;
          else if (spaceLeft >= required) dx = -required;
        }
        if (Math.abs(dx) <= OFFSET_EPSILON_PX && Math.abs(dy) <= OFFSET_EPSILON_PX) break;
        markEdgeLabelDetached(svgEl, edgeLabel, labelRect);
        translateTitleByScreen(svgEl, edgeLabel, labelRect, dx, dy);
        edgeLabel.setAttribute('data-icm-handoff-collision-separated', 'true');
        labelRect = edgeLabelBounds(edgeLabel);
      }
      placed.push(edgeLabel);
    }
  }

  // 上一层按“逐个放置”的方式能处理绝大多数重叠，但一条横向的长条件与一条
  // 竖向条件同时经过同一汇入区时，前者可能在后续轮次只挪开一部分又被重新压回。
  // 这里仅收尾处理仍有正面积相交的标签：每次把后出现的标签完整移出冲突矩形，
  // 并同时避开标题、节点和分组框。不会改动任何 Mermaid 路径或节点端口。
  function resolveResidualCrossGroupLabelCollisions(svgEl, groupLabels) {
    const svgRect = rectFromElement(svgEl);
    const labels = Array.from(svgEl.querySelectorAll('g.edgeLabel.icm-cross-group-edge-label'));
    const contentObstacles = Array.from(svgEl.querySelectorAll('g.node')).map(rectFromElement)
      .concat(groupLabels.map(visibleLabelBounds));
    const frameObstacles = Array.from(svgEl.querySelectorAll('g.cluster[data-subgraph]')).map(clusterFrameBounds)
      .filter(function visibleFrame(rect) { return rect.width > 0 && rect.height > 0; });
    const isFreeOfLabelsAndContent = function candidateIsFreeOfLabelsAndContent(candidateRect, label) {
      const otherLabels = labels.filter(function otherLabel(other) { return other !== label; });
      const overlapsLabel = otherLabels.some(function overlapsOther(other) {
        return hasPositiveAreaOverlap(candidateRect, edgeLabelBounds(other));
      });
      const overlapsContent = contentObstacles.some(function overlapsContentObstacle(obstacle) {
        return hasPositiveAreaOverlap(candidateRect, obstacle);
      });
      return !overlapsLabel && !overlapsContent;
    };
    const isValidCandidate = function candidateIsClear(candidateRect, label) {
      if (!isFreeOfLabelsAndContent(candidateRect, label)) return false;
      const crowdsFrame = frameObstacles.some(function crowdsFrameObstacle(frame) {
        return rectsOverlapOrAreTooClose(candidateRect, frame, EDGE_LABEL_CLUSTER_GAP_PX);
      });
      return !crowdsFrame;
    };

    for (let pass = 0; pass < 8; pass += 1) {
      let moved = false;
      for (let index = 0; index < labels.length; index += 1) {
        const edgeLabel = labels[index];
        const labelRect = edgeLabelBounds(edgeLabel);
        const collisions = labels.slice(0, index).map(function priorCollision(other) {
          const otherRect = edgeLabelBounds(other);
          const overlapWidth = Math.min(labelRect.right, otherRect.right) - Math.max(labelRect.left, otherRect.left);
          const overlapHeight = Math.min(labelRect.bottom, otherRect.bottom) - Math.max(labelRect.top, otherRect.top);
          return { otherRect, overlapWidth, overlapHeight };
        }).filter(function positiveOverlap(collision) {
          return collision.overlapWidth > OFFSET_EPSILON_PX && collision.overlapHeight > OFFSET_EPSILON_PX;
        });
        if (collisions.length === 0) continue;

        const largest = collisions.reduce(function largestOverlap(best, collision) {
          return collision.overlapWidth * collision.overlapHeight > best.overlapWidth * best.overlapHeight
            ? collision
            : best;
        });
        const orientation = edgeLabel.getAttribute('data-icm-edge-orientation');
        const horizontalDistance = Math.max.apply(null, collisions.map(function horizontalClearance(collision) {
          return collision.overlapWidth + CROSS_GROUP_EDGE_LABEL_GAP_PX;
        }));
        const verticalDistance = Math.max.apply(null, collisions.map(function verticalClearance(collision) {
          return collision.overlapHeight + CROSS_GROUP_EDGE_LABEL_GAP_PX;
        }));
        const labelCenterX = labelRect.left + labelRect.width / 2;
        const labelCenterY = labelRect.top + labelRect.height / 2;
        const otherCenterX = largest.otherRect.left + largest.otherRect.width / 2;
        const otherCenterY = largest.otherRect.top + largest.otherRect.height / 2;
        const primary = orientation === 'horizontal'
          ? [
            { dx: 0, dy: labelCenterY <= otherCenterY ? -verticalDistance : verticalDistance },
            { dx: 0, dy: labelCenterY <= otherCenterY ? verticalDistance : -verticalDistance },
          ]
          : [
            { dx: labelCenterX <= otherCenterX ? -horizontalDistance : horizontalDistance, dy: 0 },
            { dx: labelCenterX <= otherCenterX ? horizontalDistance : -horizontalDistance, dy: 0 },
          ];
        const secondary = orientation === 'horizontal'
          ? [{ dx: -horizontalDistance, dy: 0 }, { dx: horizontalDistance, dy: 0 }]
          : [{ dx: 0, dy: -verticalDistance }, { dx: 0, dy: verticalDistance }];
        const options = primary.concat(secondary).map(function candidateFor(offset, optionIndex) {
          const rect = rectAfterScreenTranslation(labelRect, offset.dx, offset.dy);
          const withinSvg = rect.left >= svgRect.left && rect.right <= svgRect.right
            && rect.top >= svgRect.top && rect.bottom <= svgRect.bottom;
          return { ...offset, rect, withinSvg, optionIndex };
        }).filter(function visibleCandidate(candidate) { return candidate.withinSvg; });
        const clearOptions = options.filter(function clearCandidate(candidate) {
          return isValidCandidate(candidate.rect, edgeLabel);
        });
        // 分组框边线只是次级障碍；若它让所有选择都失效，也不能放任两个条件文字
        // 叠在一起。退回时仍严格保证不压任何标签、节点或标题。
        const usableOptions = clearOptions.length > 0
          ? clearOptions
          : options.filter(function avoidsPrimaryContent(candidate) {
            return isFreeOfLabelsAndContent(candidate.rect, edgeLabel);
          });
        if (usableOptions.length === 0) continue;
        usableOptions.sort(function smallestMove(left, right) {
          const leftDistance = Math.hypot(left.dx, left.dy);
          const rightDistance = Math.hypot(right.dx, right.dy);
          if (Math.abs(leftDistance - rightDistance) > OFFSET_EPSILON_PX) return leftDistance - rightDistance;
          return left.optionIndex - right.optionIndex;
        });
        const move = usableOptions[0];
        markEdgeLabelDetached(svgEl, edgeLabel, labelRect);
        translateTitleByScreen(svgEl, edgeLabel, labelRect, move.dx, move.dy);
        edgeLabel.setAttribute('data-icm-handoff-collision-separated', 'true');
        edgeLabel.setAttribute('data-icm-residual-collision-separated', 'true');
        moved = true;
      }
      if (!moved) break;
    }
  }

  // 当条件线本身有足够长的独占段时，优先把条件胶囊重新落到该线段上，而不是
  // 把它挤在分组页签正上方。这样分组标题保留自己的阅读区，读者也能直接沿线
  // 识别条件归属，不必再依赖一根跨越很长距离的回指引线。
  function relocateTitleConflictingLabelOntoOwnPath(svgEl, edgeLabel, labelRect, titleRects) {
    const edgeId = edgeLabel.getAttribute('data-icm-edge-id');
    const ownRecord = edgeId ? edgeRecordForId(svgEl, edgeId) : null;
    if (!ownRecord) return false;
    const svgRect = rectFromElement(svgEl);
    const ownSamples = sampledScreenPointsOnPath(ownRecord.path);
    if (ownSamples.length === 0) return false;
    const otherLabels = Array.from(svgEl.querySelectorAll('g.edgeLabel')).filter(function otherLabel(label) {
      return label !== edgeLabel;
    });
    const nodes = Array.from(svgEl.querySelectorAll('g.node'));
    const foreignPaths = edgePaths(svgEl).filter(function foreignPath(record) {
      return record.id !== edgeId;
    });
    const focus = { x: labelRect.left + labelRect.width / 2, y: labelRect.top + labelRect.height / 2 };
    const candidates = ownSamples.map(function sampleCandidate(sample) {
      const rect = {
        left: sample.x - labelRect.width / 2,
        top: sample.y - labelRect.height / 2,
        right: sample.x + labelRect.width / 2,
        bottom: sample.y + labelRect.height / 2,
        width: labelRect.width,
        height: labelRect.height,
      };
      const titleClearance = titleRects.length === 0 ? Infinity : Math.min.apply(null, titleRects.map(function titleGap(title) {
        return rectClearance(rect, title.rect);
      }));
      const foreignPathGap = foreignPaths.length === 0 ? Infinity : Math.min.apply(null, foreignPaths.map(function foreignGap(record) {
        return pathDistanceToRect(record.path, rect);
      }));
      return {
        sample,
        rect,
        titleClearance,
        foreignPathGap,
        distanceFromOriginal: Math.hypot(sample.x - focus.x, sample.y - focus.y),
        withinSvg: rect.left >= svgRect.left && rect.right <= svgRect.right
          && rect.top >= svgRect.top && rect.bottom <= svgRect.bottom,
      };
    }).filter(function isClearPathPlacement(candidate) {
      if (!candidate.withinSvg || candidate.distanceFromOriginal < EDGE_LABEL_TITLE_GAP_PX) return false;
      if (titleRects.some(function crowdsTitle(title) {
        return needsTitleClearance(candidate.rect, title.rect);
      })) return false;
      if (otherLabels.some(function overlapsOtherLabel(other) {
        return hasPositiveAreaOverlap(candidate.rect, edgeLabelBounds(other));
      })) return false;
      if (nodes.some(function overlapsNode(node) {
        return hasPositiveAreaOverlap(candidate.rect, rectFromElement(node));
      })) return false;
      return candidate.foreignPathGap >= EDGE_LABEL_NATURAL_FOREIGN_PATH_GAP_PX;
    });
    if (candidates.length === 0) return false;
    candidates.sort(function compareReadablePathSegment(left, right) {
      // 先脱离页签周围的拥挤带，再选择与原位置距离较近的所属线段。
      if (Math.abs(left.titleClearance - right.titleClearance) > OFFSET_EPSILON_PX) {
        return right.titleClearance - left.titleClearance;
      }
      if (Math.abs(left.foreignPathGap - right.foreignPathGap) > OFFSET_EPSILON_PX) {
        return right.foreignPathGap - left.foreignPathGap;
      }
      return left.distanceFromOriginal - right.distanceFromOriginal;
    });
    const target = candidates[0];
    markEdgeLabelDetached(svgEl, edgeLabel, labelRect);
    translateTitleByScreen(svgEl, edgeLabel, labelRect,
      target.sample.x - focus.x,
      target.sample.y - focus.y);
    edgeLabel.setAttribute('data-icm-title-separated', 'true');
    edgeLabel.setAttribute('data-icm-title-relocated-on-path', 'true');
    return true;
  }

  // 跨分组连线的条件标签通常正好落在下一分组标题附近。优先挪到自己路径的
  // 空段；只有路径不存在足够净空时，才使用最小的垂直避让作为保底。
  function separateEdgeLabelsFromGroupTitles(svgEl, labels) {
    const titleRects = labels.map(function titleWithRect(label) {
      return { label, rect: visibleLabelBounds(label) };
    });
    for (const edgeLabel of svgEl.querySelectorAll('g.edgeLabel')) {
      if (edgeLabel.getAttribute('data-icm-title-separated') === 'true') continue;
      const edgeRect = edgeLabelBounds(edgeLabel);
      const overlappingTitles = titleRects.filter(function needsVisualClearance(title) {
        return needsTitleClearance(edgeRect, title.rect);
      });
      if (overlappingTitles.length === 0) continue;
      if (relocateTitleConflictingLabelOntoOwnPath(svgEl, edgeLabel, edgeRect, titleRects)) continue;
      const requiredLift = Math.max.apply(null, overlappingTitles.map(function liftFor(title) {
        return edgeRect.bottom - title.rect.top + EDGE_LABEL_TITLE_GAP_PX;
      }));
      markEdgeLabelDetached(svgEl, edgeLabel, edgeRect);
      translateTitleByScreen(svgEl, edgeLabel, edgeRect, 0, -requiredLift);
      edgeLabel.setAttribute('data-icm-title-separated', 'true');
    }
  }

  // 条件框不能压到分组框的边线或填充区域里。标题避让只知道标题本身，无法覆盖
  // 条件横跨两个相邻分组时的“压边”问题；这里把完整分组框作为第二道障碍，并用
  // 最小水平/垂直位移把条件带离框体。原边锚点在移动前保存，随后会由短引线回指。
  function separateEdgeLabelsFromClusterFrames(svgEl) {
    const svgRect = rectFromElement(svgEl);
    const clusters = Array.from(svgEl.querySelectorAll('g.cluster[data-subgraph]')).map(function clusterFrame(cluster) {
      return clusterFrameBounds(cluster);
    }).filter(function visibleCluster(rect) {
      return rect.width > 0 && rect.height > 0;
    });
    for (const edgeLabel of svgEl.querySelectorAll('g.edgeLabel.icm-cross-group-edge-label')) {
      let labelRect = edgeLabelBounds(edgeLabel);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const obstacle = clusters.find(function collidingCluster(clusterRect) {
          return rectsOverlapOrAreTooClose(labelRect, clusterRect, EDGE_LABEL_CLUSTER_GAP_PX);
        });
        if (!obstacle) break;
        const isClear = function isClearOfClusters(candidate) {
          return !clusters.some(function overlapsCluster(clusterRect) {
            return rectsOverlapOrAreTooClose(candidate.rect, clusterRect, EDGE_LABEL_CLUSTER_GAP_PX);
          });
        };
        const downstreamOptions = downstreamSideCandidates(svgEl, edgeLabel, labelRect).map(function toDownstreamCandidate(candidate) {
          const rect = rectAfterScreenTranslation(labelRect, candidate.dx, candidate.dy);
          const withinSvg = rect.left >= svgRect.left && rect.right <= svgRect.right
            && rect.top >= svgRect.top && rect.bottom <= svgRect.bottom;
          return { ...candidate, rect, withinSvg, overlapsAnyCluster: !isClear({ rect }) };
        }).filter(function staysVisibleAndClear(candidate) {
          return candidate.withinSvg && !candidate.overlapsAnyCluster;
        });
        const options = [
          // 横向主流程中，跨组条件通常是从左向右流动。若右侧有足够空间，优先把
          // 标签放到右侧空白带：读者沿箭头方向阅读，且不会把长条件塞回上游分组边。
          { dx: obstacle.right + EDGE_LABEL_CLUSTER_GAP_PX - labelRect.left, dy: 0, direction: 'right' },
          { dx: obstacle.left - EDGE_LABEL_CLUSTER_GAP_PX - labelRect.right, dy: 0, direction: 'left' },
          { dx: 0, dy: obstacle.top - EDGE_LABEL_CLUSTER_GAP_PX - labelRect.bottom },
          { dx: 0, dy: obstacle.bottom + EDGE_LABEL_CLUSTER_GAP_PX - labelRect.top },
        ].map(function toCandidate(offset, index) {
          const rect = rectAfterScreenTranslation(labelRect, offset.dx, offset.dy);
          const withinSvg = rect.left >= svgRect.left && rect.right <= svgRect.right
            && rect.top >= svgRect.top && rect.bottom <= svgRect.bottom;
          const overlapsAnyCluster = !isClear({ rect });
          return { ...offset, rect, withinSvg, overlapsAnyCluster, index };
        }).filter(function staysVisible(candidate) {
          return candidate.withinSvg;
        });
        const clearOptions = options.filter(function avoidsAllClusters(candidate) {
          return !candidate.overlapsAnyCluster;
        });
        const choices = downstreamOptions.length > 0
          ? downstreamOptions
          : (clearOptions.length > 0 ? clearOptions : options);
        if (choices.length === 0) break;
        choices.sort(function shortestClearMove(left, right) {
          const leftRightward = left.direction === 'right';
          const rightRightward = right.direction === 'right';
          if (leftRightward !== rightRightward) return leftRightward ? -1 : 1;
          const leftDistance = Math.hypot(left.dx, left.dy);
          const rightDistance = Math.hypot(right.dx, right.dy);
          if (Math.abs(leftDistance - rightDistance) > OFFSET_EPSILON_PX) return leftDistance - rightDistance;
          return left.index - right.index;
        });
        const move = choices[0];
        if (Math.abs(move.dx) <= OFFSET_EPSILON_PX && Math.abs(move.dy) <= OFFSET_EPSILON_PX) break;
        if (!edgeLabel.hasAttribute('data-icm-edge-label-detached')) {
          markEdgeLabelDetached(svgEl, edgeLabel, labelRect);
        }
        translateTitleByScreen(svgEl, edgeLabel, labelRect, move.dx, move.dy);
        edgeLabel.setAttribute('data-icm-cluster-separated', 'true');
        edgeLabel.setAttribute('data-icm-cluster-placement', move.placement || move.direction || 'nearest');
        labelRect = edgeLabelBounds(edgeLabel);
      }
    }
  }

  function detectAndRepairSubgraphTitles(svgEl) {
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    compactClusterFramesToNodes(svgEl);
    const groupLabels = Array.from(svgEl.querySelectorAll('.cluster-label[data-subgraph]'));
    for (const label of groupLabels) {
      centerTitleWithinCluster(svgEl, label);
    }
    // htmlLabels 在首次设置宽度时才会完成换行布局。第二次收敛以最终页签高度
    // 计算框体留白，避免多行标题只按第一行高度扩出一部分空间。
    for (let pass = 0; pass < 2; pass += 1) {
      expandClusterFramesForTitleClearance(svgEl, groupLabels);
      // 框体向上扩展后，页签应随新顶部重新定位；只有长标题分组会产生实际位移。
      for (const label of groupLabels) {
        centerTitleWithinCluster(svgEl, label);
      }
    }
    // 路径仍完全保留 Mermaid 的布局。只有标签实际压到分组标题时才最小上移，
    // 并从它原本所属路径画短回指；不再处理路径、端口或其它“看起来可优化”的
    // 情况，避免复杂图在多轮几何处理后再次失去关系归属。
    separateEdgeLabelsFromGroupTitles(svgEl, groupLabels);
    // 多个已避让标签不能占用同一个空位。一个后加入的标签还可能压回前一个
    // 已放置标签，因此有限轮次地收敛；原路径和端口始终保持不变。
    for (let pass = 0; pass < 3; pass += 1) {
      separateOverlappingCrossGroupLabels(svgEl);
    }
    resolveResidualCrossGroupLabelCollisions(svgEl, groupLabels);
    renderDetachedEdgeLeaders(svgEl);
    for (const label of groupLabels) label.setAttribute('pointer-events', 'none');
  }

  function createReactUi(React, ReactDOM) {
    const h = React.createElement;
    const useEffect = React.useEffect;
    const useLayoutEffect = React.useLayoutEffect;
    const useRef = React.useRef;
    const useState = React.useState;

    function Toolbar(props) {
      const panZoom = props.panZoom;
      const copy = uiCopyForLocale(props.locale);
      return h('div', { className: 'icm-controls' },
        h('div', { className: 'icm-toolbar', role: 'toolbar', 'aria-label': copy.graphControls },
          h('button', { type: 'button', onClick: function zoomIn() { panZoom.zoomIn(); }, 'aria-label': copy.zoomIn }, '+'),
          h('button', { type: 'button', onClick: function zoomOut() { panZoom.zoomOut(); }, 'aria-label': copy.zoomOut }, '−'),
          h('button', { type: 'button', onClick: function fit() { panZoom.fitToScreen(); }, 'aria-label': copy.fitAriaLabel }, copy.fit),
        ),
        h('p', { className: 'icm-interaction-hint' },
          h('span', { className: 'icm-interaction-hint-icon', 'aria-hidden': 'true' }, 'i'),
          copy.interactionHint,
        ),
      );
    }

    function Legend(props) {
      const copy = uiCopyForLocale(props.locale);
      return h('div', { className: 'icm-legend', role: 'group', 'data-icm-ui-locale': props.locale, 'aria-label': copy.ariaLabel },
        h('div', { className: 'icm-legend-section', 'aria-label': copy.reading },
          h('span', { className: 'icm-legend-caption' }, copy.reading),
          h('span', { className: 'icm-reading-key group' }, copy.group),
          h('span', { className: 'icm-reading-key condition' }, copy.condition),
          h('span', { className: 'icm-reading-key action' }, copy.action),
          h('span', { className: 'icm-reading-key internal' }, copy.internal),
        ),
        h('div', { className: 'icm-legend-section', 'aria-label': copy.evidence },
          h('span', { className: 'icm-legend-caption' }, copy.evidence),
          h('span', { className: 'claim-state verified' }, copy.verified),
          h('span', { className: 'claim-state inferred' }, copy.inferred),
          h('span', { className: 'claim-state unconfirmed' }, copy.unconfirmed),
        ),
        h('div', { className: 'icm-legend-section icm-operation-guide', 'aria-label': copy.controls },
          h('span', { className: 'icm-legend-caption' }, copy.controls),
          h('span', { className: 'icm-operation-pointer' }, copy.interactionHint),
          h('span', { className: 'icm-operation-separator', 'aria-hidden': 'true' }, '·'),
          h('kbd', null, 'Tab'), h('span', { className: 'icm-operation-label' }, copy.tabAction),
          h('kbd', null, 'Enter'), h('span', { className: 'icm-operation-label' }, copy.enterAction),
          h('kbd', null, 'Esc'), h('span', { className: 'icm-operation-label' }, copy.escapeAction),
        ),
      );
    }

    function SegmentTable(props) {
      const segment = props.segment;
      return h('section', { className: 'icm-segment seg-' + segment.kind },
        h('h3', null, segment.title),
        segment.subtitle ? h('p', { className: 'seg-subtitle' }, segment.subtitle) : null,
        h('table', null,
          h('thead', null, h('tr', null, segment.headers.map(function header(value, index) {
            return h('th', { key: index }, value);
          }))),
          h('tbody', null, segment.rows.map(function row(cells, rowIndex) {
            return h('tr', { key: rowIndex }, cells.map(function cell(value, cellIndex) {
              return h('td', { key: cellIndex }, value);
            }));
          })),
        ),
      );
    }

    function DetailPanel(props) {
      const node = props.node;
      const copy = uiCopyForLocale(props.locale);
      const panelRef = useRef(null);
      const scrollRef = useRef(null);
      useEffect(function focusPanel() {
        if (node && panelRef.current) panelRef.current.focus();
      }, [node]);
      // 每个节点各自保存阅读进度：新节点没有记录时自然从顶部开始；返回已读节点时，
      // 在浏览器绘制前恢复其记录，避免先闪回顶部再跳到中间。
      useLayoutEffect(function restoreNodeScrollPosition() {
        if (!node) return;
        const scrollRegion = scrollRef.current;
        if (!scrollRegion) return;
        const saved = props.scrollPositions.current.get(node.id);
        scrollRegion.scrollTop = Number.isFinite(saved) ? saved : 0;
      }, [node ? node.id : null, props.scrollPositions]);
      if (!node) return null;
      return h('aside', {
        ref: panelRef,
        id: 'detail-panel',
        role: 'dialog',
        'aria-label': node.title,
        tabIndex: -1,
        onKeyDown: function closeOnEscape(event) {
          if (event.key === 'Escape') props.onClose();
        },
      },
      h('button', { type: 'button', className: 'icm-close', onClick: props.onClose, 'aria-label': copy.closeDetail }, '×'),
      h('div', {
        key: node.id,
        ref: scrollRef,
        className: 'icm-detail-scroll',
        onScroll: function rememberNodeScroll(event) {
          props.scrollPositions.current.set(node.id, event.currentTarget.scrollTop);
        },
      },
        h('h2', null, node.title),
        h('span', { className: 'claim-state ' + node.claimState }, claimStateLabel(props.locale, node.claimState)),
        h('p', { className: 'icm-summary' }, node.detail.summary),
        node.detail.segments.length === 0
          ? h('p', { className: 'icm-empty' }, copy.emptyDetail)
          : node.detail.segments.map(function segmentView(segment, index) {
            return h(SegmentTable, { key: index, segment });
          }),
        h('section', { className: 'icm-evidence' },
          h('h3', null, copy.evidence),
          h('ul', null, node.evidence.map(function evidenceView(evidence, index) {
            const lineRange = evidence.lineStart || evidence.lineEnd
              ? ' [' + (evidence.lineStart || '?') + '-' + (evidence.lineEnd || '?') + ']'
              : '';
            return h('li', { key: index, className: 'evidence ' + evidence.state },
              h('span', { className: 'ev-path' }, evidence.path),
              evidence.symbol ? h('span', { className: 'ev-symbol' }, ':' + evidence.symbol) : null,
              h('span', { className: 'ev-lines' }, lineRange),
              h('span', { className: 'ev-state' }, ' (' + claimStateLabel(props.locale, evidence.state) + ')'),
            );
          })),
        ),
      ));
    }

    function App(props) {
      const state = useState(selectedNodeId);
      const selectedId = state[0];
      const setSelectedId = state[1];
      const scrollPositions = useRef(new Map());
      // 图例本身属于本组件。layout effect 执行时它已经进入 DOM；在这里同步 Fit，
      // 才不会出现页面首帧先按整张画布缩放、随后才避让图例的短暂错误状态。
      useLayoutEffect(function fitAfterLegendLayout() {
        props.panZoom.fitToScreen();
      }, [props.panZoom]);
      useEffect(function subscribeSelection() {
        const unsubscribe = onSelectedChange(setSelectedId);
        // SVG 事件绑定会早于 React effect 就绪。若用户在这段极短窗口内
        // 点击节点，读取当前全局选择可避免首击状态被订阅时序丢失。
        setSelectedId(selectedNodeId);
        return unsubscribe;
      }, []);
      useEffect(function focusSelectedNode() {
        if (!selectedId) return undefined;
        const frameId = window.requestAnimationFrame(function centerNodeInVisibleCanvas() {
          props.panZoom.focusNode(selectedId, { avoidDetailPanel: true });
        });
        return function cancelFocus() {
          window.cancelAnimationFrame(frameId);
        };
      }, [selectedId, props.panZoom]);
      const selected = selectedId ? props.spec.nodes.find(function findNode(node) {
        return node.id === selectedId;
      }) : null;
      const uiLocale = uiLocaleForSpec(props.spec);
      return h('div', { className: 'icm-overlay' },
        h(Toolbar, { panZoom: props.panZoom, locale: uiLocale }),
        h(Legend, { locale: uiLocale }),
        h(DetailPanel, { node: selected, onClose: clearSelection, scrollPositions, locale: uiLocale }),
      );
    }

    return {
      mount: function mount(spec, panZoom) {
        const app = document.getElementById('app');
        if (!app) throw new Error('缺少 React 挂载点');
        if (!reactRoot) reactRoot = ReactDOM.createRoot(app);
        reactRoot.render(h(App, { spec, panZoom }));
      },
    };
  }

  function mountReact(spec, panZoom) {
    if (!window.React || !window.ReactDOM) throw new Error('React 依赖尚未加载');
    const ui = createReactUi(window.React, window.ReactDOM);
    ui.mount(spec, panZoom);
  }

  async function main() {
    const spec = window.__ICM_MAPSPEC__;
    const depsConfig = window.__ICM_DEPS_CONFIG__;
    try {
      await depsLoader(depsConfig);
      const viewport = document.getElementById('graph-viewport');
      const canvas = document.getElementById('graph-canvas');
      if (!viewport || !canvas) throw new Error('缺少图谱视口或画布');
      const svgEl = await renderGraph(spec, canvas);
      applySubgraphTones(svgEl, spec);
      bindNodeEvents(svgEl, spec);
      annotateEdgeLabels(svgEl, spec);
      ensureForeignObjectTextFits(svgEl);
      const panZoom = createPanZoom(viewport, canvas, svgEl);
      window.interactiveCodeMap = {
        panZoom,
        repairSubgraphTitles: function repairSubgraphTitles() {
          detectAndRepairSubgraphTitles(svgEl);
        },
        spec,
        svgEl,
      };
      reconnectHandoffPathsToNodes(svgEl, spec);
      detectAndRepairSubgraphTitles(svgEl);
      bindEdgeHover(svgEl);
      // Mermaid 的 htmlLabel 在首次改宽后会延迟到下一帧才完成换行高度计算。
      // 再做一次同一套幂等修复，让长分组页签按最终可见高度获得顶部净空。
      window.requestAnimationFrame(function settleWrappedGroupTitles() {
        detectAndRepairSubgraphTitles(svgEl);
      });
      mountReact(spec, panZoom);
    } catch (error) {
      console.error('[icm] 渲染失败:', error);
      showFailPage();
    }
  }

  main();
}());
