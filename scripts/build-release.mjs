import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const versionTag = /<meta name="unilink-version" content="[^"]*">/g;
const cacheName = /const CACHE_NAME = '[^']+';/g;
const runtimeVersion = /const CURRENT_VERSION = '[^']+';/g;

// Content IDs remain stable on an unchanged redeploy. Normalize generated
// markers before hashing so repeated builds produce exactly the same release.
export function buildRelease(root) {
  const files = ['index.html', 'manifest.webmanifest', 'package.json', 'vercel.json'].filter(path => existsSync(resolve(root, path)));
  function collect(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
  collect(resolve(root, 'assets'));
  collect(resolve(root, 'api'));
  const indexPath = resolve(root, 'index.html'), workerPath = resolve(root, 'assets/js/sw.js');
  const updatesPath = resolve(root, 'assets/js/updates.js');
  const html = readFileSync(indexPath, 'utf8'), worker = readFileSync(workerPath, 'utf8'), updates = readFileSync(updatesPath, 'utf8');
  if ([...html.matchAll(versionTag)].length !== 1 || [...worker.matchAll(cacheName)].length !== 1
    || [...updates.matchAll(runtimeVersion)].length !== 1) throw new Error('Release markers are missing or ambiguous');
  const hash = createHash('sha256');
  for (const path of files.sort()) {
    let bytes = readFileSync(resolve(root, path));
    if (path === 'index.html') bytes = Buffer.from(html.replace(versionTag, '<meta name="unilink-version" content="RELEASE">'));
    if (path === 'assets/js/sw.js') bytes = Buffer.from(worker.replace(cacheName, "const CACHE_NAME = 'RELEASE';"));
    if (path === 'assets/js/updates.js') bytes = Buffer.from(updates.replace(runtimeVersion, "const CURRENT_VERSION = 'RELEASE';"));
    hash.update(path).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  }
  const version = hash.digest('hex');
  writeFileSync(indexPath, html.replace(versionTag, `<meta name="unilink-version" content="${version}">`));
  writeFileSync(workerPath, worker.replace(cacheName, `const CACHE_NAME = 'univer-shell-${version}';`));
  writeFileSync(updatesPath, updates.replace(runtimeVersion, `const CURRENT_VERSION = '${version}';`));
  writeFileSync(resolve(root, 'version.json'), JSON.stringify({ version }) + '\n');
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`UniLink release: ${buildRelease(resolve(fileURLToPath(new URL('../', import.meta.url))))}`);
}
