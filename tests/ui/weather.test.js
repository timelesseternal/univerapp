import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');

test('blocked local storage does not break the weather card',()=>{
  const element={innerHTML:''};
  const ctx=vm.createContext({document:{getElementById:()=>element},
    localStorage:{getItem(){throw new Error('storage blocked');}},smartWeatherHtml:city=>city});
  vm.runInContext(source.slice(source.indexOf('  function lsSafe('),source.indexOf('  // Mirror display data')),ctx);
  vm.runInContext(source.slice(source.indexOf('  let dayOffWeatherCache'),source.indexOf('  let weatherRequest')),ctx);
  ctx.renderDayOffWeatherHtml({});assert.equal(element.innerHTML,'Караганда');
});
test('changing the city refreshes the card and discards an older response', async () => {
  let city = 'A'; const element = { innerHTML: '' }; const pending = [];
  const context = vm.createContext({ document: { getElementById: () => element }, localStorage: { getItem: () => city }, CITY_COORDS: { A: {}, B: {} }, Date, Promise,
    weatherSkeletonHtml: () => 'Loading', smartWeatherHtml: (name) => name,
    fetchDayWeatherDetails: () => new Promise(resolve => pending.push(resolve)), fetchAirQuality: async () => ({ current: { us_aqi: 20 } }) });
  vm.runInContext(source.slice(source.indexOf('  function lsSafe('), source.indexOf('  // Mirror display data')), context);
  vm.runInContext(source.slice(source.indexOf('  let dayOffWeatherCache'), source.indexOf('  let weatherRequest')), context);
  const old = context.fillDayOffWeather(); city = 'B'; const fresh = context.fillDayOffWeather();
  pending[1]({ current: {} }); await fresh; assert.equal(element.innerHTML, 'B');
  pending[0]({ current: {} }); await old; assert.equal(element.innerHTML, 'B');
  assert.match(source.slice(source.indexOf('  function saveCityAndLoad'), source.indexOf('  const ACCENT_THEMES')), /fillDayOffWeather()/);
});
