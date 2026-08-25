# impl — ideaquest 実装

社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」の実装コード。
設計の正本は [`../doc/`](../doc/)（要件・API・画面・データモデル）、開発の引き継ぎは [`../handoff.md`](../handoff.md)。

- **frontend/** — Next.js（App Router・dev モード起動）。`shared.css` を単一デザインシステムに段階移行中。
- **backend/** — FastAPI 4層（router / application / repository / infra）。
- **compose.yaml** — フルスタック（PostgreSQL / Redis / MinIO / MailHog / workers / Docker）。

> 進捗の最終確認: **2026-08-25**。tsc 既知1件のみ（Snackbar.tsx:122）・**backend `pytest tests/` 全体 401 passed**（A-TC-095 等は既存フラキー・単独 green／評価 F ＝23／チャット E ＝22／魔法解放 G ＝6／ショップ/装備 G ＝8／**ランキング G ＝5**）・e2e sc-24（3）＋sc-32（1）＋sc-30（2）＋**sc-41（1＝ランキング実データ G-TC-206）**＋sc-25（3）＋sc-22（10）＋sc-21（6）＋sc-92d（1）passed・TC-ID トレーサビリティ ✅（code 350）。
> 開発方針＝**1画面単位で backend 接続ループ**（各画面でユーザー受入ゲート）。実装順の正本＝[`../doc/実装計画.md`](../doc/実装計画.md)＝アカウント→クエスト(C)→アイデア(D)→評価→その他。

## 画面実装進捗（SC-xx）

凡例: ✅ backend 接続済み ／ 🟡 部分接続（一部が表示のみ/デモ）／ ⬜ モック（画面のみ・backend 未接続）

| 画面 | 名称 | 状態 | ルート | 備考 |
|---|---|---|---|---|
| SC-00 | ログイン | ✅ | `(auth)/login` | 401→`/login?reason=…` セッション終了通知（デザイン標準 §14）。password-reset/-setup・email-change・**email-verify/confirm**（ADR-0009）も配置 |
| SC-01 | ダッシュボード | 🟡 | `(app)/` | ヒーロー残高は `GET /me`（K.1）接続済み。週間ランキング/下書き/未投票/参加中等は G/C/D 接続まで demo |
| SC-02 | 通知一覧 | ⬜ | `(app)/notifications` | モックのみ |
| SC-03 | プロフィール | ✅ | `(app)/profile` | K.1（`/me`）接続済み |
| SC-10 | クエスト一覧 | ✅ | `(app)/quests` | 複製対応済み。💡件数列は `idea_count`（公開アイデア数）に連動 |
| SC-11 | クエスト作成/編集 | ✅ | `(app)/quests/new`・`[questId]/edit` | URL 付きモーダル（Parallel＋Intercept） |
| SC-12 | クエスト詳細 | 🟡 | `(app)/quests/[questId]` | 本体＋**アイデアタブ**接続済み。ヘッダー💡件数は `idea_count`（公開数）に連動。評価列(F)/週間ランキング(G)/全文検索(J) は demo |
| SC-21 | アイデア登録/編集 | ✅ | `(app)/quests/[questId]/ideas/new`（＋モーダル） | §4.7 入力検証（**サーバエラー経由の 3 チャネル e2e D-TC-216**＝完了クエスト編集 409）・登録モーダル初期誤検証 fix 済み・**添付アップロード**（D.3・保存後に送信）・**編集での既存添付の一覧＋削除**（D-TC-218・確認ダイアログ→即時削除・版を生まない） |
| SC-22 | アイデア詳細 | ✅ | `(app)/ideas/[ideaId]` | 本体＋投票/フォロー（D.5/D.6）＋添付（D.3）＋quest 参照（D.1）＋更新履歴（D.4）＋評価結果/選定（F.1/F.3）＋**チャット活発度/プレビュー（E.1・`getChatActivity`/`getChat`）**。全セクション実接続 |
| SC-24 | アイデアチャット | ✅ | `(app)/ideas/[ideaId]/chat` | **実接続**（`getChat`/`postMessage`/`editMessage`/`deleteMessage`/`markRead`/`addReaction`/`removeReaction`/`getSpells`）＝投稿/編集/削除・リアクション/魔法・メンション（実メンバー）・添付（署名DL）・**複数引用**（`chat_message_quotes`・§5.16b）・既読・comment 権限/completed 凍結 |
| SC-25 | 評価画面 | ✅ | `(app)/ideas/[ideaId]/eval` | 5観点採点＋観点別コメント＋総評＋公開範囲＋集計プレビュー（F.2）。`getMyEvaluation` プリフィル・確定/下書き＝`putEvaluation`・422/403/409 はサーバー権威。※設計はモーダル（Intercept）だが現状フルページ（intercept モーダル化は follow-up） |
| SC-30 | ショップ | ✅ | `(app)/shop` | 実接続（`getItems`＝カタログ＋所有＋コイン残高・`purchaseItem`＝コイン消費・残高不足/所有済みはサーバー権威）。購入は確認ダイアログ→報酬スナックバー。アイコンはクライアント presentation |
| SC-31 | アバター着せ替え | ✅ | `(app)/avatar` | 実接続（`getItems`＝所有/装備・`updateEquipment`＝各スロット1点・楽観更新＋サーバー権威）。未所有はショップ導線。3D は VRM 未対応でマスコット代用 |
| SC-32 | 魔法スキル | ✅ | `(app)/spells` | 実接続（`getSpells`＝カタログ＋SP残高＋unlocked/can_unlock・`unlockSpell`＝SP消費・前提/二重解放はサーバー権威）。解放は確認ダイアログ→報酬スナックバー。演出コピーはクライアント（G シードに説明文なし） |
| SC-40 | 実績バッジ | ⬜ | `(app)/achievements` | モックのみ |
| SC-41 | ランキング | ✅ | `(app)/ranking` | 実接続（`getRankings`＝期間×会社スコープ・獲得XP＋獲得コイン集計・me 常時同梱）。期間タブ（今週/先週/今月/通算）で再取得・表彰台/一覧/自分順位 |
| SC-90 | クエストグループ管理 | ✅ | `(app)/admin/quest-groups` | メンバー管理含む |
| SC-91 | システム管理 | ✅ | `(app)/admin/companies` | 会社一覧・手動プロビジョニング |
| SC-92 | 会社詳細 | ✅ | `(app)/admin/companies/[id]` | 会社プロビジョニングは MVP 手動。**メール確認バッジ（未確認/確認済み）＋⋯「確認メールを送信」**（ADR-0009） |
| SC-93 | 会社アカウント管理 | ✅ | `(app)/admin/companies/[id]/accounts`・`admin/accounts` | 複製対応済み。**メール確認バッジ＋送信アクション**（ADR-0009） |

**接続済み画面のフロント feature**＝`auth`・`profile`・`quests`・`ideas`・`evaluations`・`chat`・`spells`・`shop`・`avatar`・`ranking`・`accounts`・`companies`・`questgroups`・`qgadmin`（各 `api.ts` が backend を叩く）。
**モック feature**（`api.ts` 無し）＝`notifications`・`dashboard`(一部)・`achievements`。

## ブラウザ受入状況（バッチ・後日まとめて）

> 上表の ✅/🟡＝**backend 接続＋e2e green** の状態。**ユーザーによるブラウザ受入は別軸**で、後日まとめて実施する（e2e green でクローズ扱い・次画面へ進む・[受入ゲート](../doc/規約/フロントエンド実装フロー規約.md) §1.1）。ここに受入待ちを集約し、受入完了までチェックを残す（受入用デモデータも受入完了まで削除しない）。**dev ログイン**＝`ACME-01`/`user@acme.example`/`Passw0rd!`・**MailHog**＝`http://localhost:8025`。

- [ ] **SC-22 更新履歴 D.4（D-TC-217）**＝デモデータ用意済み＝`http://localhost:3000/ideas/f183174b-b090-4151-972e-832b2f824a9a`（クエスト「【受入】更新履歴デモ」内「夜間配送の集約」）。「版 2（履歴）」→版2/初版・文字差分（価値 1̶0̶→5・本文語句差分・タイムリミット `（なし）→2027-01-31`）の見え方。
- [ ] **SC-21 §4.7 サーバエラー3チャネル（D-TC-216）**＝完了クエストのアイデアを「編集」→件名変更→「変更を保存」で 409→①上部サマリ ②足元ヒント ③持続エラースナックバー（自動消滅しない）。要 seed（完了クエスト＋公開アイデア）。
- [ ] **SC-22 投票/フォロー（D-TC-209〜212）**＝賛成/反対/切替/同ボタン再クリック取消・★フォロートグルの楽観更新＋サーバー権威。
- [ ] **SC-10/12 idea_count 連動**＝クエストカード/詳細の公開アイデア数が実データに連動。
- [ ] **SC-22 quest参照/completed 事前無効化（D-TC-213/214）**＝「クエストへ戻る」導線・カテゴリーバッジ・完了時の投票/新規フォロー disabled＋⏸凍結バッジ。
- [ ] **SC-21/22 添付 D.3（D-TC-215）**＝登録/編集で添付アップロード→SC-22 に実添付表示＋DL（署名URL）。
- [ ] **SC-21 編集モードの既存添付 削除（D-TC-218）**＝編集フォームに保存済み添付が出る→× →確認ダイアログ「削除する」で即時削除・トースト・SC-22 から消える（版は増えない）。
- [ ] **SC-24 チャット E（E-TC-201/203）**＝メッセージ投稿/編集/削除・**複数引用**・添付DL・@メンション候補・通常リアクション・魔法（SC-32 で解放した魔法）・既読セパレータ・comment 権限/completed 凍結。
- [ ] **SC-32 魔法スキル G（G-TC-201）**＝カタログ/SP残高/解放数が実データ・SP を使って解放（確認→報酬スナックバー）→ SC-24 の魔法ピッカーで使えるようになる通し。
- [ ] **SC-30/SC-31 ショップ/アバター G（G-TC-202/203）**＝ショップでコイン購入（確認→報酬・残高減）→アバターで着せ替え（各スロット1点・即反映）→SC-30 で「所有済み」。要コイン（評価等で獲得）。
- [ ] **SC-41 ランキング G（G-TC-206）**＝期間タブ（今週/先週/今月/通算）でスコア（獲得XP＋コイン）順位・自分順位/総人数が実データ・表彰台。
- [ ] **SC-25/SC-22 評価 F（F-TC-201〜203）**＝SC-25 で5観点採点＋総評→確定→SC-22 §4.6 に平均/観点/総評/コインが反映・下書き復元・owner の選定トグル（★選定済み＋「選定候補」バッジ）。評価者/選定は my_permissions 出し分け。
- [ ] **SC-92/93 メール確認 ADR-0009（B-TC-169 等）**＝「確認メールを送信」→MailHog で確認リンク→`/email-verify/confirm` 確定→verified バッジ化を通しで。

## backend API 進捗

登録ルータ = **auth / admin / me**（control_plane）・**quests / ideas**（tenant）。

| ドメイン | ルータ | 状態 |
|---|---|---|
| 認証（A/B） | `control_plane/auth`・`control_plane/admin`・`control_plane/me` | ✅ ログイン/管理/プロフィール |
| クエスト（C） | `tenant/quests` | ✅ 一覧/詳細/CRUD |
| アイデア（D） | `tenant/ideas` | ✅ **15 EP**（一覧/詳細/作成/編集/公開/削除＋投票 POST/DELETE・フォロー POST/DELETE＋添付 POST/DELETE・DL＋**版タイムライン GET・差分 GET**〔D.4〕）。公開処理で初版 revision=1 記録・`idea_revisions.created_at` 追加（migration 0011） |
| 評価（F） | `tenant/evaluations` | ✅ **5 EP**（`GET evaluation/me`・`GET evaluation`〔集計・limited 非表示〕・`PUT evaluation`〔draft/submitted＋XP+30〕・`POST/DELETE select`〔XP+200・剥奪なし〕）。投稿者コイン確定 (a) 全員提出／(b) completed 遷移（C フック）＝`evaluation_coin` 冪等。migration 0012・G ledger 連動 |
| チャット（E） | `tenant/chat` | ✅ **8 EP**（`GET chat`〔一覧＋未読〕・`GET chat-activity`・`POST/PATCH/DELETE chat-messages`・`POST chat/read`＋**`POST/DELETE chat-messages/{id}/reactions`**〔通常/魔法・E.4〕）＝投稿/編集/削除・既読・活発度・添付・メンション・投稿XP+5・リアクション（マスタ絵文字）・魔法（1メッセージ1魔法/1チャット1回）。公開で chat_group 自動作成。migration 0013。**通知(H)/リアルタイム(L)は no-op** |
| ゲーム(G) | `gamification`・`shop` | 🟡 ledger（XP/コイン/SP 台帳・残高・レベル）＋魔法カタログ/解放（`/spells`・unlock）＋ショップ/装備 4 EP（`/items`・purchase・`/me/items`・`/me/equipment`・migration 0015）＋**ランキング `GET /rankings`**（activities 集計・期間×スコープ・me 同梱・新テーブルなし）。**実績（SC-40）は未着手** |

**メール確認フロー（ADR-0009）実装済み**＝送信 EP（B.2/B.2.1）・公開 confirm（`/auth/email-verify/confirm`）・`accounts.email_verified_at`・SC-92/93 バッジ＋アクション。

## 既知の課題（詳細は [`../handoff.md`](../handoff.md) §5 / §7）

- **締切(時刻)後の投票 事前無効化**＝`completed`（凍結）は事前 disabled 済みだが、締切日時超過は DTO に deadline 判定を組まず現状サーバー 409 で理由提示（deadline ベースの事前 disabled は follow-up）。
- **`IdeaDetailDTO` に `quest_id`/カテゴリー無し**＝SC-22 の「クエストへ戻る」が暫定。
- tsc 既知1件＝`components/ui/Snackbar.tsx:122`（既存デモ・Snackbar 呼び出しの引数）。※ShopView の csvVal 型は G 接続時に修正済み。

## 起動・テスト

```bash
# フルスタック起動（e2e は --profile workers 必須）
docker compose -f impl/compose.yaml --profile workers up -d --build
# ポート: frontend :3000 / backend :8000(/healthz) / db :5432 / redis :6379 / minio :9000,:9001 / mailhog :8025

# frontend tsc（cwd=impl/frontend）
cd impl/frontend && npx tsc --noEmit

# backend pytest（cwd=impl 厳守）
cd impl && docker compose -f "$PWD/compose.yaml" run --rm -T -v "$PWD/backend:/app" backend pytest tests/ideas -q

# TC-ID トレーサビリティ（コミット前ゲート・リポジトリ直下）
python3 scripts/check_tc_traceability.py
```

dev ログイン（PW 全て `Passw0rd!`）＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`（MFA OFF）・`ACME-02`/`mfa@acme2.example`（MFA ON）。詳細な e2e/openapi 再生成手順は [`../handoff.md`](../handoff.md) §8。
