import { test, expect } from './runtime-dependencies.fixture.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const demoUrl = pathToFileURL(path.resolve('examples/demo/expected-output.html')).href;

test('图谱加载为可见 SVG', async ({ page }) => {
  await page.goto(demoUrl);
  await expect(page.locator('svg')).toBeVisible();
  await expect(page.locator('#fail-page')).toBeHidden();
});

test('缩放控件右侧以用户语言说明可点击图中卡片查看详情', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(demoUrl);
  const hint = page.locator('.icm-interaction-hint');
  await expect(hint).toContainText('Click a card for details');
  await expect(hint.locator('.icm-interaction-hint-icon')).toHaveText('i');
  const positions = await page.locator('.icm-controls').evaluate((controls) => {
    const toolbar = controls.querySelector('.icm-toolbar')?.getBoundingClientRect();
    const hintRect = controls.querySelector('.icm-interaction-hint')?.getBoundingClientRect();
    const hint = controls.querySelector('.icm-interaction-hint');
    if (!toolbar || !hintRect || !hint) return null;
    const style = getComputedStyle(hint);
    return {
      hintAfterToolbar: hintRect.left > toolbar.right,
      centerOffset: Math.abs((hintRect.top + hintRect.height / 2) - (toolbar.top + toolbar.height / 2)),
      hasBorder: style.borderStyle !== 'none' && Number.parseFloat(style.borderWidth) >= 1,
      isPill: Number.parseFloat(style.borderRadius) >= hintRect.height / 2,
    };
  });
  expect(positions).not.toBeNull();
  expect(positions.hintAfterToolbar).toBeTruthy();
  expect(positions.centerOffset).toBeLessThanOrEqual(1);
  expect(positions.hasBorder).toBeTruthy();
  expect(positions.isPill).toBeTruthy();
});

test('点击节点会打开详情面板', async ({ page }) => {
  await page.goto(demoUrl);
  await page.locator('g.node[data-node-id="n1"]').click();
  await expect(page.locator('#detail-panel')).toBeVisible();
  await expect(page.locator('#detail-panel')).toContainText('Create order');
  await expect(page.locator('#detail-panel .claim-state')).toHaveText('verified');
});

test('选中的卡片保持与 hover 完全一致的反馈样式', async ({ page }) => {
  await page.goto(demoUrl);
  const node = page.locator('g.node[data-node-id="n1"]');
  const readVisual = () => node.evaluate((element) => {
    const rect = element.querySelector('rect');
    if (!rect) return null;
    const style = getComputedStyle(rect);
    return {
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      filter: style.filter,
    };
  });

  await node.hover();
  await expect.poll(async () => (await readVisual())?.strokeWidth).toBe('4px');
  const hoverVisual = await readVisual();
  expect(hoverVisual).not.toBeNull();

  await page.locator('.icm-toolbar').hover();
  await node.click();
  await page.locator('.icm-toolbar').hover();
  await expect(node).toHaveClass(/icm-node-selected/);
  await expect.poll(readVisual).toEqual(hoverVisual);

  await page.locator('#detail-panel button[aria-label="Close detail"]').click();
  await expect(node).not.toHaveClass(/icm-node-selected/);
});

test('复杂 Demo 的代表节点详情包含目标产物同量级的结构化信息', async ({ page }) => {
  await page.goto(demoUrl);
  await page.locator('g.node[data-node-id="n1"]').click();
  const result = await page.locator('#detail-panel').evaluate((panel) => {
    const scrollRegion = panel.querySelector('.icm-detail-scroll');
    return {
      segmentCount: panel.querySelectorAll('.icm-segment').length,
      tableCount: panel.querySelectorAll('table').length,
      codeCount: panel.querySelectorAll('.seg-code').length,
      schemaCount: panel.querySelectorAll('.seg-schema').length,
      evidenceCount: panel.querySelectorAll('.evidence').length,
      scrollHeight: scrollRegion?.scrollHeight || 0,
      clientHeight: scrollRegion?.clientHeight || 0,
    };
  });

  expect(result.segmentCount).toBeGreaterThanOrEqual(5);
  expect(result.tableCount).toBeGreaterThanOrEqual(5);
  expect(result.codeCount).toBeGreaterThanOrEqual(1);
  expect(result.schemaCount).toBeGreaterThanOrEqual(2);
  expect(result.evidenceCount).toBeGreaterThanOrEqual(4);
  expect(result.scrollHeight).toBeGreaterThan(result.clientHeight + 80);
});

