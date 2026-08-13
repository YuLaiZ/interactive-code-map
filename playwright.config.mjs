import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// CI 通常使用 Playwright 已安装的 Chromium。开发机在浏览器下载暂时不可用时，
// 允许显式覆盖；macOS 有官方 Chrome 时也可作为本地回归的受控后备。
const explicitExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = explicitExecutable
  || (!process.env.CI && process.platform === 'darwin' && existsSync(macChrome) ? macChrome : undefined);

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  // 用例通过已校验 SRI 的本地 UMD 镜像加载同一个单文件产物；串行执行可使
  // 临时防遮挡 fixture 的生成/清理与几何断言保持可重复。
  workers: 1,
  expect: { timeout: 15_000 },
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: executablePath ? { executablePath } : undefined,
  },
});
