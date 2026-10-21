import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../assets/js/loading.js',import.meta.url),'utf8');
export function installLoading(context) {
  context.window ??= {};
  if(vm.isContext(context))vm.runInContext(source,context);
  else vm.runInNewContext(source,context);
  context.loadingHtml=(...args)=>context.window.unilinkLoading.html(...args);
}