test('详情内容滚动时，右上角关闭按钮保持固定', async ({ page }) => {
  await page.goto(demoUrl);
  await page.locator('g.node[data-node-id="n1"]').click();
  const result = await page.locator('#detail-panel').evaluate((panel) => {
    const scrollRegion = panel.querySelector('.icm-detail-scroll');
    const closeButton = panel.querySelector('.icm-close');
    if (!scrollRegion || !closeButton) return null;
    const before = closeButton.getBoundingClientRect();
    scrollRegion.scrollTop = scrollRegion.scrollHeight;
    const after = closeButton.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    return {
      contentOverflows: scrollRegion.scrollHeight > scrollRegion.clientHeight + 80,
      scrollTop: scrollRegion.scrollTop,
      xShift: Math.abs(before.left - after.left),
      yShift: Math.abs(before.top - after.top),
      closeWithinPanel: after.top >= panelBounds.top && after.right <= panelBounds.right,
    };
  });

  expect(result).not.toBeNull();
  expect(result.contentOverflows).toBeTruthy();
  expect(result.scrollTop).toBeGreaterThan(0);
  expect(result.xShift).toBeLessThanOrEqual(0.5);
  expect(result.yShift).toBeLessThanOrEqual(0.5);
  expect(result.closeWithinPanel).toBeTruthy();
});

test('详情滚动位置按节点分别保存，首次打开新节点从顶部开始', async ({ page }) => {
  await page.goto(demoUrl);
  const firstNode = page.locator('g.node[data-node-id="n1"]');
  const secondNode = page.locator('g.node[data-node-id="n2"]');

  await firstNode.click();
  await expect(page.locator('#detail-panel')).toContainText('Create order');
  const rememberedPosition = await page.locator('.icm-detail-scroll').evaluate((scrollRegion) => {
    const target = Math.min(scrollRegion.scrollHeight - scrollRegion.clientHeight, 180);
    if (target <= 0) throw new Error('Demo 的首节点详情不足以验证滚动记忆');
    scrollRegion.scrollTop = target;
    scrollRegion.dispatchEvent(new Event('scroll', { bubbles: true }));
    return scrollRegion.scrollTop;
  });
  expect(rememberedPosition).toBeGreaterThan(0);

  await secondNode.click();
  await expect(page.locator('#detail-panel')).toContainText('Resolve default collaborators');
  await expect.poll(async () => page.locator('.icm-detail-scroll').evaluate((scrollRegion) => scrollRegion.scrollTop))
    .toBeLessThanOrEqual(1);

  await firstNode.click();
  await expect(page.locator('#detail-panel')).toContainText('Create order');
  await expect.poll(async () => page.locator('.icm-detail-scroll').evaluate((scrollRegion) => scrollRegion.scrollTop))
    .toBeGreaterThanOrEqual(rememberedPosition - 1);
});

test('关闭按钮会关闭详情并恢复节点焦点', async ({ page }) => {
  await page.goto(demoUrl);
  const node = page.locator('g.node[data-node-id="n1"]');
  await node.click();
  await expect(page.locator('#detail-panel')).toBeVisible();
  await page.locator('#detail-panel button[aria-label="Close detail"]').click();
  await expect(page.locator('#detail-panel')).toHaveCount(0);
  await expect(node).toBeFocused();
});

test('节点 ID、证据状态和视觉状态精确对应', async ({ page }) => {
  await page.goto(demoUrl);
  await expect(page.locator('g.node[data-node-id="n1"]')).toHaveCount(1);
  await expect(page.locator('g.node[data-node-id="n10"]')).toHaveCount(1);

  const states = await page.locator('g.node[data-node-id]').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.querySelector('rect');
    const style = rect ? getComputedStyle(rect) : null;
    return {
      id: node.getAttribute('data-node-id'),
      state: node.getAttribute('data-claim-state'),
      className: node.getAttribute('class') || '',
      stroke: style?.stroke || '',
      dash: style?.strokeDasharray || '',
    };
  }));

  expect(states.find((node) => node.id === 'n1')?.state).toBe('verified');
  expect(states.find((node) => node.id === 'n10')?.state).toBe('verified');
  expect(new Set(states.map((node) => node.state)).size).toBe(3);
  expect(new Set(states.map((node) => node.stroke + '/' + node.dash)).size).toBeGreaterThanOrEqual(3);
  expect(states.every((node) => node.className.includes('icm-node-state-' + node.state))).toBeTruthy();
});

test('分组标题与连线条件在深色画布上保持可读', async ({ page }) => {
  await page.goto(demoUrl);
  const labelColors = await page.locator('.cluster-label span, span.edgeLabel').evaluateAll((labels) => labels.map((label) => ({
    text: label.textContent?.trim(),
    color: getComputedStyle(label).color,
  })).filter((label) => label.text));
  const labelBackgrounds = await page.locator('g.edgeLabel[data-icm-edge-role="internal"] .labelBkg')
    .evaluateAll((labels) => labels.map((label) => getComputedStyle(label).backgroundColor));
  const edgeTextBackgrounds = await page.locator('.edgeLabel, .edgeLabel p').evaluateAll((labels) => labels.map((label) => getComputedStyle(label).backgroundColor));
  const crossGroupLabels = await page.locator('g.edgeLabel.icm-cross-group-edge-label foreignObject > div')
    .evaluateAll((labels) => labels.map((label) => ({
      text: label.textContent?.trim(),
      opacity: getComputedStyle(label).opacity,
      background: getComputedStyle(label).backgroundColor,
    })));

  expect(labelColors.length).toBeGreaterThan(0);
  expect(labelColors.every((label) => label.color === 'rgb(238, 245, 255)')).toBeTruthy();
  expect(labelBackgrounds.length).toBeGreaterThan(0);
  expect(labelBackgrounds.every((background) => background === 'rgb(20, 43, 68)')).toBeTruthy();
  expect(edgeTextBackgrounds.every((background) => background === 'rgba(0, 0, 0, 0)')).toBeTruthy();
  expect(crossGroupLabels.length).toBeGreaterThan(0);
  expect(crossGroupLabels.every((label) => label.text && label.opacity === '1'
    && label.background !== 'rgba(0, 0, 0, 0)')).toBeTruthy();
});

