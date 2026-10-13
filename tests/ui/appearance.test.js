import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../assets/js/appearance.js',import.meta.url),'utf8');

test('installed app paints its status area and theme metadata together when switching theme',()=>{
  const attributes=new Map(),variables=new Map(),classes=new Set();
  const root={classList:{add:key=>classes.add(key)},style:{setProperty:(key,value)=>variables.set(key,value)},
    setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),getAttribute:key=>attributes.get(key)};
  const meta={setAttribute:(key,value)=>attributes.set('meta-'+key,value)};
  const store=new Map([['user_color_mode','dark']]);
  const window={navigator:{standalone:true},matchMedia:()=>({matches:false,addEventListener(){}})};
  vm.runInNewContext(source,{window,document:{documentElement:root,querySelector:selector=>selector==='meta[name="theme-color"]'?meta:null,querySelectorAll:()=>[],addEventListener(){}},
    localStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)}});
  assert.ok(classes.has('standalone-app'));assert.equal(variables.get('--system-bar-bg'),'#070809');
  window.toggleColorMode();
  assert.equal(root.style.backgroundColor,'#f0f2f7');assert.equal(root.style.colorScheme,'light');
  assert.equal(variables.get('--system-bar-bg'),attributes.get('meta-content'));
  assert.equal(store.get('user_color_mode'),'light');
});

test('installed iOS uses a native viewport; Safari, Android and Telegram keep their own viewport',()=>{
  const cases=[
    {navigator:{standalone:true,userAgent:'iPhone'},native:true},
    {navigator:{userAgent:'iPhone'},native:false},
    {navigator:{userAgent:'Android'},installed:true,native:false},
    {navigator:{platform:'MacIntel',maxTouchPoints:5},installed:true,native:true},
    {navigator:{standalone:true,userAgent:'iPhone'},telegram:true,native:false},
  ];
  for(const scenario of cases){
    const classes=new Set(),values=new Map([['viewport','width=device-width, initial-scale=1.0, viewport-fit=cover']]);
    const root={classList:{add:key=>classes.add(key)},style:{setProperty(){}},setAttribute(){},removeAttribute(){},getAttribute:()=>null};
    const viewport={getAttribute:()=>values.get('viewport'),setAttribute:(_,value)=>values.set('viewport',value)};
    const theme={setAttribute:(_,value)=>values.set('theme',value)};
    const window={navigator:scenario.navigator,matchMedia:query=>({matches:query.includes('display-mode')&&!!scenario.installed,addEventListener(){}})};
    if(scenario.telegram)window.Telegram={WebApp:{initData:'verified-context',colorScheme:'dark'}};
    vm.runInNewContext(source,{window,document:{documentElement:root,
      querySelector:selector=>selector==='meta[name="viewport"]'?viewport:theme,querySelectorAll:()=>[],addEventListener(){}},
      localStorage:{getItem:()=>null,setItem(){}}});
    assert.equal(classes.has('ios-native-viewport'),scenario.native);
    assert.equal(values.get('viewport').includes('viewport-fit=auto'),scenario.native);
    window.toggleColorMode();
    assert.equal(values.get('viewport').includes('viewport-fit=auto'),scenario.native);
  }
});
