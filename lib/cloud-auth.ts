export const CLOUD_ORIGIN='https://karaoke-performance-log-backups.dengana-10011212.workers.dev';
export const hosted=()=>globalThis.location?.origin===CLOUD_ORIGIN;
export class CloudError extends Error {constructor(public status:number,message:string){super(message)}}
export type DeviceSession={id:string;deviceName:string;createdAt:string;lastUsedAt:string;current:boolean};
async function request(path:string,method='GET',body?:unknown,key?:string){
  if(!hosted())throw Error('ログイン保持はカラオケ専用アドレスから利用してください');
  if(key!==undefined&&!/^[A-Za-z0-9_-]{43,128}$/.test(key.trim()))throw Error('復旧キーを確認してください');
  const response=await fetch(CLOUD_ORIGIN+path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000),headers:{...(key?{Authorization:'Bearer '+key.trim()}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw new CloudError(response.status,data.error??`通信に失敗しました（${response.status}）`);return data;
}
export const sessionStatus=()=>request('/v1/session');
export const login=(key:string,deviceName:string)=>request('/v1/session','POST',{deviceName},key);
export const logout=()=>request('/v1/session/logout','POST',{});
export const listSessions=async(key:string):Promise<DeviceSession[]>=>(await request('/v1/sessions','POST',{},key)).sessions;
export const revokeSession=(key:string,sessionId?:string)=>request('/v1/sessions/revoke','POST',sessionId?{sessionId}:{all:true},key);
