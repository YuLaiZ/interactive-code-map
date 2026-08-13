import { ALL_DEPS } from '../../skill/renderer/deps.config.mjs';

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
const expectedSourceHosts = ['cdn.jsdelivr.net', 'unpkg.com'];

console.log('== deps.config 校验 ==');
assert(ALL_DEPS.map((dep) => dep.name).join(',') === expectedDepNames.join(','), '依赖顺序固定为 react→react-dom→mermaid');

for (const dep of ALL_DEPS) {
  assert(typeof dep.name === 'string' && dep.name.length > 0, `${dep.name}: name 非空`);
  assert(typeof dep.version === 'string' && /^\d+\.\d+\.\d+$/.test(dep.version), `${dep.name}: 精确语义版本 ${dep.version}`);
  assert(Array.isArray(dep.sources) && dep.sources.length === expectedSourceHosts.length, `${dep.name}: 源数固定为 ${expectedSourceHosts.length}`);
  assert(dep.sources.map((source) => new URL(source.url).host).join(',') === expectedSourceHosts.join(','), `${dep.name}: host 顺序固定为 jsDelivr→unpkg`);
  for (const source of dep.sources) {
    assert(source.url.startsWith('https://'), `${dep.name} ${source.url}: HTTPS`);
    assert(/^sha384-[A-Za-z0-9+/=]+$/.test(source.integrity), `${dep.name} ${source.url}: SRI sha384 格式`);
    assert(source.integrity !== 'sha384-<实测>', `${dep.name} ${source.url}: SRI 已计算`);
    assert(source.crossorigin === 'anonymous', `${dep.name}: crossorigin anonymous`);
    assert(typeof source.license === 'string' && source.license.length > 0, `${dep.name}: license 已声明`);
  }
}

assert(ALL_DEPS.find((dep) => dep.name === 'react')?.version === '18.3.1', 'react 精确 18.3.1');
assert(ALL_DEPS.find((dep) => dep.name === 'react-dom')?.version === '18.3.1', 'react-dom 精确 18.3.1');
assert(ALL_DEPS.find((dep) => dep.name === 'mermaid')?.version === '11.16.1', 'mermaid 精确 11.16.1');
assert(ALL_DEPS.every((dep) => dep.sources.every((source) => expectedSourceHosts.includes(new URL(source.url).host))), '所有源均在批准 host 白名单内');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
