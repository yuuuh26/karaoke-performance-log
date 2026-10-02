import {captureSnapshot,restoreSnapshot,readLocal} from './local-store';
import {createBackup,validateBackup,type Backup} from './snapshot';
import {uploadBackup,type CloudConnection} from './cloud-backup';

// Call only after the preview's explicit confirmation. There is no startup
// import or automatic restore. Every failure before the final transaction
// leaves records and the local recovery copy unchanged.
export async function restoreFromCloud(connection:CloudConnection,backup:Backup,expectedRevision:number){
  const source=await validateBackup(backup);
  const current=await captureSnapshot();
  if(current.state.revision!==expectedRevision)throw Error('確認中に端末の記録が更新されました。もう一度内容を確認してください');
  const protectedBackup=await uploadBackup(connection,await createBackup(current));
  // A round trip of the complete pre-restore snapshot is required, including
  // tags, machines, settings, and the previous local recovery copy.
  const restored=await restoreSnapshot(source,expectedRevision,{backupId:protectedBackup.backup_id,createdAt:protectedBackup.created_at,sentAt:new Date().toISOString(),backedUpChanges:current.state.importantChanges??0});
  const checked=await readLocal();
  if(!checked||JSON.stringify(checked)!==JSON.stringify(restored))throw Error('復元後の照合に失敗しました。復元前のクラウド履歴と端末の退避データを保持しています');
  return {state:restored,protectedBackupId:protectedBackup.backup_id};
}