test('悬停条件框或条件线都会突出同一条条件关系', async ({ page }) => {
  await page.goto(demoUrl);
  const condition = page.locator('g.edgeLabel[data-icm-label-kind="condition"]').first();
  const edgeId = await condition.getAttribute('data-icm-edge-id');
  expect(edgeId).toBeTruthy();
  const targets = page.locator('[data-icm-condition-edge-id="' + edgeId + '"]');
  await expect(targets).toHaveCount(3);

  const allAreHighlighted = () => targets.evaluateAll((elements) => elements.every((element) => {
    return element.classList.contains('icm-condition-edge-hovered');
  }));
  const noneAreHighlighted = () => targets.evaluateAll((elements) => elements.every((element) => {
    return !element.classList.contains('icm-condition-edge-hovered');
  }));

  await condition.hover();
  await expect.poll(allAreHighlighted).toBeTruthy();
  const outline = page.locator('rect.icm-edge-hover-outline-flow');
  await expect(outline).toHaveCount(1);
  const outlineMetrics = await outline.evaluate((element) => ({
    rx: Number(element.getAttribute('rx')),
    ry: Number(element.getAttribute('ry')),
    dash: getComputedStyle(element).strokeDasharray,
  }));
  expect(outlineMetrics.rx).toBeGreaterThan(0);
  expect(outlineMetrics.ry).toBe(outlineMetrics.rx);
  expect(outlineMetrics.dash).not.toBe('none');

  const hitTarget = page.locator('path.icm-condition-edge-hit-target[data-icm-condition-edge-id="' + edgeId + '"]');
  await expect(hitTarget).toHaveCount(1);
  const hitPoint = await hitTarget.evaluate((path) => {
    const point = path.getPointAtLength(path.getTotalLength() * 0.5);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error('条件线缺少屏幕变换矩阵');
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.move(hitPoint.x, hitPoint.y);
  await expect.poll(allAreHighlighted).toBeTruthy();

  await page.locator('svg').hover({ position: { x: 2, y: 2 }, force: true });
  await expect.poll(noneAreHighlighted).toBeTruthy();
});

test('悬停动作关系或分组内连线都会突出同一条业务关系', async ({ page }) => {
  await page.goto(demoUrl);
  const action = page.locator('g.edgeLabel.icm-action-edge-label').first();
  const edgeId = await action.getAttribute('data-icm-edge-id');
  expect(edgeId).toBeTruthy();
  const linked = page.locator('[data-icm-hover-edge-id="' + edgeId + '"]');
  await expect(linked).toHaveCount(3);

  await action.hover();
  await expect.poll(() => linked.evaluateAll((elements) => elements.every((element) => {
    return element.classList.contains('icm-edge-hovered');
  }))).toBeTruthy();
  await expect(page.locator('rect.icm-edge-hover-outline-flow')).toHaveCount(1);

  const internalPath = page.locator('path.icm-edge-hit-target[data-icm-hover-edge-id="L_n1_n2_0"]');
  await expect(internalPath).toHaveCount(1);
  const point = await internalPath.evaluate((path) => {
    const local = path.getPointAtLength(path.getTotalLength() * 0.5);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error('组内连线缺少屏幕变换矩阵');
    const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.move(point.x, point.y);
  const internalLinked = page.locator('[data-icm-hover-edge-id="L_n1_n2_0"]');
  await expect.poll(() => internalLinked.evaluateAll((elements) => elements.every((element) => {
    return element.classList.contains('icm-edge-hovered');
  }))).toBeTruthy();
  const internalOutline = page.locator('rect.icm-edge-hover-outline-flow');
  await expect(internalOutline).toHaveCount(1);
  const internalOutlineStyle = await internalOutline.evaluate((element) => ({
    rx: Number(element.getAttribute('rx')),
    dash: getComputedStyle(element).strokeDasharray,
    animation: getComputedStyle(element).animationName,
  }));
  expect(internalOutlineStyle.rx).toBeGreaterThan(0);
  expect(internalOutlineStyle.dash).not.toBe('none');
  expect(internalOutlineStyle.animation).toBe('icm-edge-flow');
});

test('Fit 会为右下图例预留完整的可读区域', async ({ page }) => {
  await page.goto(demoUrl);
  const overlapCount = () => page.evaluate(() => {
    const legend = document.querySelector('.icm-legend')?.getBoundingClientRect();
    if (!legend) return { legendFound: false, overlaps: -1 };
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const overlappingElements = [...document.querySelectorAll('g.node, g.edgeLabel')]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return Math.min(rect.right, legend.right) > Math.max(rect.left, legend.left)
          && Math.min(rect.bottom, legend.bottom) > Math.max(rect.top, legend.top);
      });
    return { legendFound: true, overlaps: overlappingElements.length, texts: overlappingElements.map((element) => element.textContent?.trim()) };
  });
  const initial = await overlapCount();
  expect(initial.legendFound).toBeTruthy();
  expect(initial.overlaps).toBe(0);

  await page.getByRole('button', { name: 'Fit to screen' }).click();
  const afterFit = await overlapCount();
  expect(afterFit.legendFound).toBeTruthy();
  expect(afterFit.overlaps).toBe(0);
});

test('组内连线说明使用独立的圆角边框，并在图例中说明', async ({ page }) => {
  await page.goto(demoUrl);
  const internalLabel = page.locator('g.edgeLabel[data-icm-edge-role="internal"] foreignObject > div').first();
  const style = await internalLabel.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      borderWidth: computed.borderTopWidth,
      borderRadius: computed.borderTopLeftRadius,
      background: computed.backgroundColor,
    };
  });
  expect(style.borderWidth).toBe('1px');
  expect(Number.parseFloat(style.borderRadius)).toBeGreaterThan(0);
  expect(style.background).toBe('rgb(20, 43, 68)');
  await expect(page.getByText('Internal relationship', { exact: true })).toBeVisible();
});

