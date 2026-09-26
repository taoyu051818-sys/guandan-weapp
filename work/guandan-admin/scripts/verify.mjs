import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of await readdir(resolve(root, 'src'))) {
  if (!file.endsWith('.js')) continue;
  const path = resolve(root, 'src', file);
  const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  const source = await readFile(path, 'utf8');
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|localStorage|sessionStorage|document\.cookie/);
  for (const match of source.matchAll(/from ['"](\.[^'"]+)['"]/g)) await readFile(resolve(dirname(path), match[1]));
}
const html = await readFile(resolve(root, 'index.html'), 'utf8');
assert.match(html, /lang="zh-CN"/);
assert.match(html, /width=device-width/);
assert.doesNotMatch(html, /https?:\/\/|\son\w+=|\sstyle=/);
assert.match(await readFile(resolve(root, 'styles.css'), 'utf8'), /prefers-reduced-motion/);
console.log('Admin source checks passed: syntax, imports, text-only rendering, no credential persistence, CSP-compatible markup.');
