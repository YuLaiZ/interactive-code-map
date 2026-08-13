#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const files = process.argv.slice(2);

if (files.length === 0) {
  console.error('用法: npm run ajv:strict -- <mapspec.json> [...mapspec.json]');
  process.exit(1);
}

const executable = process.platform === 'win32' ? 'ajv.cmd' : 'ajv';
const ajv = path.join(repoRoot, 'node_modules', '.bin', executable);
const schema = path.join(repoRoot, 'skill', 'references', 'mapspec-v1.schema.json');

execFileSync(
  ajv,
  ['validate', '-s', schema, ...files.flatMap((file) => ['-d', file]), '--strict=true', '--strict-required=true', '--spec=draft2020'],
  { stdio: 'inherit' },
);