test('跨分组标签仅在真实碰撞时分离，并以短引线回指所属边', async ({ page }) => {
  await page.goto(demoUrl);
  const result = await page.evaluate(() => {
    const rect = (element) => element.getBoundingClientRect();
    const visibleBounds = (element) => {
      const visualParts = [...element.querySelectorAll('foreignObject > div, .labelBkg')]
        .map(rect)
        .filter((bounds) => bounds.width > 0 && bounds.height > 0);
      const parts = visualParts.length > 0 ? visualParts : [rect(element)];
      return {
        left: Math.min(...parts.map((bounds) => bounds.left)),
        top: Math.min(...parts.map((bounds) => bounds.top)),
        right: Math.max(...parts.map((bounds) => bounds.right)),
        bottom: Math.max(...parts.map((bounds) => bounds.bottom)),
      };
    };
    const edge = (id) => document.querySelector('g.edgeLabel[data-icm-edge-id="' + id + '"]');
    const handoff = edge('L_n2_n4_0');
    const avoided = edge('L_n8_n10_0');
    const otherAvoided = edge('L_n9_n10_0');
    const otherNormal = edge('L_n3_n4_0');
    const internal = edge('L_n1_n2_0');
    const badge = handoff?.querySelector('foreignObject > div');
    const badgeStyle = badge ? getComputedStyle(badge) : null;
    const handoffBounds = [...document.querySelectorAll('g.edgeLabel[data-icm-edge-role="handoff"]')]
      .map(visibleBounds);
    let handoffOverlaps = 0;
    for (let first = 0; first < handoffBounds.length; first += 1) {
      for (let second = first + 1; second < handoffBounds.length; second += 1) {
        const a = handoffBounds[first];
        const b = handoffBounds[second];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0) {
          handoffOverlaps += 1;
        }
      }
    }
    return {
      handoffRole: handoff?.getAttribute('data-icm-edge-role'),
      handoffKind: handoff?.getAttribute('data-icm-label-kind'),
      handoffOrientation: handoff?.getAttribute('data-icm-edge-orientation'),
      handoffDetached: handoff?.hasAttribute('data-icm-edge-label-detached'),
      handoffLeader: Boolean(document.querySelector('.icm-edge-label-leader[data-icm-edge-id="L_n2_n4_0"]')),
      avoidedDetached: avoided?.hasAttribute('data-icm-edge-label-detached'),
      avoidedTitleSeparated: avoided?.getAttribute('data-icm-title-separated'),
      avoidedLeader: Boolean(document.querySelector('.icm-edge-label-leader[data-icm-edge-id="L_n8_n10_0"]')),
      otherAvoidedDetached: otherAvoided?.hasAttribute('data-icm-edge-label-detached'),
      otherAvoidedLeader: Boolean(document.querySelector('.icm-edge-label-leader[data-icm-edge-id="L_n9_n10_0"]')),
      otherNormalDetached: otherNormal?.hasAttribute('data-icm-edge-label-detached'),
      otherNormalLeader: Boolean(document.querySelector('.icm-edge-label-leader[data-icm-edge-id="L_n3_n4_0"]')),
      internalRole: internal?.getAttribute('data-icm-edge-role'),
      badgeBackground: badgeStyle?.backgroundColor || '',
      badgeBorderWidth: badgeStyle?.borderTopWidth || '',
      badgeOpacity: badgeStyle?.opacity || '',
      badgeDisplay: badgeStyle?.display || '',
      marker: badge ? getComputedStyle(badge, '::before').content : '',
      avoidedMarker: avoided
        ? getComputedStyle(avoided.querySelector('foreignObject > div'), '::before').content
        : '',
      handoffOverlaps,
      handoffPathsHaveArrow: [...document.querySelectorAll('g.edgeLabel[data-icm-edge-role="handoff"]')].every((label) => {
        const id = label.getAttribute('data-icm-edge-id');
        const path = [...document.querySelectorAll('path[data-id], g.edgePath[data-id] path')]
          .find((candidate) => candidate.getAttribute('data-id') === id || candidate.closest('[data-id]')?.getAttribute('data-id') === id);
        return Boolean(path?.getAttribute('marker-end'));
      }),
      detachedIds: [...document.querySelectorAll('g.edgeLabel[data-icm-edge-label-detached="true"]')]
        .map((label) => label.getAttribute('data-icm-edge-id')),
      leaderIds: [...document.querySelectorAll('.icm-edge-label-leader')]
        .map((leader) => leader.getAttribute('data-icm-edge-id')),
    };
  });

  expect(result.handoffRole).toBe('handoff');
  expect(result.handoffKind).toBe('action');
  expect(result.handoffOrientation).toBe('horizontal');
  expect(result.internalRole).toBe('internal');
  expect(result.badgeBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(result.badgeBorderWidth).toBe('1px');
  expect(result.badgeOpacity).toBe('1');
  expect(result.badgeDisplay).toBe('inline-flex');
  expect(result.marker).toContain('→');
  expect(result.avoidedMarker).toContain('◇');
  expect(result.handoffPathsHaveArrow).toBeTruthy();
  // 默认仍保留 Mermaid 位置；只有真实碰撞的标签才被分离，每条引线都必须对应
  // 一个已移动标签，避免无意义的装饰线。
  expect(result.leaderIds.every((id) => result.detachedIds.includes(id))).toBeTruthy();
});

