#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tests = ['mermaid.test.mjs', 'deps-config.test.mjs', 'build-html.test.mjs'];
let failed = false;

for (const testFile of tests) {
  console.log(`\n>>> ${testFile}`);
  try {
    execFileSync('node', [path.join(here, testFile)], { stdio: 'inherit' });
  } catch {
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
