"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type Song, type Machine, type Tag, type Records, buildSongIndex, suggest, sorted, markdown } from "../lib/records";
import { type LocalState, readLocal, initializeLocal, saveRecords, markExport, milestone, backupText, parseBackup, restoreRecords, recoveryBackup } from "../lib/local-store";

type SongForm = {
  title: string; artist: string; releaseYear: string; sungAt: string; key: string; score: string;
  posture: '' | '立位' | '座位' | '混合'; machine: string; familiarity: number | null; tempo: string; throatLoad: number | null; tagIds:number[]; memo:string;
};

const emptyForm = (): SongForm => ({ title:"", artist:"", releaseYear:"", sungAt:"", key:"", score:"", posture:"", machine:"", familiarity:null, tempo:"", throatLoad:null, tagIds:[], memo:"" });
const keyLabel = (key: number | null) => key == null ? "記入なし" : key === 0 ? "原キー" : key > 0 ? `＋${key}` : `${key}`;
const stars = (value: number) => "★".repeat(value) + "☆".repeat(5 - value);
const songKey = (song: Song) => song.title.trim().toLowerCase();
const toDate = (value: string) => new Date(value.length === 10 ? `${value}T12:00:00+09:00` : value);
const japanDay = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone:"Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit" }).format(date);
const displayDateTime = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone:"Asia/Tokyo", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }).format(toDate(value));
const toLocalInput = (value: string) => {
  const date = toDate(value);
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone:"Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
};

function outputText(song: Song) {
  const value = (text: string | number | null) => text === "" || text == null ? "記入なし" : text;
  return [
    `曲名：${song.title}`, `歌手名：${value(song.artist)}`, `リリース年：${song.releaseYear == null ? "記入なし" : `${song.releaseYear}年`}`, `キー：${keyLabel(song.key)}`,
    `採点：${song.score == null ? "記入なし" : `${song.score.toFixed(3)}点${song.machine ? `（${song.machine}）` : ""}`}`,
    `熟練度：${song.familiarity == null ? "記入なし" : `${stars(song.familiarity)}（${song.familiarity}/5）`}`,
    `テンポ：${value(song.tempo)}`, `歌唱姿勢：${value(song.posture ?? "")}`,
    `喉への負担：${song.throatLoad == null ? "記入なし" : `${stars(song.throatLoad)}（${song.throatLoad}/5）`}`,
    `タグ：${song.tags.length ? song.tags.map(tag=>tag.name).join("、"):"記入なし"}`,
    `コメント：${value(song.memo)}`,
    `歌唱日時：${displayDateTime(song.sungAt)}`,
  ].join("\n");
}

function Rating({ label, value, onChange }: { label:string; value:number | null; onChange:(value:number | null) => void }) {
  return <fieldset className="ratingField"><legend>{label}</legend><div className="rating" aria-label={`${label} ${value ?? "未選択"}`}>
    {[1,2,3,4,5].map(number => <button key={number} type="button" className={value != null && number <= value ? "active" : ""} onClick={() => onChange(value === number ? null : number)} aria-label={`${label} ${number}`}>★</button>)}
    <span>{value == null ? "未選択" : `${value}/5`}</span>{value != null && <button type="button" className="clearChoice" onClick={() => onChange(null)}>クリア</button>}
  </div></fieldset>;
}