test('跨分组关系显式从源节点连到目标节点，分组不再充当视觉端点', async ({ page }) => {
  await page.goto(demoUrl);
  const result = await page.evaluate(() => {
    const svg = document.querySelector('#graph-canvas svg');
    if (!svg) throw new Error('Demo 缺少 SVG');
    const toScreen = (element, point) => {
      const svgPoint = svg.createSVGPoint();
      svgPoint.x = point.x;
      svgPoint.y = point.y;
      const result = svgPoint.matrixTransform(element.getScreenCTM());
      return { x: result.x, y: result.y };
    };
    const pointToRectDistance = (point, rect) => Math.hypot(
      Math.max(rect.left - point.x, 0, point.x - rect.right),
      Math.max(rect.top - point.y, 0, point.y - rect.bottom),
    );
    const edgeId = 'L_n7_n10_0';
    const source = document.querySelector('g.node[data-node-id="n7"]');
    const target = document.querySelector('g.node[data-node-id="n10"]');
    const continuousPath = document.querySelector('path[data-id="' + edgeId + '"]');
    const edgeLabel = document.querySelector('g.edgeLabel[data-icm-edge-id="' + edgeId + '"]');
    if (!source || !target || !continuousPath || !edgeLabel) {
      throw new Error('Demo 缺少跨分组节点锚点场景');
    }
    const length = continuousPath.getTotalLength();
    const startPoint = toScreen(continuousPath, continuousPath.getPointAtLength(0));
    const endPoint = toScreen(continuousPath, continuousPath.getPointAtLength(length));
    const sourceBounds = source.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    return {
      sourceStartsAtNode: pointToRectDistance(startPoint, sourceBounds),
      targetEndsAtNode: pointToRectDistance(endPoint, targetBounds),
      targetHasArrow: Boolean(continuousPath.getAttribute('marker-end')),
      oneContinuousPath: document.querySelectorAll('path[data-id="' + edgeId + '"]').length,
      hasLegacyConnector: Boolean(document.querySelector('.icm-handoff-node-connector[data-icm-edge-id="' + edgeId + '"]')),
      routeKind: continuousPath.getAttribute('data-icm-route-kind'),
      edgeNodeAnchored: edgeLabel.getAttribute('data-icm-node-anchored'),
    };
  });

  expect(result.sourceStartsAtNode).toBeLessThanOrEqual(2);
  expect(result.targetEndsAtNode).toBeLessThanOrEqual(2);
  expect(result.targetHasArrow).toBeTruthy();
  expect(result.oneContinuousPath).toBe(1);
  expect(result.hasLegacyConnector).toBeFalsy();
  expect(result.routeKind).toBe('native-corridor-node-extensions');
  expect(result.edgeNodeAnchored).toBe('true');
});

