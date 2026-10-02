import {useEffect,useState} from 'react';
import {captureSnapshot,markCloudBackup,readCloudSettings,saveCloudSettings,type LocalState} from '../lib/local-store';
import {createBackup,validateBackup,type Backup,type BackupSummary} from '../lib/snapshot';
import {fetchBackup,listBackups,uploadBackup,type CloudConnection} from '../lib/cloud-backup';
import {restoreFromCloud} from '../lib/cloud-restore';

const stamp=(time:string)=>new Date(time).toLocaleString('ja-JP');
export default function CloudBackups({local,disabled,onSaved,onRestored}:{local:LocalState|null;disabled:boolean;onSaved:(s:LocalState)=>void;onRestored:(s:LocalState)=>void}){
  const [url,setUrl]=useState(''),[token,setToken]=useState(''),[deviceId,setDeviceId]=useState('');
  const [connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [history,setHistory]=useState<BackupSummary[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [retry,setRetry]=useState<Backup|null>(null);
  const [pending,setPending]=useState<{backup:Backup;revision:number;currentCount:number}|null>(null);
  useEffect(()=>{let active=true;readCloudSettings().then(s=>{if(active&&s){setUrl(s.url);setDeviceId(s.deviceId)}}).catch(()=>{if(active)setError('クラウド設定を読み込めません。通常の記録保存は利用できます')});return()=>{active=false}},[]);
  const connection=():CloudConnection=>({url:url.trim(),token:token.trim()});
  const changes=Math.max(0,(local?.importantChanges??0)-(local?.cloudBackup?.backedUpChanges??0));
  const blocked=disabled||busy||!local;
  async function run(action:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await action()}catch(e){setError(e instanceof Error?e.message:'処理できませんでした')}finally{setBusy(false)}}
  async function refresh(more=false){const result=await listBackups(connection(),more?cursor:null);setHistory(old=>more?[...old,...result.backups]:result.backups);setCursor(result.next_cursor)}
  function forget(){setToken('');setConnected(false);setHistory([]);setCursor(null);setPending(null);setRetry(null);setNotice('復旧キーをこの画面のメモリーから消しました')}
  async function connect(){await refresh();const id=deviceId||crypto.randomUUID();await saveCloudSettings({url:url.trim(),deviceId:id});setDeviceId(id);setConnected(true);setNotice('接続を確認しました。記録は端末に保存したままです')}
  async function backup(){
    const captured=await captureSnapshot();
    const candidate=retry??await createBackup(captured,deviceId||null);setRetry(candidate);
    const saved=await uploadBackup(connection(),candidate);
    const verified=await validateBackup(saved);
    onSaved(await markCloudBackup(saved,verified.state.importantChanges??0));
    setRetry(null);setNotice(`${saved.record_count}件のクラウド保存と読み戻しを確認しました`);await refresh();
  }
  async function preview(id:string){const backup=await fetchBackup(connection(),id);const current=await captureSnapshot();setPending({backup,revision:current.state.revision,currentCount:current.state.songs.length})}
  async function restore(){
    if(!pending)return;
    if(!confirm(`選択した日時の${pending.backup.record_count}件に復元します。現在の${pending.currentCount}件はクラウドに別の履歴として退避してから置き換えます。よろしいですか？`))return;
    await run(async()=>{const result=await restoreFromCloud(connection(),pending.backup,pending.revision);onRestored(result.state);setPending(null);setRetry(null);setNotice(`復元を照合しました。復元前の履歴ID：${result.protectedBackupId}`);await refresh()});
  }
  async function json(){const full=await createBackup(await captureSnapshot(),deviceId||null);const blob=new Blob([JSON.stringify(full,null,2)],{type:'application/json'});const objectUrl=URL.createObjectURL(blob),link=document.createElement('a');link.href=objectUrl;link.download=`カラオケ全データ_${full.created_at.replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),10000);setNotice('全データJSONのダウンロードを開始しました。端末で保存完了を確認してください')}
  async function inspect(file?:File){if(!file)return;await run(async()=>{if(file.size>17*1024*1024)throw Error('クラウド用JSONは17MBまでです');const backup=JSON.parse(await file.text());await validateBackup(backup);const current=await captureSnapshot();setPending({backup,revision:current.state.revision,currentCount:current.state.songs.length})})}
  return <section className="dataManager cloudBackups" aria-labelledby="cloud-backup-title">
    <h2 id="cloud-backup-title">クラウドバックアップ</h2>
    <p>普段の記録はこの端末に保存します。クラウドへは操作したときに履歴を追加します。</p>
    <p>最終クラウドバックアップ：{local?.cloudBackup?stamp(local.cloudBackup.createdAt):'未確認'}<br/>前回からの重要な変更：{changes}件</p>
    {changes>=15&&<p className="backupNotice" role="status">15件以上の変更があります。クラウドにもバックアップを保存してください。</p>}
    <p className="cloudHint">復旧キーは、ブラウザが消えても使えるように別の安全な場所で保管してください。画面を閉じると再入力が必要です。</p>
    <div className="cloudFields"><label>バックアップ先のWorker URL<input type="url" value={url} disabled={busy||connected} placeholder="https://…workers.dev" onChange={e=>setUrl(e.target.value)} /></label>
    <label>バックアップ用の復旧キー<input type="password" value={token} autoComplete="off" spellCheck={false} disabled={busy||connected} onChange={e=>setToken(e.target.value)} /></label></div>
    <div className="backupActions"><button className="outlineButton" disabled={blocked||connected} onClick={()=>run(connect)}>接続を確認</button><button className="outlineButton" disabled={busy} onClick={forget}>復旧キーを画面から消す</button><button className="outlineButton" disabled={blocked} onClick={()=>run(json)}>全データJSONを作成</button></div>
    {connected&&<div className="backupActions"><button className="outlineButton" disabled={blocked} onClick={()=>run(backup)}>{retry?'前の保存を再試行':'Cloudflareへ保存'}</button><button className="outlineButton" disabled={blocked} onClick={()=>run(()=>refresh())}>履歴を更新</button></div>}
    {retry&&<p>通信結果が未確認のバックアップを保持しています。再試行は同じIDで行い、重複や上書きを防ぎます。{local&&local.revision!==retry.source_revision?'その後の変更は、再試行成功後にもう一度保存してください。':''}</p>}
    {connected&&<ul className="cloudHistory">{history.map(b=><li key={b.backup_id}><span>{stamp(b.created_at)}・{b.record_count}件</span><button className="outlineButton" disabled={blocked} onClick={()=>run(()=>preview(b.backup_id))}>復元内容を確認</button></li>)}</ul>}
    {cursor&&connected&&<button className="outlineButton" disabled={blocked} onClick={()=>run(()=>refresh(true))}>さらに過去の履歴</button>}
    <label>全データJSONの復元内容を確認<input type="file" accept=".json,application/json" disabled={blocked} onChange={e=>{inspect(e.target.files?.[0]);e.target.value=''}} /></label>
    {pending&&<div className="restorePanel"><strong>{stamp(pending.backup.created_at)}のバックアップ</strong><p>歌唱記録{pending.backup.record_count}件・タグ{JSON.parse(pending.backup.backup_json).state.tags.length}件・採点機{JSON.parse(pending.backup.backup_json).state.machines.length}件</p><p>現在の記録をクラウドへ退避できなければ復元を中止します。復元には接続確認が必要です。</p><div className="backupActions"><button className="outlineButton" disabled={blocked||!connected} onClick={restore}>確認してこの日時に復元</button><button className="outlineButton" disabled={busy} onClick={()=>setPending(null)}>キャンセル</button></div></div>}
    {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  </section>;
}
