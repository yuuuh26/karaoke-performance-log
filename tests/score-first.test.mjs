import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';

// Check the actual song suggestion handler without mounting React or touching a user's data.
const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const match = source.match(/  function applyPreviousSong\(song:Song\) \{[\s\S]*?\n  \}/);
assert.ok(match, '過去曲候補の反映処理が存在する');
const { code } = await transform(match[0] + '\napplyPreviousSong;', { loader: 'ts' });

const previous = {
  title: '前に歌った曲', artist: '歌手名', releaseYear: 2020, key: 0,
  score: 99.999, machine: '過去の採点機', familiarity: 4, tempo: 'ミドル',
  throatLoad: 2, tags: [{ id: 10 }, { id: 11 }],
};
function completeSuggestion(initial) {
  let result;
  const context = {
    setForm: update => { result = update(initial); },
    setAutoFilledFrom: () => {},
    setSuggestionsOpen: () => {},
    setError: () => {},
  };
  runInNewContext(code, context)(previous);
  return result;
}

test('点数を先に入力してから過去曲を選んでも、その点数を維持する', () => {
  const next = completeSuggestion({ title: '', score: '92.345', machine: '現在の採点機', posture: '座位', memo: '今の感想', sungAt: '' });
  assert.equal(next.score, '92.345');
  assert.equal(next.title, previous.title);
  assert.equal(next.artist, previous.artist);
  assert.equal(next.machine, '現在の採点機');
  assert.equal(next.posture, '座位');
  assert.equal(next.memo, '今の感想');
  assert.equal(next.sungAt, '');
});

test('0点も保持し、点数を入力していなければ過去の点数をコピーしない', () => {
  assert.equal(completeSuggestion({ score: '0' }).score, '0');
  assert.equal(completeSuggestion({ score: '' }).score, '');
});

test('過去の点数を空欄へ強制変更する説明が残っていない', () => {
  assert.ok(!source.includes('点数は空欄です'));
  assert.ok(source.includes('入力済みの点数も保持します'));
});
