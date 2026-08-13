import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMapSpec } from '../../skill/renderer/validate-map-spec.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const schema = path.join(repoRoot, 'skill', 'references', 'mapspec-v1.schema.json');
const fixtureRoots = [path.join(repoRoot, 'tests')];
const executable = process.platform === 'win32' ? 'ajv.cmd' : 'ajv';
const ajv = path.join(repoRoot, 'node_modules', '.bin', executable);

let pass = 0;
let fail = 0;

function assert(condition, message) {
  if (condition) {
    pass += 1;
    console.log('  ✓ ' + message);
  } else {
    fail += 1;
    console.error('  ✗ ' + message);
  }
}

function ajvAccepts(filePath) {
  try {
    execFileSync(
      ajv,
      ['validate', '-s', schema, '-d', filePath, '--strict=true', '--strict-required=true', '--spec=draft2020'],
      { stdio: 'pipe' },
    );
    return true;
  } catch {
    return false;
  }
}

// 结构反例必须同时被 Schema 与共享校验器拒绝。语义反例则证明共享校验器
// 在 Schema 之外仍收紧了隐私、证据状态和跨字段不变量。
const structuralInvalid = new Set([
  'missing-meta-summary.json',
  'missing-detail-segments.json',
  'edges-not-array.json',
  'root-null.json',
  'unknown-root-field.json',
  'unknown-node-field.json',
  'line-non-integer.json',
  'line-start-zero.json',
  'edge-line-start-zero.json',
  'missing-evidence-path.json',
]);
const semanticInvalid = new Set([
  'sensitive-content-key.json',
  'sensitive-path-env.json',
  'unconfirmed-with-verified-evidence.json',
  'edge-line-end-before-start.json',
  'absolute-display-path.json',
]);

function validSpecWithCode(rows) {
  return {
    schemaVersion: 1,
    meta: { title: 't', question: 'q', scope: 's', languageProfile: 'js', summary: 's' },
    nodes: [{
      id: 'n1',
      title: 'n',
      claimState: 'inferred',
      evidence: [{ path: 'a.js', state: 'inferred' }],
      detail: {
        summary: 's',
        segments: [{ kind: 'code', title: 'code', headers: ['code'], rows }],
      },
    }],
  };
}

function writeTemporary(name, spec) {
  const file = path.join(here, '.tmp-schema-diff-' + name + '.json');
  writeFileSync(file, JSON.stringify(spec));
  return file;
}

console.log('== Schema 与共享校验器差分测试（校验器覆盖 Schema 并扩展语义）==');

const invalidDirectory = path.join(here, 'fixtures', 'invalid');
for (const name of readdirSync(invalidDirectory).filter((file) => file.endsWith('.json')).sort()) {
  const file = path.join(invalidDirectory, name);
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const ajvOk = ajvAccepts(file);
  const validatorOk = validateMapSpec(spec).length === 0;

  // 关键单向包含：Schema 拒绝时共享校验器不得放行。
  if (!ajvOk) {
    assert(!validatorOk, name + ': Schema 拒绝时共享校验器也拒绝');
  }
  if (structuralInvalid.has(name)) {
    assert(!ajvOk && !validatorOk, name + ': 结构约束由两者共同拒绝');
  } else if (semanticInvalid.has(name)) {
    assert(ajvOk && !validatorOk, name + ': Schema 通过而共享校验器按附加语义拒绝');
  } else {
    assert(false, name + ': 未分类，必须登记其结构或语义归属');
  }
}

for (const [name, spec, expected] of [
  ['code-rows', validSpecWithCode(Array.from({ length: 81 }, () => ['x'])), 'both-reject'],
  ['code-cell', validSpecWithCode([['x'.repeat(501)]]), 'both-reject'],
  ['code-total', validSpecWithCode(Array.from({ length: 25 }, () => ['x'.repeat(500)])), 'validator-only'],
]) {
  const file = writeTemporary(name, spec);
  try {
    const ajvOk = ajvAccepts(file);
    const validatorOk = validateMapSpec(spec).length === 0;
    if (expected === 'both-reject') {
      assert(!ajvOk && !validatorOk, name + ': Schema 与共享校验器都拒绝');
    } else {
      assert(ajvOk && !validatorOk, name + ': 总字符上限由共享校验器额外拒绝');
    }
  } finally {
    unlinkSync(file);
  }
}

{
  const browserFixture = path.join(repoRoot, 'tests', 'browser', 'fixtures', 'subgraph-title-occlusion.mapspec.json');
  const spec = JSON.parse(readFileSync(browserFixture, 'utf8'));
  const ajvOk = ajvAccepts(browserFixture);
  const validatorOk = validateMapSpec(spec, {
    allowTestFixture: true,
    fixtureFilePath: browserFixture,
    fixtureRoots,
  }).length === 0;
  assert(ajvOk && validatorOk, '浏览器 fixture：显式放行测试标记后两者都通过');
}

{
  const demoFixture = path.join(repoRoot, 'examples', 'demo', 'expected-mapspec.json');
  if (!existsSync(demoFixture)) {
    assert(false, 'demo fixture 缺失');
  } else {
    const spec = JSON.parse(readFileSync(demoFixture, 'utf8'));
    assert(
      ajvAccepts(demoFixture) && validateMapSpec(spec).length === 0,
      'demo fixture：Schema 与共享校验器都通过',
    );
  }
}

console.log('\n结果: ' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
