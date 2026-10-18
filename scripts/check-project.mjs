import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
for (const folder of ['assets', 'api', 'scripts', 'tests', 'docs']) {
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(path);
    }
  }
  visit(resolve(root, folder));
}
let checked = 0;
for (const path of files.filter(path => ['.js', '.mjs'].includes(extname(path)))) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `Invalid JavaScript: ${path}`);
  checked++;
}
function verify(reference, source) {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) return;
  const plain = reference.split(/[?#]/)[0];
  const path = plain.startsWith('/') ? resolve(root, plain.slice(1)) : resolve(dirname(source), plain);
  if (!existsSync(path)) throw new Error(`Missing resource in ${source}: ${reference}`);
}
const htmlPath = resolve(root, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) verify(match[1], htmlPath);
for (const path of files.filter(path => extname(path) === '.css')) {
  for (const match of readFileSync(path, 'utf8').matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) {
    verify((match[1] ?? match[2] ?? match[3]).trim(), path);
  }
}
for (const path of [resolve(root, 'README.md'), ...files.filter(path => extname(path) === '.md')]) {
  for (const match of readFileSync(path, 'utf8').matchAll(/\]\(([^\s)]+)\)/g)) verify(match[1], path);
}
const workerPath = resolve(root, 'assets/js/sw.js');
for (const match of readFileSync(workerPath, 'utf8').matchAll(/['"](\/assets\/[^'"]+)['"]/g)) verify(match[1], workerPath);
const manifestPath = resolve(root, 'manifest.webmanifest');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
for (const icon of manifest.icons || []) verify(icon.src, manifestPath);
if (!manifest.icons?.length) throw new Error('Manifest must contain application icons');
const packageJSON = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
if (JSON.stringify(packageJSON.engines) !== JSON.stringify(lock.packages[''].engines)) {
  throw new Error('Node.js requirements differ between package.json and package-lock.json');
}
console.log(`Checked ${checked} JavaScript files, HTML/CSS resources, documentation links, manifest icons, runtime metadata and service worker paths.`);
