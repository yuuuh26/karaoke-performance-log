# 外部スナップショットバックアップ

このディレクトリーは専用の新規Worker・D1向けです。既存Worker・D1に適用しないでください。
まだ実資源のIDやURLは設定されていません。配備後に確認した値を記録します。

## 配備

1. OAuthを対象の1アカウントに制限し、D1 Write・Workers Scripts Write・Workers Scripts Bindだけを認可します。必須Background Access・User Readを含め5権限です。
2. 同名の資源がないことを読み取りで確認し、専用D1を新規作成します。初期化・削除は行いません。
3. 新規D1に `migrations/0001_backups.sql` を1回適用します。
4. 暗号学的乱数32バイト以上からbase64urlのアプリ専用復旧キーを生成します。管理API Tokenとは別です。平文キーはGitHubやチャットに入れず、利用者の安全な復旧情報に保存します。
5. 復旧キーのSHA-256をWorker Secret `BACKUP_TOKEN_SHA256` に保存します。D1を `DB` bindingとして接続します。
6. `node cloudflare/build.mjs` で作成したモジュールを新規Workerへ配備し、workers.devのHTTPS URLを確認します。カスタムドメイン・DNS・Routesは不要です。
7. 認証なし・誤ったキー・他オリジンを拒否することを実環境でも確認し、架空のデータで保存・履歴・読み戻しを試します。実記録はアプリのバックアップ操作からだけ送ります。

Worker APIは `PUT /v1/backups/:backup_id`、`GET /v1/backups`、`GET /v1/backups/:backup_id` です。Authorization Bearerのアプリ復旧キーが必要で、CORSは `https://yuuuh26.github.io` だけを許可します。すべての返答をno-storeとし、削除・更新APIを設けません。

## 保存と復元

- 既存IndexedDBの名前・バージョン・保存場所は変えません。state/currentとrecovery/before-import、保存済みの公開クラウド設定を1つのreadonly transactionで読み出します。秘密キーはメモリーにだけ保持します。
- backup_id、app_id、schema_version、created_at、device_id、record_count、source_revision、sha256、byte_lengthを保存します。record_countは曲数です。タグ・採点機・設定・元の追加項目・退避データもJSONに含みます。
- D1の行サイズ制限に備え、backup_jsonをbackup_chunksに順序付きで保存します。メタデータと全チャンクを1回のD1 batchで原子的に追加します。読み戻しで全JSONのSHA-256・サイズ・件数を照合します。
- JSON本体は8MBまでです。17MBまでのリクエストを受け付けます。履歴は削除せず、50件ずつ過去へ一覧表示します。容量不足は保存失敗として伝え、端末を変更しません。
- 復元はユーザーが内容を確認したときだけ行います。現在の全データを別のクラウド履歴へ退避し、読み戻しを照合できるまで置き換えません。更新revisionが変われば中止します。置き換えと端末内の直前退避は同じtransactionです。
- 履歴のcloud_settingsは復旧時の参考情報です。復元で接続先や端末IDを自動的に変更しません。復旧キーが別のサーバーへ送信されるのを避けます。
- 曲・タグ・採点機の追加・編集・削除を件数として数えます。UI選択・検索・出力・曲の並び替えは数えません。15件で通知します。バックアップ中の追加編集は未バックアップとして残します。

既存の端末JSON機能は継続できます。新しい全データJSONはクラウドバックアップ画面で扱います。ブラウザが消えた場合は、アプリを開き、保管したWorker URLと復旧キーを入力して接続し、履歴の日時・件数を確認して復元してください。

## 検証

`npm test` は架空のIndexedDBとインメモリーSQLiteで検証します。実ユーザーデータや実D1にアクセスしません。`npm run build` の生成物もコミットし、PRのGitHub Actionsでテストとビルド一致を確認します。