test('同一节点的跨组多入多出关系使用不同端口，避免星形汇入', async ({ page }) => {
  await page.goto(demoUrl);
  const result = await page.evaluate(() => {
    const svg = document.querySelector('#graph-canvas svg');
    if (!svg) throw new Error('Demo 缺少 SVG');
    const screenEnd = (path, atEnd) => {
      const point = path.getPointAtLength(atEnd ? path.getTotalLength() : 0);
      const svgPoint = svg.createSVGPoint();
      svgPoint.x = point.x;
      svgPoint.y = point.y;
      const screen = svgPoint.matrixTransform(path.getScreenCTM());
      return { x: screen.x, y: screen.y };
    };
    const sourcePaths = ['L_n5_n7_0', 'L_n5_n6_0'].map((id) => document.querySelector('path[data-id="' + id + '"]'));
    const targetPaths = ['L_n8_n10_0', 'L_n9_n10_0'].map((id) => document.querySelector('path[data-id="' + id + '"]'));
    if (sourcePaths.some((path) => !path) || targetPaths.some((path) => !path)) {
      throw new Error('Demo 缺少多入多出跨组边场景');
    }
    const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
    const sourcePoints = sourcePaths.map((path) => screenEnd(path, false));
    const targetPoints = targetPaths.map((path) => screenEnd(path, true));
    return {
      sourceSeparation: distance(sourcePoints[0], sourcePoints[1]),
      targetSeparation: distance(targetPoints[0], targetPoints[1]),
      routeKinds: sourcePaths.concat(targetPaths).map((path) => path.getAttribute('data-icm-route-kind')),
    };
  });

  expect(result.sourceSeparation).toBeGreaterThan(2);
  expect(result.targetSeparation).toBeGreaterThan(2);
  // renderer 只将 Mermaid 通道两端接回节点边缘，不重写中段或另行分配端口。
  expect(result.routeKinds).toEqual([
    'native-corridor-node-extensions',
    'native-corridor-node-extensions',
    'native-corridor-node-extensions',
    'native-corridor-node-extensions',
  ]);
});

test('默认英文图例说明分组、关系、证据状态和操作方式', async ({ page }) => {
  await page.goto(demoUrl);
  const result = await page.evaluate(() => {
    const legend = document.querySelector('.icm-legend');
    const legendText = legend?.textContent || '';
    const condition = document.querySelector('g.edgeLabel[data-icm-label-kind="condition"] foreignObject > div');
    const action = document.querySelector('g.edgeLabel.icm-action-edge-label foreignObject > div');
    return {
      legendText,
      conditionPrefix: condition ? getComputedStyle(condition, '::before').content : '',
      actionPrefix: action ? getComputedStyle(action, '::before').content : '',
      legendDirection: legend ? getComputedStyle(legend).flexDirection : '',
      legendWrap: legend ? getComputedStyle(legend).flexWrap : '',
      sectionRows: legend ? [...legend.querySelectorAll('.icm-legend-section')]
        .map((section) => Math.round(section.getBoundingClientRect().top)) : [],
    };
  });

  expect(result.legendText).toContain('Reading guide');
  expect(result.legendText).toContain('Group');
  expect(result.legendText).toContain('Condition');
  expect(result.legendText).toContain('Action relationship');
  expect(result.legendText).toContain('Evidence status');
  expect(result.legendText).toContain('Controls');
  expect(result.legendText).toContain('Click a card for details');
  expect(result.legendText).toContain('Tab');
  expect(result.legendText).toContain('Enter');
  expect(result.legendText).toContain('Esc');
  expect(result.conditionPrefix).toContain('◇');
  expect(result.actionPrefix).toContain('→');
  expect(result.legendWrap).toBe('nowrap');
  expect(result.legendDirection).toBe('column');
  expect(new Set(result.sectionRows).size).toBe(3);
});

test('条件框与所属边保持同一 Mermaid 标识，额外引线只服务于已避让标签', async ({ page }) => {
  await page.goto(demoUrl);
  const result = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('g.edgeLabel[data-icm-edge-id]')];
    return {
      count: labels.length,
      everyLabelHasOwnPath: labels.every((label) => {
        const id = label.getAttribute('data-icm-edge-id');
        return Boolean(document.querySelector('path[data-id="' + id + '"]'));
      }),
      detachedCount: labels.filter((label) => label.hasAttribute('data-icm-edge-label-detached')).length,
      leaderCount: document.querySelectorAll('.icm-edge-label-leader, .icm-edge-label-anchor-dot').length,
    };
  });

  expect(result.count).toBeGreaterThan(0);
  expect(result.everyLabelHasOwnPath).toBeTruthy();
  expect(result.leaderCount).toBeGreaterThanOrEqual(result.detachedCount);
});

