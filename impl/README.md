# impl — ideaquest 実装

社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」の実装コード。
設計の正本は [`../doc/`](../doc/)（要件・API・画面・データモデル）、開発の引き継ぎは [`../handoff.md`](../handoff.md)。

- **frontend/** — Next.js（App Router・dev モード起動）。`shared.css` を単一デザインシステムに段階移行中。
- **backend/** — FastAPI 4層（router / application / repository / infra）。
- **compose.yaml** — フルスタック（PostgreSQL / Redis / MinIO / MailHog / workers / Docker）。

> 進捗の最終確認: **2026-08-24**。tsc 既知2件のみ・`tests/ideas+quests` 92 passed・e2e sc-22（quest-ref 2／vote-follow 4／idea-detail 1）passed・TC-ID トレーサビリティ ✅（code 300）。
> 開発方針＝**1画面単位で backend 接続ループ**（各画面でユーザー受入ゲート）。実装順の正本＝[`../doc/実装計画.md`](../doc/実装計画.md)＝アカウント→クエスト(C)→アイデア(D)→評価→その他。

## 画面実装進捗（SC-xx）

凡例: ✅ backend 接続済み ／ 🟡 部分接続（一部が表示のみ/デモ）／ ⬜ モック（画面のみ・backend 未接続）

| 画面 | 名称 | 状態 | ルート | 備考 |
|---|---|---|---|---|
| SC-00 | ログイン | ✅ | `(auth)/login` | 401→`/login?reason=…` セッション終了通知（デザイン標準 §14）。password-reset/-setup・email-change も配置 |
| SC-01 | ダッシュボード | 🟡 | `(app)/` | ヒーロー残高は `GET /me`（K.1）接続済み。週間ランキング/下書き/未投票/参加中等は G/C/D 接続まで demo |
| SC-02 | 通知一覧 | ⬜ | `(app)/notifications` | モックのみ |
| SC-03 | プロフィール | ✅ | `(app)/profile` | K.1（`/me`）接続済み |
| SC-10 | クエスト一覧 | ✅ | `(app)/quests` | 複製対応済み。💡件数列は `idea_count`（公開アイデア数）に連動 |
| SC-11 | クエスト作成/編集 | ✅ | `(app)/quests/new`・`[questId]/edit` | URL 付きモーダル（Parallel＋Intercept） |
| SC-12 | クエスト詳細 | 🟡 | `(app)/quests/[questId]` | 本体＋**アイデアタブ**接続済み。ヘッダー💡件数は `idea_count`（公開数）に連動。評価列(F)/週間ランキング(G)/全文検索(J) は demo |
| SC-21 | アイデア登録/編集 | ✅ | `(app)/quests/[questId]/ideas/new`（＋モーダル） | §4.7 入力検証・登録モーダル初期誤検証 fix 済み |
| SC-22 | アイデア詳細 | 🟡 | `(app)/ideas/[ideaId]` | 本体＋**投票/フォロー接続済み**（D.5/D.6・楽観更新＋サーバー権威）。**quest 参照**（D.1）でクエストへ戻る導線・カテゴリーバッジ・completed 事前無効化。締切(時刻)後は 409 で理由提示。添付(D.3)/評価(F)/チャット(E)/版差分(D.4) は表示のみ |
| SC-24 | アイデアチャット | ⬜ | `(app)/ideas/[ideaId]/chat` | モックのみ（E） |
| SC-25 | 評価画面 | ⬜ | `(app)/ideas/[ideaId]/eval` | モックのみ（F） |
| SC-30 | ショップ | ⬜ | `(app)/shop` | モックのみ |
| SC-31 | アバター着せ替え | ⬜ | `(app)/avatar` | モックのみ |
| SC-32 | 魔法スキル | ⬜ | `(app)/spells` | モックのみ |
| SC-40 | 実績バッジ | ⬜ | `(app)/achievements` | モックのみ |
| SC-41 | ランキング | ⬜ | `(app)/ranking` | モックのみ（G） |
| SC-90 | クエストグループ管理 | ✅ | `(app)/admin/quest-groups` | メンバー管理含む |
| SC-91 | システム管理 | ✅ | `(app)/admin/companies` | 会社一覧・手動プロビジョニング |
| SC-92 | 会社詳細 | ✅ | `(app)/admin/companies/[id]` | 会社プロビジョニングは MVP 手動 |
| SC-93 | 会社アカウント管理 | ✅ | `(app)/admin/companies/[id]/accounts`・`admin/accounts` | 複製対応済み |

**接続済み画面のフロント feature**＝`auth`・`profile`・`quests`・`ideas`・`accounts`・`companies`・`questgroups`・`qgadmin`（各 `api.ts` が backend を叩く）。
**モック feature**（`api.ts` 無し）＝`notifications`・`dashboard`(一部)・`chat`・`evaluations`・`shop`・`avatar`・`spells`・`achievements`・`ranking`。

## backend API 進捗

登録ルータ = **auth / admin / me**（control_plane）・**quests / ideas**（tenant）。

| ドメイン | ルータ | 状態 |
|---|---|---|
| 認証（A/B） | `control_plane/auth`・`control_plane/admin`・`control_plane/me` | ✅ ログイン/管理/プロフィール |
| クエスト（C） | `tenant/quests` | ✅ 一覧/詳細/CRUD |
| アイデア（D） | `tenant/ideas` | ✅ **10 EP**（一覧/詳細/作成/編集/公開/削除＋投票 POST/DELETE・フォロー POST/DELETE）。**添付 D.3 は未実装**（repository には関数あり） |
| 評価（F）/チャット（E）/ゲーム(G) | — | ⬜ 未着手（投票 XP は G 実装まで no-op） |

**設計確定・実装未着手**＝メール確認フロー（ADR-0009・`accounts.email_verified_at`・API B/A/K・SC-92/93）。

## 既知の課題（詳細は [`../handoff.md`](../handoff.md) §5 / §7）

- **締切(時刻)後の投票 事前無効化**＝`completed`（凍結）は事前 disabled 済みだが、締切日時超過は DTO に deadline 判定を組まず現状サーバー 409 で理由提示（deadline ベースの事前 disabled は follow-up）。
- **`IdeaDetailDTO` に `quest_id`/カテゴリー無し**＝SC-22 の「クエストへ戻る」が暫定。
- tsc 既知2件＝`components/ui/Snackbar.tsx:122`・`features/shop/components/ShopView.tsx:98`（いずれも既存/デモ）。

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
