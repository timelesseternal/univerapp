import {injectSpeedInsights} from './vendor/speed-insights.js';

// The app uses one public route. Deep links and query strings can contain IDs.
export function sanitizePerformanceEvent(event, origin) {
  try {
    const url = new URL('/',origin);
    if (url.protocol !== 'https:') return null;
    return {...event,url:url.href,route:'/'};
  } catch { return null; }
}

if (typeof window !== 'undefined' && window.location.protocol === 'https:' && window.navigator.onLine !== false) {
  injectSpeedInsights({
    route:'/', debug:false,
    scriptSrc:'/_vercel/speed-insights/script.js',
    endpoint:'/_vercel/speed-insights/vitals',
    beforeSend:event=>sanitizePerformanceEvent(event,window.location.origin),
  });
}
