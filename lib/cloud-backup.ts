import {createBackup,validateBackup,type Backup,type BackupSummary,type Snapshot} from './snapshot';
import {CLOUD_ORIGIN,hosted,CloudError} from './cloud-auth';
export type CloudConnection={url:string;token?:string};
function endpoint(connection:CloudConnection,path:string) {
  const url=new URL(connection.url);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/' ||
    !url.hostname.endsWith('.workers.dev'))throw Error('バックアップ先にはHTTPSのWorker URLを指定してください');
  if(connection.token===undefined){if(url.origin!==CLOUD_ORIGIN||!hosted())throw Error('カラオケ専用アドレスでログインしてください')}
  else if(!/^[A-Za-z0-9_-]{43,128}$/.test(connection.token))throw Error('バックアップ用の復旧キーを確認してください');
  return new URL(path,url).href;
}
async function request(connection:CloudConnection,path:string,method='GET',body?:unknown) {
  const response=await fetch(endpoint(connection,path),{method,mode:'cors',credentials:connection.token===undefined?'same-origin':'omit',cache:'no-store',
    redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{...(connection.token?{Authorization:`Bearer ${connection.token}`} :{}),...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw new CloudError(response.status,`クラウドへの通信に失敗しました（${response.status}）。端末の記録は変更していません${response.status===401?'。ログイン状態を確認してください':''}`);
  return response.json();
}
// Retry this same Backup object after an interrupted upload. A new identifier
// would create another history entry. A verified round trip confirms storage.
export async function uploadBackup(connection:CloudConnection,backup:Backup):Promise<Backup> {
  await validateBackup(backup);
  await request(connection,`/v1/backups/${backup.backup_id}`,'PUT',backup);
  const saved=await fetchBackup(connection,backup.backup_id);
  if(saved.sha256!==backup.sha256||saved.backup_json!==backup.backup_json)throw Error('クラウド保存後の照合に失敗しました。端末の記録は変更していません');
  return saved;
}
export async function saveSnapshot(connection:CloudConnection,snapshot:Snapshot,deviceId:string|null=null) {
  return uploadBackup(connection,await createBackup(snapshot,deviceId));
}
export async function fetchBackup(connection:CloudConnection,id:string):Promise<Backup> {
  if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('バックアップIDが不正です');
  const backup=await request(connection,`/v1/backups/${id}`);
  await validateBackup(backup);
  if(backup.backup_id!==id)throw Error('指定したバックアップと一致しません');
  return backup;
}
export async function listBackups(connection:CloudConnection,cursor:string|null=null):Promise<{backups:BackupSummary[];next_cursor:string|null}> {
  const result=await request(connection,'/v1/backups'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
  if(!Array.isArray(result.backups)||!(result.next_cursor===null||typeof result.next_cursor==='string'))throw Error('クラウドの一覧を確認できません');
  return result;
}
