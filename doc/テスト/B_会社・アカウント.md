# テストパターン B. 会社・アカウント（account_sync_outbox＝管理DB→会社DB ミラー）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../データモデル.md`](../データモデル.md) §4.6（`account_sync_outbox`）・[`../API設計/README.md`](../API設計/README.md) §1.13・[`../API設計/B_会社・アカウント・所属.md`](../API設計/B_会社・アカウント・所属.md) B.5。
> 本スライスの対象＝**outbox 機構の縦通し**（テーブル＋書込側の同一Tx INSERT＋常駐ワーカの冪等適用）。現状の**唯一の書込側は A.7 `complete_password_setup`**（`accounts.password_set=true` を会社DB `users` へミラー）。発行/編集/無効化（B.2）・`last_login_at`・プロフィール編集（K）の writer は該当エンドポイント実装時に追加する。
> ワーカ本体＝`app/control_plane/account_sync/application.py` の `process_outbox_once()`（worker.py がループで呼ぶ）。テストは本関数を直接呼ぶ（常駐プロセス不要）。

## 前提（共通フィクスチャ）

- §1「前提」は [`A_認証.md`](A_認証.md) と共通（seed 会社 ACME-01/02・factory）。
- 実 DB を持つ会社＝`factory.make_seed_company_account()`（ACME-01・会社DB あり）。**DB を持たない会社**＝`factory.make_company()`＋`make_account()`（`db_identifier` は実在しない＝ワーカの会社DB 接続が失敗する＝失敗系の検証に使う）。
- outbox 行は seq（挿入順の単調増加）昇順で取り出す。`op=upsert`・`payload={"password_set": true}`。

## 1. テストパターン一覧

| TC-ID | 階層 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| B-TC-001 | int | ACME-01 実アカウント＋有効 `password_setup` トークン | `POST /auth/password-setup/complete`（新PW）成功 | **accounts 更新と同一 Tx** で `account_sync_outbox` に **pending 1行**（`op=upsert`・`payload.password_set=true`・`company_id` 正） | データモデル §4.6／ADR-0002 §2.4 |
| B-TC-002 | int | B-TC-001 で pending 1行がある状態 | `process_outbox_once()` | 会社DB `users.password_set` が **true に upsert**され、行 `status=done`・`processed_at` 打刻 | §4.6（適用・消し込み） |
| B-TC-003 | int | 同一 account に upsert pending が **2行** | `process_outbox_once()` | 2行とも done、`users` は**1行のまま**（`account_id` キー upsert＝冪等・at-least-once 前提） | §4.6（冪等） |
| B-TC-004 | int | 会社DB が存在しない会社の pending 1行・`OUTBOX_MAX_ATTEMPTS=2` | `process_outbox_once()` を 2回 | 1回目 `attempts=1・status=pending`、2回目で **`status=failed`**（上限超＝要手動対応） | §4.6（リトライ/failed） |
| B-TC-005 | int | 会社DB 無し会社の account X に pending 2行（X1,X2）＋ ACME-01 の account Y に pending 1行（Y1） | `process_outbox_once()` | Y1 は **done**（別 account は独立に進む）／X1 は `attempts=1・pending`／**X2 は未処理（`attempts=0・pending`）**＝同一 account はヘッドオブライン・ブロッキング | §4.6（順序・HOL） |

## 2. 補足・非対象

- **発行/編集/無効化（B.2・B.5）・`last_login_at`・プロフィール編集（K）の writer** は該当エンドポイント実装時に追加（本スライスは password_set writer 1 本で機構を縦通し）。
- **初期所属 `memberships` の相乗適用**（B.5＝`users`→`quest_group_members` の順）は B ドメイン実装時（本スライスの payload は `password_set` のみ）。
- **メール送信の非同期化**は別機構（§4.6 outbox は DB ミラー専用）＝別スライス。
- ワーカの常駐ループ（`worker.py`）自体は疎通のみ＝TC 対象外（本体ロジックは `process_outbox_once` の int TC で担保）。
