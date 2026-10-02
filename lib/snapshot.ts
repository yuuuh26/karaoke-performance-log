import {validateRecords} from './records';
import type {LocalState} from './local-store';

export const APP_ID='karaoke-performance-log';
export const SCHEMA_VERSION=1;
export const MAX_SNAPSHOT_BYTES=8*1024*1024;
export type Snapshot={format:'karaoke-performance-log.snapshot';schema_version:1;state:LocalState;recovery:LocalState|null;cloud_settings?:{url:string;deviceId:string}|null};
export type Backup={backup_id:string;app_id:typeof APP_ID;schema_version:1;created_at:string;device_id:string|null;record_count:number;source_revision:number;backup_json:string;sha256:string;byte_length:number};
export type BackupSummary=Omit<Backup,'backup_json'> & {received_at?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const iso=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function validateState(value:unknown):asserts value is LocalState {
  validateRecords(value);
  const s=value as LocalState;
  for(const key of ['revision','peakCount','readMilestone','jsonMilestone'] as const) {
    if(!integer(s[key]))throw Error('バックアップの保存情報が不正です');
  }
  if(typeof s.lastMachine!=='string'||(s.lastSavedAt!==''&&!iso(s.lastSavedAt)) ||
     (s.lastImportAt!==undefined&&!iso(s.lastImportAt)))throw Error('バックアップの設定・日時が不正です');
  if(s.importantChanges!==undefined&&!integer(s.importantChanges))throw Error('変更件数が不正です');
  if(s.cloudBackup&&(!uuid.test(s.cloudBackup.backupId)||!iso(s.cloudBackup.createdAt)||!integer(s.cloudBackup.backedUpChanges)||s.cloudBackup.backedUpChanges>(s.importantChanges??0)))throw Error('クラウド保存情報が不正です');
}
export function parseSnapshot(text:string):Snapshot {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_SNAPSHOT_BYTES)throw Error('クラウド用JSONは8MBまでです。端末のJSONバックアップを保存してください');
  const v=JSON.parse(text);
  if(!v||v.format!=='karaoke-performance-log.snapshot'||v.schema_version!==SCHEMA_VERSION)throw Error('このスナップショット形式・バージョンには対応していません');
  validateState(v.state);
  if(v.recovery!==null)validateState(v.recovery);
  if(v.cloud_settings!=null&&(typeof v.cloud_settings.url!=='string'||!uuid.test(v.cloud_settings.deviceId)))throw Error('クラウド設定の保存情報が不正です');
  return v;
}
export async function digest(text:string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function createBackup(snapshot:Snapshot,deviceId:string|null=null):Promise<Backup> {
  const backup_json=JSON.stringify(snapshot);
  const checked=parseSnapshot(backup_json);
  if(deviceId!==null&&!uuid.test(deviceId))throw Error('端末IDが不正です');
  return {backup_id:crypto.randomUUID(),app_id:APP_ID,schema_version:SCHEMA_VERSION,
    created_at:new Date().toISOString(),device_id:deviceId,record_count:checked.state.songs.length,
    source_revision:checked.state.revision,backup_json,sha256:await digest(backup_json),
    byte_length:new TextEncoder().encode(backup_json).length};
}
export async function validateBackup(input:unknown):Promise<Snapshot> {
  const v=input as Backup;
  if(!v||!uuid.test(v.backup_id)||v.app_id!==APP_ID||v.schema_version!==SCHEMA_VERSION||!iso(v.created_at)||
    (v.device_id!==null&&!uuid.test(v.device_id))||!integer(v.record_count)||!integer(v.source_revision)||
    !integer(v.byte_length)||typeof v.sha256!=='string'||!/^[0-9a-f]{64}$/.test(v.sha256))throw Error('バックアップの識別情報が不正です');
  const snapshot=parseSnapshot(v.backup_json);
  if(v.record_count!==snapshot.state.songs.length||v.source_revision!==snapshot.state.revision||
    v.byte_length!==new TextEncoder().encode(v.backup_json).length||v.sha256!==await digest(v.backup_json))throw Error('バックアップの件数・サイズ・照合値が一致しません');
  return snapshot;
}
