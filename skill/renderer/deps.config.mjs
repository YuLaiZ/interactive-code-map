/**
 * 浏览器运行时依赖 profile：精确版本、固定来源顺序及每个响应字节的 SRI。
 *
 * `global` 是默认的全球 profile。`china-friendly` 为全部依赖增加经验证的
 * npmmirror 首源；React / ReactDOM 还保留 staticfile 与 bootcdn 后备来源。
 *
 * HTTP 200、CORS 与 SRI 采集日期：2026-08-14。新增来源必须同步扩展
 * tests/build/deps-config.test.mjs 的白名单、顺序和 SRI 断言。
 */
const REACT_SRI = 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z';
const REACT_DOM_SRI = 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1';
const MERMAID_SRI = 'sha384-aBQXj4hK6Jm05i7aQAsUV3bLdSUrHX1BGYfMB0166TtWt/RRaw+h0Eelme9OCOvy';
export const CDN_SOURCE_TIMEOUT_MS = 8_000;

function source(url, integrity) {
  return {
    url,
    integrity,
    crossorigin: 'anonymous',
    license: 'MIT',
    timeoutMs: CDN_SOURCE_TIMEOUT_MS,
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const GLOBAL_DEPS = [
  {
    name: 'react',
    version: '18.3.1',
    sources: [
      source('https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js', REACT_SRI),
      source('https://unpkg.com/react@18.3.1/umd/react.production.min.js', REACT_SRI),
    ],
  },
  {
    name: 'react-dom',
    version: '18.3.1',
    sources: [
      source('https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js', REACT_DOM_SRI),
      source('https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js', REACT_DOM_SRI),
    ],
  },
  {
    name: 'mermaid',
    version: '11.16.1',
    sources: [
      source('https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.min.js', MERMAID_SRI),
      source('https://unpkg.com/mermaid@11.16.1/dist/mermaid.min.js', MERMAID_SRI),
    ],
  },
];

const CHINA_FRIENDLY_DEPS = [
  {
    name: 'react',
    version: '18.3.1',
    sources: [
      source('https://registry.npmmirror.com/react/18.3.1/files/umd/react.production.min.js', REACT_SRI),
      source('https://cdn.staticfile.org/react/18.3.1/umd/react.production.min.js', REACT_SRI),
      ...GLOBAL_DEPS[0].sources,
      source('https://cdn.bootcdn.net/ajax/libs/react/18.3.1/umd/react.production.min.js', REACT_SRI),
    ],
  },
  {
    name: 'react-dom',
    version: '18.3.1',
    sources: [
      source('https://registry.npmmirror.com/react-dom/18.3.1/files/umd/react-dom.production.min.js', REACT_DOM_SRI),
      source('https://cdn.staticfile.org/react-dom/18.3.1/umd/react-dom.production.min.js', REACT_DOM_SRI),
      ...GLOBAL_DEPS[1].sources,
      source('https://cdn.bootcdn.net/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js', REACT_DOM_SRI),
    ],
  },
  {
    name: 'mermaid',
    version: '11.16.1',
    sources: [
      source('https://registry.npmmirror.com/mermaid/11.16.1/files/dist/mermaid.min.js', MERMAID_SRI),
      ...GLOBAL_DEPS[2].sources,
    ],
  },
];

export const DEFAULT_CDN_PROFILE = 'global';

export const CDN_PROFILES = deepFreeze({
  global: GLOBAL_DEPS,
  'china-friendly': CHINA_FRIENDLY_DEPS,
});

export const CDN_PROFILE_NAMES = Object.freeze(Object.keys(CDN_PROFILES));

export function resolveDependencyProfile(name = DEFAULT_CDN_PROFILE) {
  if (typeof name !== 'string' || !Object.hasOwn(CDN_PROFILES, name)) {
    throw new Error(`未知 CDN profile: ${name}. 可用值: ${CDN_PROFILE_NAMES.join(', ')}`);
  }
  return CDN_PROFILES[name];
}

// 向后兼容默认 global profile 的现有测试与调用方。
export const ALL_DEPS = resolveDependencyProfile();