test('图内 foreignObject 的尺寸覆盖真实文字', async ({ page }) => {
  await page.goto(demoUrl);
  const textMetrics = await page.locator('foreignObject').evaluateAll((foreignObjects) => foreignObjects.map((foreignObject) => {
    const htmlLabel = foreignObject.querySelector(':scope > div') || foreignObject.querySelector('div');
    const edgeLabel = foreignObject.closest('g.edgeLabel');
    const text = htmlLabel?.querySelector('p');
    const labelBounds = htmlLabel?.getBoundingClientRect();
    const textBounds = text?.getBoundingClientRect();
    return {
      text: htmlLabel?.textContent?.trim() || '',
      width: Number.parseFloat(foreignObject.getAttribute('width') || '0'),
      height: Number.parseFloat(foreignObject.getAttribute('height') || '0'),
      scrollWidth: htmlLabel?.scrollWidth || 0,
      scrollHeight: htmlLabel?.scrollHeight || 0,
      decoratedRelationship: Boolean(edgeLabel?.classList.contains('icm-action-edge-label')
        || edgeLabel?.classList.contains('icm-condition-edge-label')),
      textInsideConditionBox: !(edgeLabel?.classList.contains('icm-action-edge-label')
        || edgeLabel?.classList.contains('icm-condition-edge-label'))
        || Boolean(labelBounds && textBounds
          && textBounds.left >= labelBounds.left - 0.5
          && textBounds.right <= labelBounds.right + 0.5
          && textBounds.top >= labelBounds.top - 0.5
          && textBounds.bottom <= labelBounds.bottom + 0.5),
    };
  }).filter((metric) => metric.text));

  expect(textMetrics.length).toBeGreaterThan(0);
  expect(textMetrics.every((metric) => metric.width >= metric.scrollWidth)).toBeTruthy();
  expect(textMetrics.every((metric) => metric.height >= metric.scrollHeight)).toBeTruthy();
  const decoratedRelationshipMetrics = textMetrics.filter((metric) => metric.decoratedRelationship);
  expect(decoratedRelationshipMetrics.length).toBeGreaterThan(0);
  expect(decoratedRelationshipMetrics.every((metric) => metric.textInsideConditionBox)).toBeTruthy();
});

