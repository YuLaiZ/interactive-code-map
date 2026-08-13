import { test, expect } from './runtime-dependencies.fixture.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ALL_DEPS } from '../../skill/renderer/deps.config.mjs';

const demoPath = path.resolve('examples/demo/expected-output.html');
const demoUrl = pathToFileURL(demoPath).href;
const reactSources = ALL_DEPS.find((dependency) => dependency.name === 'react').sources;

function tamperedResponse(route, code) {
  return route.fulfill({
    body: code,
    contentType: 'application/javascript',
    headers: { 'access-control-allow-origin': '*' },
  });
}

async function serviceUnavailableResponse(route) {
  // 直接构造本地 503：不使用 route.abort()，避免同 host 连接池副作用。
  // SRI 篡改路径由上一用例覆盖；本用例只验证 HTTP 非成功响应的回退。
  return route.fulfill({
    status: 503,
    body: 'temporarily unavailable',
    contentType: 'text/plain',
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

function expectedSingleReactFallbackSequence() {
  return [
    reactSources[0].url,
    reactSources[1].url,
    ALL_DEPS.find((dependency) => dependency.name === 'react-dom').sources[0].url,
    ALL_DEPS.find((dependency) => dependency.name === 'mermaid').sources[0].url,
  ];
}

function captureDependencyRequests(page) {
  const dependencyUrls = new Set(ALL_DEPS.flatMap((dependency) => dependency.sources.map((source) => source.url)));
  const requests = [];
  page.on('request', (request) => {
    if (dependencyUrls.has(request.url())) requests.push(request.url());
  });
  return requests;
}

test('单个 CDN 的 SRI 不匹配会回退到下一源', async ({ page }) => {
  const first = reactSources[0];
  const requests = captureDependencyRequests(page);
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.route(first.url, (route) => tamperedResponse(route, 'window.__badIntegritySource = true;'));
  await page.goto(demoUrl);
  await expect(page.locator('svg')).toBeVisible();
  await expect(page.locator('#fail-page')).toBeHidden();
  expect(warnings.some((text) => text.includes(first.url))).toBeTruthy();
  expect(await page.evaluate(() => window.__badIntegritySource === true)).toBeFalsy();
  expect(requests).toEqual(expectedSingleReactFallbackSequence());
});

test('单个 CDN HTTP 503 会精确回退到下一源', async ({ page }) => {
  // 测试夹具为所有其他 CDN URL 提供同版本、同 SRI 的本地 UMD 字节。
  // 因此只对 React 首源精确返回 503，不会扰动真实连接池或外网可用性。
  const first = reactSources[0];
  const requests = captureDependencyRequests(page);
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });

  await page.route(first.url, serviceUnavailableResponse);

  await page.goto(demoUrl);
  await expect(page.locator('svg')).toBeVisible();
  await expect(page.locator('#fail-page')).toBeHidden();
  expect(warnings.some((text) => text.includes(first.url))).toBeTruthy();
  expect(requests).toEqual(expectedSingleReactFallbackSequence());
});

test('所有依赖源都 SRI 失败时显示原生失败页', async ({ page }) => {
  for (const source of ALL_DEPS.flatMap((dependency) => dependency.sources)) {
    await page.route(source.url, (route) => tamperedResponse(route, 'window.__tamperedExecuted = true;'));
  }
  await page.goto(demoUrl);
  await expect(page.locator('#fail-page')).toBeVisible();
  await expect(page.locator('#graph-viewport')).toBeHidden();
  expect(await page.evaluate(() => window.__tamperedExecuted === true)).toBeFalsy();
});
