/**
 * 浏览器运行时依赖：精确版本、固定两源顺序及每个响应字节的 SRI。
 *
 * HTTP 200 与 SRI 采集日期：2026-08-10。新增来源必须同步扩展
 * tests/build/deps-config.test.mjs 的白名单和顺序断言。
 */
export const ALL_DEPS = [
  {
    name: 'react',
    version: '18.3.1',
    sources: [
      {
        url: 'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
        integrity: 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z',
        crossorigin: 'anonymous',
        license: 'MIT',
      },
      {
        url: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
        integrity: 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z',
        crossorigin: 'anonymous',
        license: 'MIT',
      },
    ],
  },
  {
    name: 'react-dom',
    version: '18.3.1',
    sources: [
      {
        url: 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
        integrity: 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1',
        crossorigin: 'anonymous',
        license: 'MIT',
      },
      {
        url: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
        integrity: 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1',
        crossorigin: 'anonymous',
        license: 'MIT',
      },
    ],
  },
  {
    name: 'mermaid',
    version: '11.16.1',
    sources: [
      {
        url: 'https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.min.js',
        integrity: 'sha384-aBQXj4hK6Jm05i7aQAsUV3bLdSUrHX1BGYfMB0166TtWt/RRaw+h0Eelme9OCOvy',
        crossorigin: 'anonymous',
        license: 'MIT',
      },
      {
        url: 'https://unpkg.com/mermaid@11.16.1/dist/mermaid.min.js',
        integrity: 'sha384-aBQXj4hK6Jm05i7aQAsUV3bLdSUrHX1BGYfMB0166TtWt/RRaw+h0Eelme9OCOvy',
        crossorigin: 'anonymous',
        license: 'MIT',
      },
    ],
  },
];
