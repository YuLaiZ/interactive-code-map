import { test as base, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDN_PROFILES } from '../../skill/renderer/deps.config.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localAssets = {
  react: 'node_modules/react/umd/react.production.min.js',
  'react-dom': 'node_modules/react-dom/umd/react-dom.production.min.js',
  mermaid: 'node_modules/mermaid/dist/mermaid.min.js',
};
const corsHeaders = {
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
};

function sha384(body) {
  return `sha384-${createHash('sha384').update(body).digest('base64')}`;
}

const localRuntimeSources = new Map();
for (const [profileName, dependencies] of Object.entries(CDN_PROFILES)) {
  for (const dependency of dependencies) {
    const asset = localAssets[dependency.name];
    if (!asset) {
      throw new Error(`缺少 ${dependency.name} 的本地浏览器测试镜像`);
    }
    const body = readFileSync(path.resolve(projectRoot, asset));
    const integrity = sha384(body);
    for (const source of dependency.sources) {
      if (source.integrity !== integrity) {
        throw new Error(`${profileName} 的本地 ${dependency.name} 字节与 ${source.url} 的 SRI 不一致`);
      }
      localRuntimeSources.set(source.url, body);
    }
  }
}

// 生产产物仍加载声明的 CDN。测试时用同版本、同 SRI 的本地 UMD 字节响应，
// 让交互回归不依赖外网，同时保留浏览器对原始 integrity 属性的校验。
export const test = base.extend({
  page: async ({ page }, use) => {
    for (const [url, body] of localRuntimeSources) {
      await page.route(url, (route) => route.fulfill({
        status: 200,
        body,
        contentType: 'application/javascript',
        headers: corsHeaders,
      }));
    }
    await use(page);
  },
});

export { expect };
