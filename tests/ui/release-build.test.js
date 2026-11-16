import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { resolve, join, sep, basename } from 'node:path';
import { buildRelease } from '../../scripts/build-release.mjs';
import { createHash } from 'node:crypto';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'unilink-release-'));
  t.after(() => {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !basename(root).startsWith('unilink-release-')) throw new Error('Unexpected test directory');
    rmSync(root, {recursive:true,force:true});
  });
  mkdirSync(join(root,'assets/js'), {recursive:true});mkdirSync(join(root,'api'));
  writeFileSync(join(root,'index.html'), '<meta name="unilink-version" content="development">');
  writeFileSync(join(root,'assets/js/sw.js'), "const CACHE_NAME = 'development';\nconst SHELL_INTEGRITY = {};");
  writeFileSync(join(root,'assets/js/updates.js'), "const CURRENT_VERSION = 'development';");
  writeFileSync(join(root,'api/example.js'), 'export default 1;');
  return root;
}
test('release metadata, HTML, runtime and worker identify the same build; unchanged builds are stable',t=>{
  const root=fixture(t);const version=buildRelease(root);
  assert.match(version,/^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(readFileSync(join(root,'version.json'))).version,version);
  assert.ok(readFileSync(join(root,'index.html'),'utf8').includes(version));
  assert.ok(readFileSync(join(root,'assets/js/updates.js'),'utf8').includes(version));
  assert.ok(readFileSync(join(root,'assets/js/sw.js'),'utf8').includes(`univer-shell-${version}`));
  const integrity = JSON.parse(/const SHELL_INTEGRITY = (.*);/.exec(readFileSync(join(root,'assets/js/sw.js'),'utf8'))[1]);
  for (const path of ['index.html', 'assets/js/updates.js']) {
    assert.equal(integrity['/' + path], 'sha256-' + createHash('sha256').update(readFileSync(join(root,path))).digest('base64'));
  }
  assert.equal(integrity['/'], integrity['/index.html']);
  assert.equal(buildRelease(root),version);
});
test('public or server changes create new release IDs, while unserved local files do not',t=>{
  const root=fixture(t);const original=buildRelease(root);
  writeFileSync(join(root,'assets/example.css'),'body { color: red; }');
  const styled=buildRelease(root);assert.notEqual(styled,original);
  writeFileSync(join(root,'api/example.js'),'export default 2;');
  const server=buildRelease(root);assert.notEqual(server,styled);
  writeFileSync(join(root,'.env'),'UNUSED_TEST_VALUE=example');
  assert.equal(buildRelease(root),server);
});
test('a missing version marker fails the build instead of publishing an untracked release',t=>{
  const root=fixture(t);writeFileSync(join(root,'index.html'),'<title>UniLink</title>');
  assert.throws(()=>buildRelease(root),/markers/);
});

test('a missing integrity marker fails the build instead of publishing an unprotected worker', t => {
  const root = fixture(t);
  writeFileSync(join(root,'assets/js/sw.js'), "const CACHE_NAME = 'development';");
  assert.throws(() => buildRelease(root), /markers/);
});

test('generated integrity accepts the built bytes and rejects a different deployment', async t => {
  const root = fixture(t); buildRelease(root);
  const integrity = JSON.parse(/const SHELL_INTEGRITY = (.*);/.exec(readFileSync(join(root,'assets/js/sw.js'),'utf8'))[1]);
  const bytes = readFileSync(join(root,'assets/js/updates.js'));
  const options = { integrity: integrity['/assets/js/updates.js'] };
  const url = content => 'data:application/javascript;base64,' + Buffer.from(content).toString('base64');
  assert.equal(await (await fetch(url(bytes), options)).text(), bytes.toString());
  await assert.rejects(fetch(url(Buffer.concat([bytes, Buffer.from('\n// another release')])), options), /fetch failed/);
});
test('deployment runs the release builder and prevents cached release metadata',()=>{
  const config=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.buildCommand,'node scripts/build-release.mjs');
  assert.equal(config.outputDirectory,'.', 'Static files are built in the repository root, not public/');
  assert.ok(config.headers.find(rule=>rule.source==='/version.json').headers.some(header=>header.key==='Cache-Control'&&header.value==='no-store'));
  assert.match(readFileSync(new URL('../../.vercelignore',import.meta.url),'utf8'),/!scripts\/build-release\.mjs/);
});

test('the actual application builds consistently without modifying the checkout',t=>{
  const root=fixture(t),source=fileURLToPath(new URL('../../',import.meta.url));
  for(const folder of ['assets','api'])cpSync(join(source,folder),join(root,folder),{recursive:true});
  for(const path of ['index.html','manifest.webmanifest','package.json','vercel.json'])cpSync(join(source,path),join(root,path));
  const before=readFileSync(join(source,'index.html'),'utf8');
  const version=buildRelease(root);assert.equal(buildRelease(root),version);
  assert.equal(readFileSync(join(source,'index.html'),'utf8'),before);
  assert.ok(readFileSync(join(root,'assets/js/updates.js'),'utf8').includes(`const CURRENT_VERSION = '${version}';`));
  assert.ok(readFileSync(join(root,'assets/js/sw.js'),'utf8').includes(`const CACHE_NAME = 'univer-shell-${version}';`));
});
