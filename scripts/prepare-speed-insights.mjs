import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

// The generic SDK is self-contained; serve it locally without adding a bundler.
const target = new URL('../assets/js/vendor/',import.meta.url);
mkdirSync(target,{recursive:true});
const source = new URL(import.meta.resolve('@vercel/speed-insights'));
const sdk = readFileSync(source,'utf8').replace(/\n\/\/# sourceMappingURL=.*$/m,'');
writeFileSync(new URL('speed-insights.js',target),'/* @vercel/speed-insights — Apache-2.0; see speed-insights.LICENSE.txt. */\n'+sdk);
writeFileSync(new URL('speed-insights.LICENSE.txt',target),readFileSync(new URL('../LICENSE',new URL('./',source))));
console.log('Prepared Vercel Speed Insights browser SDK.');
