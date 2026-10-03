import {useEffect,useRef,useState} from 'react';
import {captureSnapshot,markCloudBackup,readCloudSettings,saveCloudSettings,readPendingUpload,savePendingUpload,clearPendingUpload,type LocalState} from '../lib/local-store';
import {createBackup,validateBackup,type Backup,type BackupSummary} from '../lib/snapshot';
import {fetchBackup,listBackups,uploadBackup,type CloudConnection} from '../lib/cloud-backup';
import {CLOUD_ORIGIN,hosted,CloudError,sessionStatus,login,logout,listSessions,revokeSession,type DeviceSession} from '../lib/cloud-auth';
import {restoreFromCloud} from '../lib/cloud-restore';

const stamp=(time:string)=>new Date(time).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export default function CloudBackups({local,disabled,onSaved,onRestored}:{local:LocalState|null;disabled:boolean;onSaved:(s:LocalState)=>void;onRestored:(s:LocalState)=>void}){
  const persistent=hosted();
  const [deviceName,setDeviceName]=useState('この端末'),[sessions,setSessions]=useState<DeviceSession[]|null>(null);
  const [url,setUrl]=useState(persistent?CLOUD_ORIGIN:''),[token,setToken]=useState(''),[deviceId,setDeviceId]=useState('');
  const [connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [history,setHistory]=useState<BackupSummary[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [retry,setRetry]=useState<Backup|null>(null),[ready,setReady]=useState(false);
  const [networkTick,setNetworkTick]=useState(0),[retryDelay,setRetryDelay]=useState(800);
  const latest=useRef({local,disabled,connected:false});latest.current={local,disabled,connected};
  const [pending,setPending]=useState<{backup:Backup;revision:number;currentCount:number}|null>(null);
  const settingsRef=useRef<HTMLDetailsElement>(null),urlRef=useRef<HTMLInputElement>(null),tokenRef=useRef<HTMLInputElement>(null),running=useRef(false);
  useEffect(()=>{let active=true;Promise.all([readCloudSettings(),readPendingUpload()]).then(([s,upload])=>{if(active){if(s){if(!persistent)setUrl(s.url);setDeviceId(s.deviceId)}setRetry(upload??null);setReady(true)}}).catch(()=>{if(active)setError('クラウド設定を読み込めません。通常の記録保存は利用できます')});return()=>{active=false}},[]);
  useEffect(()=>{const wake=()=>{setRetryDelay(800);setNetworkTick(n=>n+1)};window.addEventListener('online',wake);window.addEventListener('offline',wake);window.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);return()=>{window.removeEventListener('online',wake);window.removeEventListener('offline',wake);window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake)}},[]);
  useEffect(()=>{if(!persistent||connected||window.navigator.onLine===false)return;let active=true;sessionStatus().then(s=>{if(active){setConnected(true);setDeviceName(s.deviceName);listBackups({url:CLOUD_ORIGIN}).then(r=>{if(active){setHistory(r.backups);setCursor(r.next_cursor)}}).catch(()=>{})}}).catch(e=>{if(active&&!(e instanceof CloudError&&e.status===401))setError('ログイン状態を確認できません。オンラインで再確認してください')});return()=>{active=false}},[networkTick]);
  const connection=():CloudConnection=>persistent?{url:CLOUD_ORIGIN}:{url:url.trim(),token:token.trim()};
  const changes=Math.max(0,(local?.importantChanges??0)-(local?.cloudBackup?.backedUpChanges??0));
  const needsUpload=changes>0||(!local?.cloudBackup&&!!local?.songs.length);
  const blocked=disabled||busy||!local||!ready;
  useEffect(()=>{
    if(!ready||!connected||disabled||busy||!local||(!needsUpload&&!retry)||window.navigator.onLine===false)return;
    const timer=setTimeout(()=>{const current=latest.current;if(!current.disabled&&current.connected)void run(backup,true,true)},retryDelay);
    return()=>clearTimeout(timer);
  },[ready,connected,disabled,busy,local?.revision,needsUpload,retry,retryDelay,networkTick]);
  async function run(action:()=>Promise<void>,sessionAuth=true,automatic=false){if(running.current)return;running.current=true;setBusy(true);setError('');setNotice('');try{await action()}catch(e){if(persistent&&sessionAuth&&e instanceof CloudError&&e.status===401){setConnected(false);setHistory([]);setCursor(null);setSessions(null)}setError((automatic?'自動バックアップは未完了です。端末に保存済みで、通信回復後に再試行します。 ':'')+(e instanceof Error?e.message:'処理できませんでした'));if(automatic)setRetryDelay(delay=>Math.min(60000,Math.max(5000,delay*2)))}finally{running.current=false;setBusy(false)}}
  function send(){
    if(blocked)return;
    if(connected){void run(backup);return;}
    setError('');setNotice('復旧キーで接続すると、保存済みの記録を自動でクラウドへ送信します。');
    if(settingsRef.current)settingsRef.current.open=true;
    requestAnimationFrame(()=>{const field=persistent||url.trim()?tokenRef.current:urlRef.current;field?.focus();field?.scrollIntoView({block:'center',behavior:'smooth'})});
  }
  async function refresh(more=false){const result=await listBackups(connection(),more?cursor:null);setHistory(old=>more?[...old,...result.backups]:result.backups);setCursor(result.next_cursor)}
  function forget(){setToken('');setSessions(null);if(!persistent){setConnected(false);setHistory([]);setCursor(null);setPending(null)}setNotice('復旧キーをこの画面のメモリーから消しました')}
  async function connect(){if(persistent){await login(token.trim(),deviceName.trim());setToken('');setSessions(null);setConnected(true)}await refresh();const id=deviceId||crypto.randomUUID();await saveCloudSettings({url:url.trim(),deviceId:id});setDeviceId(id);setConnected(true);setNotice(persistent?'ログインを保持しました。記録の追加・編集を保存すると自動でクラウドへ送信します':'接続を確認しました。この画面を開いている間、保存した変更を自動で送信します')}
  async function checkSession(){const s=await sessionStatus();setConnected(true);setDeviceName(s.deviceName);await refresh();setNotice('ログイン状態を確認しました')}
  async function disconnect(){await logout();setConnected(false);setToken('');setSessions(null);setHistory([]);setCursor(null);setNotice('この端末のログインを解除しました。端末内の記録は残っています')}
  async function devices(){const result=await listSessions(token.trim());setSessions(result);setNotice('本人確認が完了しました。端末を選んでログインを解除できます')}
  async function revoke(id?:string){if(!confirm(id?'この端末のクラウドへのアクセスを解除しますか？端末内の記録は消えません。':'このカラオケアプリの全端末のログインを解除しますか？端末内とクラウドの記録は消えません。'))return;await run(async()=>{await revokeSession(token.trim(),id);setSessions(await listSessions(token.trim()));try{await sessionStatus()}catch(e){if(e instanceof CloudError&&e.status===401){setConnected(false);setHistory([]);setCursor(null)}else throw e}setNotice('ログインを解除しました。解除された端末は、次の通信から復旧キーでの再接続が必要です')},false)}
  async function backup(){
    const captured=await captureSnapshot();
    const candidate=retry??await createBackup(captured,deviceId||null);await savePendingUpload(candidate);setRetry(candidate);
    const saved=await uploadBackup(connection(),candidate);
    const verified=await validateBackup(saved);
    onSaved(await markCloudBackup(saved,verified.state.importantChanges??0));
    await clearPendingUpload(saved.backup_id);setRetry(null);setRetryDelay(800);setNotice(`${saved.record_count}件のクラウド保存・照合が完了しました ✓`);
    try{await refresh()}catch{setError('送信は完了しましたが、履歴一覧を取得できませんでした。「履歴を更新」で再確認できます。')}
  }
  async function preview(id:string){const backup=await fetchBackup(connection(),id);const current=await captureSnapshot();setPending({backup,revision:current.state.revision,currentCount:current.state.songs.length})}
  async function restore(){
    if(!pending)return;
    if(!confirm(`選択した日時の${pending.backup.record_count}件に復元します。現在の${pending.currentCount}件はクラウドに別の履歴として退避してから置き換えます。よろしいですか？`))return;
    await run(async()=>{const result=await restoreFromCloud(connection(),pending.backup,pending.revision);onRestored(result.state);setPending(null);await clearPendingUpload();setRetry(null);setNotice(`復元を照合しました。復元前の履歴ID：${result.protectedBackupId}`);await refresh()});
  }
  async function json(){const full=await createBackup(await captureSnapshot(),deviceId||null);const blob=new Blob([JSON.stringify(full,null,2)],{type:'application/json'});const objectUrl=URL.createObjectURL(blob),link=document.createElement('a');link.href=objectUrl;link.download=`カラオケ全データ_${full.created_at.replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),10000);setNotice('全データJSONのダウンロードを開始しました。端末で保存完了を確認してください')}
  async function inspect(file?:File){if(!file)return;await run(async()=>{if(file.size>17*1024*1024)throw Error('クラウド用JSONは17MBまでです');const backup=JSON.parse(await file.text());await validateBackup(backup);const current=await captureSnapshot();setPending({backup,revision:current.state.revision,currentCount:current.state.songs.length})})}
  const lastSent=local?.cloudBackup?.sentAt??local?.cloudBackup?.createdAt;
  const quick=(
    <section className="cloudQuick cloudQuickBottom" aria-label="クラウド送信" aria-busy={busy}>
      <div className="cloudQuickRow">
        <button type="button" className="cloudSendButton" disabled={blocked} onClick={send}>{busy?'処理中…':retry?'クラウド送信を再試行':'クラウドへ送信'}</button>
        <div className="cloudSendStatus"><span>前回のクラウド送信</span><strong>{lastSent?<time dateTime={lastSent}>{stamp(lastSent)}</time>:'まだ送信していません'}</strong><small>未送信の変更：{changes}件{connected?' ・ '+(persistent?'ログイン保持中':'接続済み'):' ・ '+(persistent?'初回ログイン・再接続が必要':'未接続')}</small></div>
      </div>
      <small className="cloudDayReminder">{connected?(window.navigator.onLine===false?'オフラインです。端末に保存し、通信回復後に自動送信します。':busy?'クラウドで処理中です。歌唱記録は続けて入力できます。':needsUpload||retry?'未送信の記録を自動バックアップします。':'自動バックアップ有効：記録の追加・編集を保存すると送信します。'):'自動バックアップにはクラウドへの接続が必要です。'}</small>
      {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
    </section>
  );
  return <>
    {!persistent&&<aside className="cloudMigration"><strong>ログインを保持できる専用アドレスができました</strong><p>① この端末で移行用JSONを保存 → ② <a href={CLOUD_ORIGIN} target="_blank" rel="noopener">新しいうたログを開く</a> → ③ 復旧キーで初回ログイン → ④ JSONを選び、内容を確認して復元。今の記録はこのアドレスにも残ります。</p><button className="outlineButton" disabled={blocked} onClick={()=>run(json)}>移行用の全データJSONを保存</button></aside>}
    <details ref={settingsRef} className="cloudSettings">
      <summary>クラウドの接続設定・バックアップ履歴</summary>
      <section className="dataManager cloudBackups" aria-labelledby="cloud-backup-title">
    <h2 id="cloud-backup-title">クラウドバックアップ</h2>
    <p>記録の追加・編集は、まずこの端末に保存し、その後に自動でクラウドへ送信します。削除・タグ・採点機の変更や取り込みも対象です。通信できないときは未送信分を残し、再接続・次回起動後に送信します。最新5世代（最新1件＋過去4件）を保持し、新しい保存と照合の成功後に6世代目以降を自動削除します。</p>
    <p>前回のクラウド送信：{lastSent?stamp(lastSent):'まだ送信していません'}<br/>未送信の変更：{changes}件。入力途中の内容は送信しません。「記録する」「変更を保存」で確定すると自動バックアップします。</p>

    <p className="cloudHint">{persistent?'初回ログイン後は、この端末だけの通行証でログインを保持します。サーバー側の自動期限はありません。ブラウザのデータ消去や端末の解除後は復旧キーで再接続します。復旧キーは別の安全な場所で保管してください。':'復旧キーは別の安全な場所で保管してください。この旧アドレスでは画面を閉じると再入力が必要です。'}</p>
    {persistent&&<p>旧アドレスの記録を移すときは、移行用の全データJSONを保存し、初回ログイン後に下の「全データJSONの復元内容を確認」から選んで復元してください。クラウドに送信済みなら、履歴からの復元もできます。</p>}
    <div className="cloudFields">{!persistent&&<label>バックアップ先のWorker URL<input ref={urlRef} type="url" value={url} disabled={busy||connected} placeholder="https://…workers.dev" onChange={e=>setUrl(e.target.value)} /></label>}
    {persistent&&<label>この端末の名前<input value={deviceName} maxLength={80} disabled={busy||connected} onChange={e=>setDeviceName(e.target.value)} placeholder="例：優のiPhone" /></label>}
    <label>{persistent?'復旧キー（初回ログイン・端末管理の本人確認）':'バックアップ用の復旧キー'}<input ref={tokenRef} type="password" value={token} autoComplete="off" spellCheck={false} disabled={busy||(!persistent&&connected)} onChange={e=>{setToken(e.target.value);setSessions(null)}} /></label></div>
    <div className="backupActions"><button className="outlineButton" disabled={blocked||connected} onClick={()=>run(connect)}>{persistent?'この端末でログインを保持':'接続を確認'}</button>{persistent&&<button className="outlineButton" disabled={blocked} onClick={()=>run(checkSession)}>ログイン状態を確認</button>}<button className="outlineButton" disabled={busy} onClick={forget}>復旧キーを画面から消す</button><button className="outlineButton" disabled={blocked} onClick={()=>run(json)}>全データJSONを作成</button>{persistent&&connected&&<button className="outlineButton" disabled={busy} onClick={()=>run(disconnect)}>この端末のログインを解除</button>}</div>
    {persistent&&<section className="deviceManager"><h3>ログイン中の端末を管理</h3><p>復旧キーを上の欄に入力して本人確認すると、このカラオケアプリだけの端末一覧を確認・解除できます。操作後は「復旧キーを画面から消す」を押してください。</p><button className="outlineButton" disabled={blocked||!token.trim()} onClick={()=>run(devices,false)}>本人確認して端末一覧を表示</button>{sessions&&<><ul className="cloudHistory">{sessions.map(s=><li key={s.id}><span><strong>{s.deviceName}{s.current?'（この端末）':''}</strong><br/>初回ログイン：{stamp(s.createdAt)}<br/>最終利用：{stamp(s.lastUsedAt)}</span><button className="outlineButton" disabled={busy} onClick={()=>revoke(s.id)}>この端末を解除</button></li>)}</ul>{sessions.length===0?<p>ログイン中の端末はありません。</p>:<button className="outlineButton" disabled={busy} onClick={()=>revoke()}>このアプリの全端末を解除</button>}</>}</section>}
    {connected&&<div className="backupActions"><button className="outlineButton" disabled={blocked} onClick={()=>run(()=>refresh())}>履歴を更新</button></div>}
    {retry&&<p>通信結果が未確認のバックアップを保持しています。再試行は同じIDで行い、重複や上書きを防ぎます。{local&&local.revision!==retry.source_revision?'その後の変更も、再試行成功後に自動で追加送信します。':''}</p>}
    {connected&&<ul className="cloudHistory">{history.map(b=><li key={b.backup_id}><span>{stamp(b.created_at)}・{b.record_count}件</span><button className="outlineButton" disabled={blocked} onClick={()=>run(()=>preview(b.backup_id))}>復元内容を確認</button></li>)}</ul>}
    {cursor&&connected&&<button className="outlineButton" disabled={blocked} onClick={()=>run(()=>refresh(true))}>さらに過去の履歴</button>}
    <label>全データJSONの復元内容を確認<input type="file" accept=".json,application/json" disabled={blocked} onChange={e=>{inspect(e.target.files?.[0]);e.target.value=''}} /></label>
    {pending&&<div className="restorePanel"><strong>{stamp(pending.backup.created_at)}のバックアップ</strong><p>歌唱記録{pending.backup.record_count}件・タグ{JSON.parse(pending.backup.backup_json).state.tags.length}件・採点機{JSON.parse(pending.backup.backup_json).state.machines.length}件</p><p>現在の記録をクラウドへ退避できなければ復元を中止します。復元には接続確認が必要です。</p><div className="backupActions"><button className="outlineButton" disabled={blocked||!connected} onClick={restore}>確認してこの日時に復元</button><button className="outlineButton" disabled={busy} onClick={()=>setPending(null)}>キャンセル</button></div></div>}
      </section>
    </details>
    {quick}
  </>;
}
