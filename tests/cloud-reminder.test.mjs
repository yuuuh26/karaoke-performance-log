import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['lib/cloud-reminder.ts'],bundle:true,format:'esm',platform:'node',outfile:'.test-auth/cloud-reminder.js'});
const {cloudBackupDue,untilTokyoMidnight}=await import('../.test-auth/cloud-reminder.js');
test('日本時間の送信当日は下段、翌日の0時から上段に戻り、未送信・不正日時は通知を出す',()=>{
  const sent='2026-10-02T15:00:00.000Z'; // Oct 3, 00:00 JST
  assert.equal(cloudBackupDue(sent,Date.parse('2026-10-02T23:00:00Z')),false);
  assert.equal(cloudBackupDue(sent,Date.parse('2026-10-03T14:59:59.999Z')),false);
  assert.equal(cloudBackupDue(sent,Date.parse('2026-10-03T15:00:00Z')),true);
  assert.equal(cloudBackupDue(undefined,Date.parse(sent)),true);
  assert.equal(cloudBackupDue('broken',Date.parse(sent)),true);
  assert.equal(untilTokyoMidnight(Date.parse('2026-10-03T14:59:59Z')),1025);
  assert.equal(untilTokyoMidnight(Date.parse('2026-10-03T15:00:00Z')),86400025);
});
