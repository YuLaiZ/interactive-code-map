import {
  ALL_DEPS,
  CDN_SOURCE_TIMEOUT_MS,
  CDN_PROFILE_NAMES,
  CDN_PROFILES,
  DEFAULT_CDN_PROFILE,
  resolveDependencyProfile,
} from '../../skill/renderer/deps.config.mjs';

let pass = 0;
let fail = 0;

function assert(condition, message) {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${message}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${message}`);
  }
}

const expectedDepNames = ['react', 'react-dom', 'mermaid'];
const expectedOrders = {
  global: {
    react: ['cdn.jsdelivr.net', 'unpkg.com'],
    'react-dom': ['cdn.jsdelivr.net', 'unpkg.com'],
    mermaid: ['cdn.jsdelivr.net', 'unpkg.com'],
  },
  'china-friendly': {
    react: ['registry.npmmirror.com', 'cdn.staticfile.org', 'cdn.jsdelivr.net', 'unpkg.com', 'cdn.bootcdn.net'],
    'react-dom': ['registry.npmmirror.com', 'cdn.staticfile.org', 'cdn.jsdelivr.net', 'unpkg.com', 'cdn.bootcdn.net'],
    mermaid: ['registry.npmmirror.com', 'cdn.jsdelivr.net', 'unpkg.com'],
  },
};
const expectedVersions = { react: '18.3.1', 'react-dom': '18.3.1', mermaid: '11.16.1' };
const expectedSri = {
  react: 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z',
  'react-dom': 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1',
  mermaid: 'sha384-aBQXj4hK6Jm05i7aQAsUV3bLdSUrHX1BGYfMB0166TtWt/RRaw+h0Eelme9OCOvy',
};

console.log('== deps.config profile 校验 ==');
assert(DEFAULT_CDN_PROFILE === 'global', '默认 profile 为 global');
assert(CDN_PROFILE_NAMES.join(',') === 'global,china-friendly', 'profile 名称固定且有序');
assert(ALL_DEPS === CDN_PROFILES.global, 'ALL_DEPS 保持指向默认 global profile');
assert(Object.isFrozen(CDN_PROFILES)
  && Object.isFrozen(CDN_PROFILES.global)
  && Object.isFrozen(CDN_PROFILES.global[0])
  && Object.isFrozen(CDN_PROFILES.global[0].sources)
  && Object.isFrozen(CDN_PROFILES.global[0].sources[0]), 'profile 配置及内部对象均深冻结');
assert(resolveDependencyProfile() === CDN_PROFILES.global, '无参数解析默认 global profile');
assert(resolveDependencyProfile('china-friendly') === CDN_PROFILES['china-friendly'], '可解析 china-friendly profile');
let rejectedUnknownProfile = false;
try {
  resolveDependencyProfile('fastest');
} catch (error) {
  rejectedUnknownProfile = error.message.includes('未知 CDN profile');
}
assert(rejectedUnknownProfile, '未知 profile 明确拒绝');
const originalSourceUrl = CDN_PROFILES.global[0].sources[0].url;
let rejectedMutation = false;
try {
  CDN_PROFILES.global[0].sources[0].url = 'https://example.invalid/react.js';
} catch {
  rejectedMutation = true;
}
assert(rejectedMutation && CDN_PROFILES.global[0].sources[0].url === originalSourceUrl, '深冻结阻止运行时改写 CDN 来源');

for (const profileName of CDN_PROFILE_NAMES) {
  const dependencies = CDN_PROFILES[profileName];
  assert(dependencies.map((dep) => dep.name).join(',') === expectedDepNames.join(','), `${profileName}: 依赖顺序固定为 react→react-dom→mermaid`);
  for (const dep of dependencies) {
    const hosts = dep.sources.map((entry) => new URL(entry.url).host);
    assert(typeof dep.name === 'string' && dep.name.length > 0, `${profileName}/${dep.name}: name 非空`);
    assert(dep.version === expectedVersions[dep.name], `${profileName}/${dep.name}: 精确语义版本 ${dep.version}`);
    assert(hosts.join(',') === expectedOrders[profileName][dep.name].join(','), `${profileName}/${dep.name}: CDN 顺序符合 profile 合同`);
    for (const entry of dep.sources) {
      assert(entry.url.startsWith('https://'), `${profileName}/${dep.name} ${entry.url}: HTTPS`);
      assert(entry.integrity === expectedSri[dep.name], `${profileName}/${dep.name} ${entry.url}: SRI 与锁定本地 UMD 一致`);
      assert(entry.crossorigin === 'anonymous', `${profileName}/${dep.name}: crossorigin anonymous`);
      assert(typeof entry.license === 'string' && entry.license.length > 0, `${profileName}/${dep.name}: license 已声明`);
      assert(entry.timeoutMs === CDN_SOURCE_TIMEOUT_MS && entry.timeoutMs === 8_000, `${profileName}/${dep.name}: 单源超时固定为 8 秒`);
    }
  }
}

assert(CDN_PROFILES['china-friendly'].every((dep) => new URL(dep.sources[0].url).host === 'registry.npmmirror.com'), 'china-friendly 的全部依赖均以 npmmirror 为首源');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
