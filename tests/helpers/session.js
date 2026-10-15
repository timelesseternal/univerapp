import {sealSession,SESSION_COOKIE} from '../../api/_lib/security.js';
process.env.UNILINK_SESSION_KEY='01'.repeat(32);
export function sessionHeaders(base64){return {cookie:SESSION_COOKIE+'='+sealSession(JSON.parse(Buffer.from(base64,'base64').toString()))};}