test('纯 TD 复杂 Demo 中，分组页签居中且与节点、关系条件语义分明', async ({ page }) => {
  await page.goto(demoUrl);
  const result = await page.evaluate(() => {
    const rect = (element) => element.getBoundingClientRect();
    const visibleBounds = (element) => {
      const parts = [element, ...element.querySelectorAll('foreignObject > div, .labelBkg')]
        .map(rect)
        .filter((bounds) => bounds.width > 0 && bounds.height > 0);
      return {
        left: Math.min(...parts.map((bounds) => bounds.left)),
        top: Math.min(...parts.map((bounds) => bounds.top)),
        right: Math.max(...parts.map((bounds) => bounds.right)),
        bottom: Math.max(...parts.map((bounds) => bounds.bottom)),
      };
    };
    const groups = new Map();
    for (const node of document.querySelectorAll('g.node[data-subgraph]')) {
      const name = node.getAttribute('data-subgraph');
      const fill = getComputedStyle(node.querySelector('rect')).fill;
      if (!groups.has(name)) groups.set(name, new Set());
      groups.get(name).add(fill);
    }
    const titleMetrics = [...document.querySelectorAll('.cluster-label[data-subgraph]')].map((label) => {
      const name = label.getAttribute('data-subgraph');
      const cluster = [...document.querySelectorAll('g.cluster[data-subgraph]')]
        .find((candidate) => candidate.getAttribute('data-subgraph') === name);
      const groupNodes = [...document.querySelectorAll('g.node[data-subgraph]')]
        .filter((node) => node.getAttribute('data-subgraph') === name);
      const firstNode = groupNodes.sort((first, second) => rect(first).top - rect(second).top)[0];
      const labelRect = visibleBounds(label);
      const clusterRect = rect(cluster.querySelector(':scope > rect'));
      const firstNodeRect = rect(firstNode);
      const titleContent = label.querySelector('foreignObject > div');
      const titleStyle = titleContent ? getComputedStyle(titleContent) : null;
      return {
        name,
        placement: label.getAttribute('data-icm-title-placement'),
        kind: label.getAttribute('data-icm-label-kind'),
        gapToFirstNode: firstNodeRect.top - labelRect.bottom,
        centerDelta: Math.abs(labelRect.left + (labelRect.right - labelRect.left) / 2 - (clusterRect.left + clusterRect.width / 2)),
        barCoverage: (labelRect.right - labelRect.left) / clusterRect.width,
        withinCluster: labelRect.left >= clusterRect.left
          && labelRect.right <= clusterRect.right
          && labelRect.top >= clusterRect.top
          && labelRect.bottom <= clusterRect.bottom,
        tabBorderLeftWidth: titleStyle?.borderLeftWidth || '',
        tabBorderBottomWidth: titleStyle?.borderBottomWidth || '',
        tabFontWeight: titleStyle?.fontWeight || '',
        tabFontSize: titleStyle?.fontSize || '',
        tabRadius: titleStyle?.borderRadius || '',
        tabBackground: titleStyle?.backgroundImage || '',
        tabIcon: titleContent ? getComputedStyle(titleContent, '::before').content : '',
      };
    });
    const titleConditionOverlaps = [...document.querySelectorAll('.cluster-label[data-subgraph], .cluster-label[data-icm-layout-band]')].filter((title) => {
      const titleRect = visibleBounds(title);
      return [...document.querySelectorAll('g.edgeLabel')].some((condition) => {
        const conditionRect = visibleBounds(condition);
        return Math.min(titleRect.right, conditionRect.right) - Math.max(titleRect.left, conditionRect.left) > 0
          && Math.min(titleRect.bottom, conditionRect.bottom) - Math.max(titleRect.top, conditionRect.top) > 0;
      });
    }).length;
    const relationshipContent = document.querySelector('g.edgeLabel[data-icm-edge-role="handoff"] foreignObject > div');
    const n8 = rect(document.querySelector('g.node[data-node-id="n8"]'));
    const n9 = rect(document.querySelector('g.node[data-node-id="n9"]'));
    const groupRect = (name) => {
      const group = [...document.querySelectorAll('g.cluster[data-subgraph]')]
        .find((candidate) => candidate.getAttribute('data-subgraph') === name);
      return group ? rect(group.querySelector(':scope > rect')) : null;
    };
    return {
      nodeCount: document.querySelectorAll('g.node[data-node-id]').length,
      stageLayout: document.querySelector('svg')?.getAttribute('data-icm-stage-layout'),
      layoutAspectRatio: (() => {
        const bounds = document.querySelector('svg')?.getBBox();
        return bounds && bounds.height > 0 ? bounds.width / bounds.height : 0;
      })(),
      fillsByGroup: [...groups.values()].map((fills) => [...fills]),
      titleMetrics,
      titleConditionOverlaps,
      layoutRows: document.querySelectorAll('g.cluster[data-icm-layout-row]').length,
      layoutBandLabels: [...document.querySelectorAll('.cluster-label[data-icm-layout-band]')]
        .map((label) => label.getAttribute('data-icm-label-kind')),
      hasStageNumbers: Boolean(document.querySelector('[data-icm-stage]')),
      relationshipRadius: relationshipContent ? getComputedStyle(relationshipContent).borderRadius : '',
      relationshipFontSize: relationshipContent ? getComputedStyle(relationshipContent).fontSize : '',
      validationBranch: { xDistance: Math.abs(n8.x - n9.x), yDistance: Math.abs(n8.y - n9.y) },
    };
  });

  expect(result.nodeCount).toBeGreaterThanOrEqual(14);
  expect(result.stageLayout).toBe('td');
  expect(result.layoutAspectRatio).toBeGreaterThan(1);
  expect(result.fillsByGroup.length).toBeGreaterThanOrEqual(6);
  expect(result.fillsByGroup.every((fills) => fills.length === 1)).toBeTruthy();
  // 色板有六种可辨识主色；复杂 Demo 超过六个分组时允许循环复用，仍要求至少
  // 覆盖完整色板，避免把十个业务阶段错误渲染为同一种颜色。
  expect(new Set(result.fillsByGroup.map((fills) => fills[0])).size).toBe(Math.min(6, result.fillsByGroup.length));
  expect(result.titleMetrics.every((metric) => metric.gapToFirstNode >= 4)).toBeTruthy();
  expect(result.titleMetrics.every((metric) => metric.placement === 'top-tab')).toBeTruthy();
  expect(result.titleMetrics.every((metric) => metric.kind === 'group-title')).toBeTruthy();
  expect(result.titleMetrics.every((metric) => metric.withinCluster)).toBeTruthy();
  expect(result.titleMetrics.every((metric) => metric.centerDelta <= 1)).toBeTruthy();
  expect(result.titleMetrics.every((metric) => metric.barCoverage > 0 && metric.barCoverage <= 0.94)).toBeTruthy();
  expect(result.titleMetrics.some((metric) => metric.barCoverage < 0.72)).toBeTruthy();
  expect(result.titleMetrics.every((metric) => metric.tabBorderLeftWidth === '3px')).toBeTruthy();
  expect(result.titleMetrics.every((metric) => metric.tabBorderBottomWidth === '1px')).toBeTruthy();
  expect(result.titleMetrics.every((metric) => Number(metric.tabFontWeight) >= 700)).toBeTruthy();
  expect(result.titleMetrics.every((metric) => Number.parseFloat(metric.tabFontSize) < Number.parseFloat(result.relationshipFontSize))).toBeTruthy();
  expect(result.titleMetrics.every((metric) => metric.tabRadius !== result.relationshipRadius)).toBeTruthy();
  expect(result.titleMetrics.every((metric) => !metric.tabBackground.includes('linear-gradient'))).toBeTruthy();
  expect(result.titleMetrics.every((metric) => metric.tabIcon.includes('▦'))).toBeTruthy();
  expect(result.layoutRows).toBe(0);
  expect(result.layoutBandLabels).toEqual([]);
  expect(result.hasStageNumbers).toBeFalsy();
  expect(result.validationBranch.xDistance).toBeGreaterThan(24);
  expect(result.validationBranch.yDistance).toBeLessThanOrEqual(12);
  expect(result.titleConditionOverlaps).toBe(0);
});
