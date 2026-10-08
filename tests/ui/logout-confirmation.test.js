import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
test('browser logout uses the application dialog even when Telegram SDK exists', () => {
  let count = 0;
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const context = vm.createContext({ document: { getElementById: () => dialog }, haptic() {},
    tg: { showConfirm() { throw new Error('Unavailable outside Telegram'); } },
    logout() { count++; } });
  vm.runInContext(source.slice(source.indexOf('  function confirmLogout'), source.indexOf('  function logout()')), context);
  context.confirmLogout(); assert.equal(dialog.open, true);
  context.closeLogoutConfirmation(); assert.equal(count, 0);
  context.confirmLogout(); context.closeLogoutConfirmation(true);
  assert.equal(count, 1); assert.equal(dialog.open, false);
});
