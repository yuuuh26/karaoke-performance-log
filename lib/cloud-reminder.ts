const DAY=24*60*60*1000,TOKYO=9*60*60*1000;
export function tokyoDay(time:number){return Math.floor((time+TOKYO)/DAY)}
export function cloudBackupDue(sentAt:string|undefined,now=Date.now()){
  const sent=sentAt?Date.parse(sentAt):NaN;
  return !Number.isFinite(sent)||tokyoDay(sent)!==tokyoDay(now);
}
export function untilTokyoMidnight(now=Date.now()){return (tokyoDay(now)+1)*DAY-TOKYO-now+25}
