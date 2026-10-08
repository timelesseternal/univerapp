import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
function setup(tg, navigator = {}) {
  const downloads = [];
  const context = vm.createContext({ tg, navigator: { userAgent: 'Windows', platform: 'Win32', ...navigator },
    window: { showSaveFilePicker() { throw new Error('Blocked'); } }, Blob,
    File: class { constructor(parts, name) { this.name = name; } },
    location: { origin: 'https://example.test' }, API_BASE: '', platonusSession: 'test',
    currentUmkdPdf: { buffer: new ArrayBuffer(8), fileName: 'Предмет.pdf' },
    currentUmkdRef: { fileTypeID: 131, umkdid: 7 }, haptic() {},
    downloadBlob: (blob, name) => downloads.push({ blob, name }) });
  vm.runInContext(source.slice(source.indexOf('  function isMobilePlatform'), source.indexOf('  function buildUmkdFileName')), context);
  vm.runInContext(source.slice(source.indexOf('  async function shareUmkdFile'), source.indexOf('  async function openUmkdFile')), context);
  return { context, downloads };
}
test('desktop browser downloads directly despite the loaded Telegram SDK and blocked picker', async () => {
  const ui = setup({ initData: '', platform: 'web', downloadFile() { throw new Error('Not in Telegram'); } });
  await ui.context.shareUmkdFile();
  assert.equal(ui.downloads.length, 1);
  assert.equal(ui.downloads[0].name, 'Предмет.pdf');
  assert.equal(ui.downloads[0].blob.type, 'application/pdf');
});
test('Telegram Desktop uses its native downloader', async () => {
  let download;
  const ui = setup({ initData: 'verified-by-server-elsewhere', platform: 'tdesktop', isVersionAtLeast: () => true, downloadFile: value => { download = value; } });
  await ui.context.shareUmkdFile();
  assert.equal(download.file_name, 'Предмет.pdf');
  assert.match(download.url, /download=1/);
  assert.equal(ui.downloads.length, 0);
});
test('iPhone browser keeps the share sheet even when SDK platform is web', async () => {
  let shared = 0;
  const ui = setup({ initData: '', platform: 'web' }, { userAgent: 'iPhone', canShare: () => true, share: async () => { shared++; } });
  await ui.context.shareUmkdFile();
  assert.equal(shared, 1); assert.equal(ui.downloads.length, 0);
});
test('cancelling the phone share sheet does not start another download', async () => {
  const ui = setup(null, { userAgent: 'iPhone', canShare: () => true, share: async () => { throw { name: 'AbortError' }; } });
  await ui.context.shareUmkdFile(); assert.equal(ui.downloads.length, 0);
});
test('Android without file sharing uses a browser download', async () => {
  const ui = setup(null, { userAgent: 'Android' });
  await ui.context.shareUmkdFile(); assert.equal(ui.downloads.length, 1);
});
