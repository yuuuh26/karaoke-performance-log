export type Tag = { id: number; name: string };
export type Machine = Tag;
export type Song = {
  posture?: '' | '立位' | '座位' | '混合'; id: number; title: string; artist: string; sungAt: string; key: number | null;
  score: number | null; machine: string; familiarity: number | null; tempo: string | null;
  throatLoad: number | null; releaseYear: number | null; memo: string; createdAt: string; tags: Tag[];
};
export type Records = { songs: Song[]; tags: Tag[]; machines: Machine[] };
export const normalize = (s: string) => s.normalize('NFKC').trim().toLowerCase();
export const songTime = (s: string) => new Date(s.length === 10 ? `${s}T12:00:00+09:00` : s).getTime();
export const sorted = (songs: Song[]) => [...songs].sort((a,b) => songTime(b.sungAt)-songTime(a.sungAt) || b.id-a.id);
export const japanDay = (date = new Date()) => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function validateRecords(input: unknown): asserts input is Records {
  const v = input as Records;
  if (!v || !Array.isArray(v.songs) || !Array.isArray(v.tags) || !Array.isArray(v.machines)) throw new Error('記録データの形式を確認できませんでした');
  for (const rows of [v.songs,v.tags,v.machines]) {
    const ids = new Set<number>();
    for(const r of rows) { if (!r || !Number.isSafeInteger(r.id) || ids.has(r.id)) throw new Error('記録IDが不正または重複しています'); ids.add(r.id); }
  }
  for(const t of [...v.tags,...v.machines]) if(typeof t.name !== 'string') throw new Error('選択肢の形式が不正です');
  for(const s of v.songs) {
    for(const k of ['title','artist','sungAt','machine','memo','createdAt'] as const) if(typeof s[k] !== 'string') throw new Error('記録項目が不足しています');
    if(!s.title.trim() || !Number.isFinite(songTime(s.sungAt)) || !Array.isArray(s.tags) || s.tags.some(t=>!Number.isSafeInteger(t.id)||typeof t.name!=='string')) throw new Error('記録の日時またはタグが不正です');
    for(const k of ['key','score','familiarity','throatLoad','releaseYear'] as const) if(s[k] !== null && !Number.isFinite(s[k])) throw new Error('記録の数値が不正です');
    if(s.posture !== undefined && !['','立位','座位','混合'].includes(s.posture)) throw new Error('歌唱姿勢が不正です');
    for(const k of ['familiarity','throatLoad'] as const) if(s[k] !== null && (!Number.isInteger(s[k]) || s[k]!<1 || s[k]!>5)) throw new Error('評価は1〜5で指定してください');
    if(s.score !== null && (s.score<0 || s.score>100)) throw new Error('点数が不正です');
    if(s.tempo !== null && typeof s.tempo !== 'string') throw new Error('テンポの形式が不正です');
  }
}
// Build once per committed record change, never per keystroke. Latest per title + artist.
export function buildSongIndex(songs: Song[]) {
  const seen = new Set<string>();
  return sorted(songs).flatMap(song => {
    const title=normalize(song.title), key=title+'\0'+normalize(song.artist);
    if(seen.has(key))return []; seen.add(key);return [{title,song}];
  });
}
export function suggest(index: ReturnType<typeof buildSongIndex>, query: string) {
  const q=normalize(query); if(!q)return [];
  const found: Song[]=[];
  for(const entry of index) { if(entry.title.includes(q))found.push(entry.song); if(found.length===8)break; }
  return found;
}
const stamp = (s: string) => s.length===10 ? `${s}（時刻未記録）` : new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(s))+' JST';
const literal = (v: unknown) => v === null || v === undefined ? '未記録' : v === '' ? '空欄' : String(v).replace(/[\\`*_{}\[\]<>#|]/g,'\\$&').replace(/\r?\n/g,'\n    ');
export function markdown(songs: Song[], now=new Date()) {
  const rows=sorted(songs), days=rows.map(s=>japanDay(new Date(songTime(s.sungAt)))).sort();
  const range=rows.length ? `${days[0]} 〜 ${days.at(-1)}` : '記録なし';
  const filename=rows.length ? `カラオケ記録_${days[0].replaceAll('-','')}-${days.at(-1)!.replaceAll('-','')}.md` : 'カラオケ記録_記録なし.md';
  const fields: [string,keyof Song][]=[['記録ID','id'],['曲名','title'],['歌手名','artist'],['リリース年','releaseYear'],['キー','key'],['採点','score'],['採点機','machine'],['歌唱姿勢','posture'],['熟練度（1〜5）','familiarity'],['テンポ','tempo'],['喉の負担（1〜5）','throatLoad'],['コメント','memo']];
  const text=[`# カラオケ記録`,`対象期間：${range}`,`出力日時：${stamp(now.toISOString())}`,`記録件数：${rows.length}件`,'日時は日本時間。キーは0が原キー、正数が上げ、負数が下げ。空文字は「空欄」、nullは「未記録」。',...rows.map((s,i)=>`## 記録 ${i+1}\n\n- 歌唱日時：${stamp(s.sungAt)}\n- 作成日時（保存値）：${literal(s.createdAt)}\n${fields.map(([name,key])=>`- ${name}：${literal(s[key])}`).join('\n')}\n- タグ：${s.tags.length?s.tags.map(t=>`${literal(t.name)}（ID: ${t.id}）`).join('、'):'なし'}`)].join('\n\n')+'\n';
  return {text,filename};
}