export default function Home() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [form, setForm] = useState<SongForm>(() => emptyForm());
  const [manageMachines, setManageMachines] = useState(false);
  const [newMachine, setNewMachine] = useState("");
  const [manageTags, setManageTags] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [autoFilledFrom, setAutoFilledFrom] = useState<Song | null>(null);
  const [referenceNow] = useState(() => Date.now());
  const titleRef = useRef<HTMLInputElement>(null);

  const [local,setLocal] = useState<LocalState | null>(null);
  const [visibleCount,setVisibleCount] = useState(50);
  const [persistent,setPersistent]=useState('確認中');
  const [pending,setPending]=useState<ReturnType<typeof parseBackup>|null>(null);
  const [pendingRevision,setPendingRevision]=useState(0);
  const [message,setMessage]=useState('');
  function adopt(state:LocalState) {setLocal(state);setSongs(sorted(state.songs));setTags(state.tags);setMachines(state.machines)}
  async function requestPersistence(){try {setPersistent(!navigator.storage?.persist?'このブラウザは申請に非対応':await navigator.storage.persist()?'保護が許可されています':'未許可（バックアップを保存してください）')}catch{setPersistent('確認できませんでした')}}
  useEffect(()=>{let active=true;(async()=>{try{const state=await readLocal()??await initializeLocal();if(active){adopt(state);setForm({...emptyForm(),machine:state.lastMachine});}await requestPersistence();}catch(e){if(active)setError(e instanceof Error?e.message:'端末保存を開始できませんでした')}finally{if(active)setLoading(false)}})();return()=>{active=false}},[]);
  const level=local?milestone(local):0;
  const showReminder=!!local&&level>0&&(local.readMilestone<level||local.jsonMilestone<level);
  const songIndex=useMemo(()=>buildSongIndex(songs),[songs]);
  const suggestions=useMemo(()=>editingId==null&&autoFilledFrom==null?suggest(songIndex,form.title):[],[songIndex,form.title,editingId,autoFilledFrom]);
  const commit=useCallback(async(records:Records,lastMachine?:string)=>{
    if(!local)throw new Error('初期読込が完了していません');
    const saved=await saveRecords(records,local.revision,lastMachine);adopt(saved);
  },[local]);
  const records=():Records=>({songs,tags,machines});
  const sizeKB=useMemo(()=>(new Blob([JSON.stringify(songs)]).size/1024).toFixed(1),[songs]);

  const filtered = useMemo(() => { const q=query.trim().toLowerCase(); return q ? songs.filter(song => `${song.title} ${song.artist} ${song.releaseYear ?? ""} ${song.tags.map(tag=>tag.name).join(" ")} ${song.memo}`.toLowerCase().includes(q)) : songs; }, [songs,query]);
  const todayCount = useMemo(() => { const today=japanDay(new Date(referenceNow)); return songs.filter(song => japanDay(toDate(song.sungAt)) === today).length; }, [songs,referenceNow]);
  const recentCounts = useMemo(() => {
    const cutoff=referenceNow-30*24*60*60*1000; const counts=new Map<string,number>();
    songs.forEach(song => { if(toDate(song.sungAt).getTime() >= cutoff) counts.set(songKey(song),(counts.get(songKey(song)) ?? 0)+1); });
    return counts;
  }, [songs,referenceNow]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      if(!local)throw new Error('初期読込が完了していません');
      const number=(v:string)=>v===''?null:Number(v);
      if(!form.title.trim())throw new Error('曲名を入力してください');
      const song:Song={...(editingId==null?{}:songs.find(s=>s.id===editingId)),id:editingId??-(Date.now()*1000+Math.floor(Math.random()*1000)),title:form.title.trim(),artist:form.artist.trim(),releaseYear:number(form.releaseYear),
        sungAt:form.sungAt?new Date(`${form.sungAt}:00+09:00`).toISOString():new Date().toISOString(),key:number(form.key),score:number(form.score),machine:form.machine,posture:form.posture,
        familiarity:form.familiarity,tempo:form.tempo||null,throatLoad:form.throatLoad,memo:form.memo.trim(),
        createdAt:editingId==null?new Date().toISOString():songs.find(song=>song.id===editingId)!.createdAt,
        tags:form.tagIds.map(id=>tags.find(t=>t.id===id)??songs.find(s=>s.id===editingId)?.tags.find(t=>t.id===id)).filter((t):t is Tag=>Boolean(t)).map(t=>({...t}))};
      await commit({...records(),songs:editingId==null?[song,...songs]:songs.map(s=>s.id===editingId?song:s)},editingId==null?form.machine:undefined);
      setForm({...emptyForm(),machine:editingId==null?form.machine:local.lastMachine}); setEditingId(null); setAutoFilledFrom(null); requestAnimationFrame(() => titleRef.current?.focus());
    } catch(e) { setError(e instanceof Error ? e.message:"保存できませんでした"); } finally { setSaving(false); }
  }

  function edit(song: Song) {
    setAutoFilledFrom(null); setSuggestionsOpen(false);
    setEditingId(song.id); setForm({title:song.title,artist:song.artist,releaseYear:song.releaseYear == null ? "":String(song.releaseYear),sungAt:toLocalInput(song.sungAt),key:song.key == null ? "":String(song.key),score:song.score == null ? "":String(song.score),machine:song.machine,posture:song.posture??"",familiarity:song.familiarity,tempo:song.tempo ?? "",throatLoad:song.throatLoad,tagIds:song.tags.map(tag=>tag.id),memo:song.memo});
    window.scrollTo({top:0,behavior:"smooth"}); requestAnimationFrame(() => titleRef.current?.focus());
  }
  const cancelEdit=useCallback(()=>{ setEditingId(null); setForm({...emptyForm(),machine:local?.lastMachine??""}); setAutoFilledFrom(null); requestAnimationFrame(() => titleRef.current?.focus()); },[local?.lastMachine]);

  function applyPreviousSong(song:Song) {
    setForm(current=>({...current,title:song.title,artist:song.artist,releaseYear:song.releaseYear == null ? "":String(song.releaseYear),key:song.key == null ? "":String(song.key),score:"",familiarity:song.familiarity,tempo:song.tempo ?? "",throatLoad:song.throatLoad,tagIds:song.tags.map(tag=>tag.id)}));
    setAutoFilledFrom(song); setSuggestionsOpen(false); setError("");
  }

  function download(text:string,filename:string,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)}
  async function copy(text:string,id:string){try{await navigator.clipboard.writeText(text);setCopied(id);setTimeout(()=>setCopied(null),1800);return true}catch{setError('コピーできませんでした。権限を確認してください');return false}}
  async function copyAll(all=false){if(!local)return;setExporting(true);try{if(await copy(markdown(all?songs:filtered).text,'all')){if(all||filtered.length===songs.length)adopt(await markExport('read',local.revision))}}catch(e){setError(String(e))}finally{setExporting(false)}}
  async function downloadMarkdown(all=false){if(!local)return;try{const out=markdown(all?songs:filtered);download(out.text,out.filename,'text/markdown;charset=utf-8');if(all||filtered.length===songs.length)adopt(await markExport('read',local.revision))}catch(e){setError(String(e))}}
  async function downloadBackup(){if(!local)return;try{download(backupText(local),`カラオケバックアップ_${new Date().toISOString().replace(/[:.]/g,'-')}.json`);adopt(await markExport('json',local.revision))}catch(e){setError(String(e))}}
  async function inspectFile(file?:File){if(!file||!local)return;setError('');setPending(null);try{if(file.size>50*1024*1024)throw Error('ファイルが50MBを超えています');const data=parseBackup(await file.text());setPending(data);setPendingRevision(local.revision)}catch(e){setError(e instanceof Error?e.message:'読み込めませんでした')}}
  async function restore(){if(!pending||!local)return;if(!confirm(`${pending.records.songs.length}件に復元します。現在の${songs.length}件は置き換わります。よろしいですか？`))return;setSaving(true);try{if(songs.length)download(backupText(local),'カラオケ復元前バックアップ.json');const state=await restoreRecords(pending,pendingRevision);const saved=await readLocal();if(!saved||(['songs','tags','machines'] as const).some(k=>JSON.stringify(saved[k])!==JSON.stringify(pending.records[k])))throw Error('復元後の照合に失敗しました。復元前のバックアップを保持しています');adopt(state);setForm({...emptyForm(),machine:state.lastMachine});setEditingId(null);setAutoFilledFrom(null);setPending(null);setMessage(`${state.songs.length}件・タグ${state.tags.length}件・採点機${state.machines.length}件の全項目を照合して復元しました。`)}catch(e){setError(String(e))}finally{setSaving(false)}}
  async function downloadRecovery(){try{const old=await recoveryBackup();if(!old)throw Error('復元前の記録はまだありません');download(backupText(old),'カラオケ復元前バックアップ.json')}catch(e){setError(String(e))}}
  const remove=useCallback(async(id:number)=>{
    if(!confirm('この記録を削除する？'))return;
    try{await commit({tags,machines,songs:songs.filter(song=>song.id!==id)});if(editingId===id)cancelEdit();}catch(e){setError(e instanceof Error?e.message:'削除できませんでした');}
  },[commit,songs,tags,machines,editingId,cancelEdit]);
  async function addMachine() {
    const name=newMachine.trim();if(!name)return;
    try{
      if(name.length>40||machines.some(m=>m.name===name))throw new Error('採点機は40文字以内・重複しない名前で入力してください');
      const machine={id:-(Date.now()*1000+Math.floor(Math.random()*1000)),name};
      await commit({...records(),machines:[...machines,machine].sort((a,b)=>a.name.localeCompare(b.name,'ja'))});setForm(current=>({...current,machine:name}));setNewMachine('');
    }catch(e){setError(e instanceof Error?e.message:'採点機を保存できませんでした');}
  }
  async function deleteMachine(machine:Machine) {
    if(!confirm(`採点機「${machine.name}」を選択肢から削除する？\n過去の歌唱記録は変わりません。`))return;
    try{await commit({...records(),machines:machines.filter(m=>m.id!==machine.id)});if(form.machine===machine.name)setForm(current=>({...current,machine:''}));}catch(e){setError(e instanceof Error?e.message:'削除できませんでした');}
  }
  async function addTag() {
    const name=newTag.trim();if(!name)return;
    try{
      if(name.length>30||tags.some(t=>t.name===name))throw new Error('タグは30文字以内・重複しない名前で入力してください');
      const tag={id:-(Date.now()*1000+Math.floor(Math.random()*1000)),name};
      await commit({...records(),tags:[...tags,tag].sort((a,b)=>a.name.localeCompare(b.name,'ja'))});setForm(current=>({...current,tagIds:[...current.tagIds,tag.id]}));setNewTag('');
    }catch(e){setError(e instanceof Error?e.message:'タグを保存できませんでした');}
  }
  async function deleteTag(tag:Tag) {
    if(!confirm(`タグ「${tag.name}」を選択肢から削除する？\n過去の記録に付けたタグは残ります。`))return;
    try{await commit({...records(),tags:tags.filter(t=>t.id!==tag.id)});setForm(current=>({...current,tagIds:current.tagIds.filter(id=>id!==tag.id)}));}catch(e){setError(e instanceof Error?e.message:'削除できませんでした');}
  }
  function toggleTag(id:number) { setForm(current=>({...current,tagIds:current.tagIds.includes(id) ? current.tagIds.filter(tagId=>tagId!==id):[...current.tagIds,id]})); }

  const historyView=useMemo(()=>(loading ? <p className="status">読み込み中…</p>:filtered.length===0 ? <p className="status">{query ? "該当する記録がありません":"まだ記録がありません"}</p>:<div className="songList">{filtered.slice(0,visibleCount).map(song=><article className="songRow" key={song.id}>
        <div className="songIdentity"><strong>{song.title}</strong><span>{song.artist || "歌手名なし"}</span><small>{displayDateTime(song.sungAt)} ・ 直近30日 {recentCounts.get(songKey(song)) ?? 0}回</small></div>
        <div className="songMeta">{song.posture && <span>姿勢：{song.posture}</span>}{song.tags.map(tag=><span className="songTag" key={tag.id}>#{tag.name}</span>)}{song.releaseYear != null && <span>{song.releaseYear}年リリース</span>}{song.key != null && <span>{keyLabel(song.key)}</span>}{song.score != null && <span>{song.score.toFixed(3)}{song.machine ? ` ${song.machine}`:""}</span>}{song.familiarity != null && <span>熟練 {stars(song.familiarity)}</span>}{song.tempo && <span>{song.tempo}</span>}{song.throatLoad != null && <span>喉 {song.throatLoad}/5</span>}{song.memo && <span className="songComment" title={song.memo}>コメント：{song.memo}</span>}{song.tags.length===0 && song.releaseYear == null && song.key == null && song.score == null && song.familiarity == null && !song.tempo && song.throatLoad == null && !song.memo && !song.posture && <span>詳細記入なし</span>}</div>
        <div className="rowActions"><button type="button" onClick={()=>copy(outputText(song),String(song.id))}>{copied===String(song.id) ? "コピー済み":"出力"}</button><button type="button" onClick={()=>edit(song)}>編集</button><button type="button" className="danger" onClick={()=>remove(song.id)}>削除</button></div>
      </article>)}</div>),[loading,filtered,query,visibleCount,recentCounts,copied,remove]);

  return <main className="appShell">
    <header><h1>うたログ</h1><div className="headerStats"><strong>今日 {todayCount}曲</strong><span>全{songs.length}曲</span></div></header>
    {error&&<p className="error" role="alert">{error}</p>}
    {message&&<p className="notice" role="status">{message}</p>}
    {showReminder&&<aside className="backupNotice" role="status"><strong>バックアップを取ってください（{level}件の節目）</strong><div>閲覧用出力：{local!.readMilestone>=level?'完了 ✓':'未完了'} ／ JSONバックアップ：{local!.jsonMilestone>=level?'完了 ✓':'未完了'}</div><div className="backupActions"><button className="outlineButton" onClick={()=>copyAll(true)}>全件コピー</button><button className="outlineButton" onClick={()=>downloadMarkdown(true)}>全件Markdown保存</button><button className="outlineButton" onClick={downloadBackup}>JSONバックアップ保存</button></div><small>コピーかMarkdownのどちらかと、JSON保存の両方で通知が消えます。</small></aside>}
    <section className={`entryPanel ${editingId == null ? "":"editing"}`} aria-labelledby="entry-title">
      <div className="panelTitle"><h2 id="entry-title">{editingId == null ? "歌った曲を記録":"記録を編集"}</h2>{editingId != null && <button type="button" className="textButton" onClick={cancelEdit}>編集をやめる</button>}</div>
      <form onSubmit={submit}><fieldset disabled={loading || !local || saving} className="entryFields">
        <div className="topFields">
          <div className="titleField titleLookup"><label>曲名<input ref={titleRef} autoFocus required autoComplete="off" value={form.title} onFocus={()=>{if(suggestions.length)setSuggestionsOpen(true);}} onBlur={()=>window.setTimeout(()=>setSuggestionsOpen(false),120)} onChange={e=>{const title=e.target.value;setAutoFilledFrom(null);setSuggestionsOpen(Boolean(title.trim()));setForm({...form,title});}} placeholder="曲名を入力" /></label>
            {editingId == null && suggestionsOpen && <div className="songSuggestions" role="listbox" aria-label="過去の曲候補">{suggestions.length ? <>{suggestions.map(song=><button type="button" role="option" aria-selected="false" key={song.id} onClick={()=>applyPreviousSong(song)}><strong>{song.title}</strong><span>{song.artist || "歌手名なし"} ・ 前回 {displayDateTime(song.sungAt)}</span></button>)}</>:<p>過去の候補はありません</p>}</div>}
          </div>
          <label>歌手名<input value={form.artist} onChange={e=>setForm({...form,artist:e.target.value})} placeholder="歌手名" /></label>
          <label className="releaseYearField">リリース年<input inputMode="numeric" type="number" min="1000" max="9999" step="1" value={form.releaseYear} onChange={e=>setForm({...form,releaseYear:e.target.value})} placeholder="例 2018" /></label>
          <label className="keyField">キー<select value={form.key} onChange={e=>setForm({...form,key:e.target.value})}><option value="">未選択</option>{Array.from({length:13},(_,i)=>i-6).map(key=><option key={key} value={key}>{keyLabel(key)}</option>)}</select></label>
          <label className="machineField">採点機<select value={form.machine} title={form.machine || "未選択"} onChange={e=>setForm({...form,machine:e.target.value})}><option value="">未選択</option>{machines.map(machine=><option key={machine.id} value={machine.name}>{machine.name}</option>)}</select>{form.machine && <span className="selectedMachineName">選択中：{form.machine}</span>}</label>
          <label className="scoreField">採点点数<input inputMode="decimal" type="number" min="0" max="100" step="0.001" value={form.score} onChange={e=>setForm({...form,score:e.target.value})} placeholder="例 92.345" /></label>
        </div>
        {autoFilledFrom && editingId == null && <p className="autoFillNotice">前回の記録から自動入力しました。採点機は現在の選択を維持し、点数は空欄です。姿勢は自動入力しません。各項目は自由に変更できます。</p>}
        <button type="button" className="manageButton" onClick={()=>setManageMachines(value=>!value)}>{manageMachines ? "採点機の管理を閉じる":"＋ 採点機の種類を管理"}</button>
        {manageMachines && <div className="machineManager"><div className="machineAdd"><input value={newMachine} onChange={e=>setNewMachine(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addMachine();}}} placeholder="例：精密採点Ai" aria-label="追加する採点機名" /><button type="button" onClick={addMachine}>追加</button></div><div>{machines.map(machine=><span key={machine.id}>{machine.name}<button type="button" onClick={()=>deleteMachine(machine)} aria-label={`${machine.name}を削除`}>×</button></span>)}</div></div>}
        <div className="quickFields">
          <Rating label="熟練度" value={form.familiarity} onChange={value=>setForm({...form,familiarity:value})} />
          <fieldset className="tempoField"><legend>テンポ</legend><div className="segmented">{["ハイ","ミドル","バラード"].map(tempo=><button key={tempo} type="button" className={form.tempo===tempo ? "active":""} onClick={()=>setForm({...form,tempo:form.tempo===tempo ? "":tempo})}>{tempo}</button>)}</div></fieldset>
          <Rating label="喉への負担" value={form.throatLoad} onChange={value=>setForm({...form,throatLoad:value})} />
        </div>
        <fieldset className="postureField"><legend>歌唱姿勢（任意）</legend><div className="segmented">{(["","立位","座位","混合"] as const).map(posture=><button type="button" key={posture} aria-pressed={form.posture===posture} className={form.posture===posture?"active":""} onClick={()=>setForm({...form,posture})}>{posture||"未選択"}</button>)}</div></fieldset>
        <fieldset className="tagField"><legend>タグ <span>複数選択可</span></legend><div className="tagChoices">{tags.length ? tags.map(tag=><button key={tag.id} type="button" className={form.tagIds.includes(tag.id) ? "active":""} onClick={()=>toggleTag(tag.id)}>#{tag.name}</button>):<small>タグはまだありません</small>}</div></fieldset>
        <button type="button" className="manageButton" onClick={()=>setManageTags(value=>!value)}>{manageTags ? "タグの管理を閉じる":"＋ タグを作成・削除"}</button>
        {manageTags && <div className="tagManager"><div className="tagAdd"><input value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addTag();}}} placeholder="例：夏、アニソン" aria-label="追加するタグ名" /><button type="button" onClick={addTag}>追加</button></div><div>{tags.map(tag=><span key={tag.id}>#{tag.name}<button type="button" onClick={()=>deleteTag(tag)} aria-label={`${tag.name}を削除`}>×</button></span>)}</div></div>}
        <label className="memoField">コメント <span>前回の記録からは自動入力されません</span><textarea rows={3} maxLength={2000} value={form.memo} onChange={e=>setForm({...form,memo:e.target.value})} placeholder="歌った感想や次回のメモなど（空欄でもOK）" /></label>
        <label className="dateField">歌った日時 <span>空欄なら保存時の日時を自動記録</span><input type="datetime-local" value={form.sungAt} onChange={e=>setForm({...form,sungAt:e.target.value})} /></label>
        <button className="saveButton" disabled={saving || loading || !local}>{saving ? "保存中…":editingId == null ? "記録する":"変更を保存"}</button>
      </fieldset></form>
    </section>
    <section className="records" aria-labelledby="records-title">
      <div className="recordsHead"><h2 id="records-title">記録一覧</h2><div className="recordTools"><label className="search"><span>⌕</span><input value={query} onChange={e=>{setQuery(e.target.value);setVisibleCount(50);}} placeholder="曲名・歌手名・タグ・コメント" /></label><button type="button" className="outlineButton" disabled={!local || exporting} onClick={()=>copyAll()}>{copied==="all" ? "コピー済み":query.trim() ? "検索結果をコピー":"全件コピー"}</button><button type="button" className="outlineButton" disabled={!local} onClick={()=>downloadMarkdown()}>Markdown保存</button></div></div>
      {historyView}
    </section>
    {filtered.length>visibleCount && <button type="button" className="outlineButton" onClick={()=>setVisibleCount(n=>n+50)}>さらに50件表示（表示中 {Math.min(visibleCount,filtered.length)} / {filtered.length}件）</button>}
    <details className="dataManager"><summary>設定・データ管理</summary>
      <p>端末の記録：{songs.length}件</p>
      <p>記録データの概算：{sizeKB} KB（JSONのUTF-8サイズ。IndexedDB全体の占有量ではありません）</p>
      <p>最終端末保存：{local?.lastSavedAt ? toLocalInput(local.lastSavedAt).replace('T',' ')+' JST':'未保存'}</p>
      <p>永続ストレージ：{persistent} <button className="outlineButton" onClick={requestPersistence}>保護を申請</button></p>
      <p>記録はこの端末に保存されます。JSONは再読み込み用、Markdown・コピーは閲覧用です。ダウンロード先にファイルがあることを確認してください。</p>
      <div className="backupActions"><button className="outlineButton" disabled={!local} onClick={downloadBackup}>JSONバックアップ保存</button><button className="outlineButton" onClick={downloadRecovery}>復元前のデータを出力</button></div>
      <label>JSONから復元・Sitesの記録を取り込み<input type="file" accept=".json,application/json" disabled={!local||saving} onChange={e=>{inspectFile(e.target.files?.[0]);e.target.value=''}} /></label>
      {pending&&<div className="restorePanel"><strong>取り込み内容：歌唱記録 {pending.records.songs.length}件</strong><p>タグ {pending.records.tags.length}件 ／ 採点機 {pending.records.machines.length}件</p><p>現在の{songs.length}件を、このファイルの内容で置き換えます。同じファイルを再度取り込んでも重複しません。</p><div className="backupActions"><button className="outlineButton" disabled={saving} onClick={restore}>この内容で復元</button><button className="outlineButton" onClick={()=>setPending(null)}>キャンセル</button></div></div>}
      <p>最終取り込み：{local?.lastImportAt?toLocalInput(local.lastImportAt).replace('T',' ')+' JST':'未実施'}</p>
    </details>
    <footer className="creatorMark" aria-label="YUUが作成"><span>YUU</span><small>MADE THIS</small></footer>
  </main>;
}
