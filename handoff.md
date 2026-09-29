# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/バックログ/未実装・ギャップ一覧.md`（未実装/ISOギャップ/follow-up の台帳）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-09-29（本セッション末）
- ブランチ: `main`（作業ツリー clean）
- push: 本セッションのコミットを **origin/main へ push 済み**。
- 本セッションのコミット（新しい順）:
  - `docs(handoff)` 本ファイル全文更新（このコミット）
  - `831724e2` feat(auto-link): entity_tokens 一般化＋会社別 一致率しきい値（N.6・§5.36b）
  - `62e28964` feat(notifications): ブラウザ通知 Tier1（前景・宛先明確な通知を OS 通知）
  - `56c6615b` feat(chat): @全員/@all メンション（メンバー全員へ一括通知）
- 直前セッション末＝`6a9b47d1`（登録ダイアログ閉じ標準／操作列左端縦⋮／一覧ピン client+server／機能ガイド）。

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発を、ゲーム感のある UI で一気通貫に回す。本セッションは**ユーザー要望の新機能3件**＝(1) チャットの全員メンション、(2) ブラウザ通知 Tier1、(3) 情報の自動関連付けの一般化（entity_tokens）＋一致率しきい値の会社別設定。すべて実機検証＋pytest 済み。

## 3. 今回やったこと（変更と理由）

### A. @全員 / @all メンション（`56c6615b`・frontend のみ）
- 理由＝宛先が明確な一括通知の気づきを高めたい（ユーザー要望）。権限は個別メンションと同じ comment。
- **クライアント展開**＝送信時に `@全員`/`@all` を当該パーティの全メンバー `user_id` へ展開（backend/API/スキーマ変更ゼロ＝既存のメンバー限定検証・通知整合を流用）。
- `features/chat/render.ts`＝`isAllMentionToken`／`resolveMentionIds`（全員→全メンバー展開・重複排除）＋`renderTextHtml` 強調対応。`IdeaChatView.tsx`＝候補ポップアップ先頭に「全員」候補・`extractMentionIds` を `resolveMentionIds` へ委譲。
- テスト＝`render.test.ts` E-TC-229/230（※採番衝突に注意＝既存 E-TC-213/214 を避け 229/230）。正本＝FR-24・データモデル §5.17・API E.6・SC-24。

### B. ブラウザ通知 Tier1（`62e28964`・frontend のみ）
- 理由＝メンション・参加リクエスト等の宛先明確な通知を **OS 通知**で気づかせたい。既存の `notification.created`（WS 速報・data は REST 表現で body/context/tag/ref 込み）にフック＝**追加 fetch なし・backend 変更なし**。
- `features/notifications/browserPush.ts`＝発火ゲート `shouldBrowserNotify`（純ロジック・H-TC-301）＋enable/permission/localStorage アダプタ＋`maybeBrowserNotify`。有効化は**デバイス単位**（ブラウザ許可＋localStorage `iq_browser_notify`）。発火は**タブ非アクティブ時（document.hidden）のみ**・ゲーム層の自己報酬（achievement/magic_reaction）は除外。
- `RealtimeProvider.tsx`＝`notification.created` で `maybeBrowserNotify(d, notificationHref(d))`。`NotificationsView.tsx`（SC-02）＝オプトイン トグル（有効化/ON/ブロック中の3状態）。
- **Tier2＝Web Push（背景/タブ閉時配信・Service Worker＋VAPID）はバックログ O3**（未着手）。正本＝FR-24・SC-02・H_通知.md・[[browser-notification-tier-plan]]。

### C. entity_tokens 一般化 ＋ 会社別 一致率しきい値（`831724e2`・backend+frontend）
- 理由＝自動関連付け（N.6）の**前向き（情報→成果物）が候補を毎回 janome 再抽出**していた無駄を撤廃＋経営資料整合フェーズのトークン基盤を用意。加えて「一致率を会社ごとに設定したい」（現行 12% ハードコード）。
- **Phase A**＝migration `company/0044_entity_tokens`（`entity_tokens`＝owner_type/owner_id 多態・info_tokens を owner_type='info' でコピー移送・**info_tokens は残置**）。ORM `EntityToken`＋汎用 repo `app/tenant/tokens/`（`replace_tokens`/`tokens_for`/`all_tokens_by_type`/`tokens_for_owners`）。info repository の token 参照を entity_tokens へ委譲。
- **Phase B**＝`info_app.persist_entity_tokens(ts, owner_type, id, text)` を保存点に差込＝アイデア公開/更新・コンセプト作成/更新・クエスト作成/更新/公開・前提作成/更新（情報は既存）。前向き `_recompute_auto_links` を候補の**永続トークン一括読取**へ（未永続の既存成果物は**自己修復**＝一度だけ抽出→永続化）。逆向き（`recompute_auto_links_for_target`）は従来どおり（単一 target 抽出）。
- **Phase C**＝migration `control/0017_autolink_threshold`（`companies.auto_link_threshold` NUMERIC(4,3)・既定 0.120）。Company ORM/`_SETTINGS_FIELDS`/`CompanyDetail`/`CompanySettingsUpdateRequest` に追加・**0..1 範囲外は 422**。auto-link は `info_app.auto_link_threshold_of(company)` で解決。SC-92 会社設定に「一致率しきい値（%）」数値入力（比率で保存・% 表示）。OpenAPI 型再生成（`npm run codegen`）。
- **Phase D**＝設計正本（データモデル §5.36/§5.36b 実装済みマーカー・API B `/settings`・SC-92・N/B テスト md）＋TC。N-TC-156（会社別しきい値で auto-link 有無が変わる・red 目視済）・N-TC-157（自己修復で候補トークン永続化）・B-TC-177/178（設定更新＋範囲外422）。
- 正本＝データモデル §5.36b・[[info-auto-linking-unimplemented]]・[[strategy-doc-alignment-feature]]。

## 4. 現在の状態
- 動いている（本セッションで実機/テスト確認済み）:
  - @全員＝候補「全員」表示・`@全員` 強調・サーバー mentions[] に全メンバー展開（Playwright 目視）。**ユーザー受入 OK**。
  - ブラウザ通知＝SC-02 トグル3状態・localStorage 1↔0（Playwright 目視）。**ユーザー受入 OK**。
  - 一致率しきい値＝SC-92 で 12%→25% 保存→リロード永続→サーバー 0.25（Playwright 目視）。
- テスト（本セッションで実行）:
  - backend `pytest tests/info tests/ideas tests/concepts tests/quests tests/admin` = **482 passed**（entity_tokens/しきい値含む）。
  - frontend `vitest`（chat/notifications）= 32 passed。frontend 本番ビルド通過。
  - `python3 scripts/check_tc_traceability.py` = ✅（879）。
- 壊れているもの＝**確認範囲では無し**。
- 未確認＝**backend フル pytest** と **Playwright e2e フルスイート**（本セッションはドメイン/画面単位のみ）。

## 5. 詰まっている点（落とし穴）
- **TC-ID 採番衝突**＝`check_tc_traceability.py` は一意性を見ない（存在チェックのみ）。新規採番前に当該ドメインの max を grep（[[tc-id-traceability-no-uniqueness]]）。今回 E-TC-213/214 を重複させかけ 229/230 に是正。
- **entity_tokens 移行のフィクスチャ**＝`tests/info/conftest.py`／`test_auto_link.py` が `InfoToken` を直接 seed していたため、委譲後 word_cloud/detail が空に→フィクスチャを `EntityToken(owner_type='info')` へ移行して解決。
- **前向き auto-link の既存テスト**＝`_seed_ideas` は Idea を直接 insert（トークン未永続）だが、前向きの**自己修復**（未永続候補を抽出→永続化）で N-TC-150 等は緑を維持。
- **frontend/backend はイメージにベイク**＝コード変更後は `docker compose up -d --build frontend|backend` しないと実機/e2e に反映されない。backend 変更後は `npm run codegen` で OpenAPI 型再生成してから frontend ビルド。
- **ブラウザ通知の実機目視**＝headless では実 `Notification.permission` が denied になる（→トグルは「🔕 ブロック中」表示が正常）。有効化→ON の目視は `Notification` をスタブして検証した。

## 6. 決定事項と根拠
- **@全員 はクライアント展開**（§3A）＝backend 変更ゼロ・既存メンバー検証/通知整合を流用。
- **ブラウザ通知は Tier1（前景）を先行・Tier2（Web Push）はバックログ**（§3B）＝許可はデバイス単位なので localStorage 有効化・タブ非アクティブ時のみ発火。
- **前向き auto-link は永続トークン読取＋自己修復**（§3C）＝都度 janome 抽出を撤廃しつつ既存データも埋める。逆向きは単一 target 抽出のまま（低コスト・低リスク）。
- **一致率しきい値は会社別**（§3C）＝`companies.auto_link_threshold`（既定 0.12）・SC-92 で % 入力・範囲外422。
- **owner_type は単数形**（info/idea/concept/quest/assumption）／`info_links.target_type` は複数形（ideas/…）＝`_OWNER_OF_TARGET` でマッピング。`strategy_doc` は経営資料機能で追加。

## 7. 次にやること（優先順・具体的に）
1. **経営資料整合 Phase1**（本命・entity_tokens 基盤の上に載る）＝経営資料エンティティ（ISO構造化入力）→整合率→コイン→機会/脅威率→AI用 Markdown エクスポート。owner_type='strategy_doc' を entity_tokens に追加。正＝`doc/設計ドラフト/経営資料整合・自動関連付け_設計.md`・[[strategy-doc-alignment-feature]]。
2. **ブラウザ通知 Tier2（任意・バックログ O3）**＝Service Worker＋VAPID＋`PushSubscription` 端末別保存（新テーブル＋EP）＋通知生成箇所での push 送信。背景/タブ閉時も配信。
3. **LLM 連携**（将来）＝経営資料整合 Phase2 のセマンティック整合率・要約/発想支援・機会/脅威判定補助。オンプレ無料LLM既定。
4. **ISO ギャップ（任意）**＝6.4 ポートフォリオ・9.1 指標・9.3 レビュー。正＝`doc/ISO56001/ISO56001_準拠状況_再チェック_2026-09-28.md`。
5. **回帰**＝着手前に backend フル pytest（`-v`マウント・mail-worker 停止）と Playwright e2e フルを通す（本セッション未実行）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝リポジトリ直下。実装は `impl/`（`impl/backend`=FastAPI+SQLAlchemy+Alembic、`impl/frontend`=Next.js）。**コマンドは絶対パス**（このシェルは cd が持続しない）。
- フル起動＝`cd impl && docker compose up -d --build`。フロント反映＝`up -d --build frontend`／backend 反映＝`up -d --build backend`。**server 一覧/新 DTO の型は backend 変更後に `cd impl/frontend && npm run codegen`**（`http://localhost:8000/openapi.json`→`src/lib/api/schema.d.ts`）してから frontend ビルド。
- 非同期系（mail=MFA/PW設定・sc-90 ディレクトリ）＝`docker compose --profile workers up -d`（既定 up では worker 非起動）。**MFA コードが届かない時はこれ**。**pytest 時は mail 競合回避に `docker compose stop worker mail-worker`**。※本セッション末は `--profile workers` を起動したまま。
- backend pytest（未コミット編集反映＝`-v`マウント・cwd=impl）＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/info -q`。※entrypoint が pytest 前に bootstrap（migration 適用）を走らせる＝新 migration は自動適用される。
- frontend 検証＝`cd impl/frontend && npm run build`（tsc/lint 兼）・`npx vitest run <path>`。e2e＝`npx playwright test <spec> --project=chromium`（storageState 認証・auth.setup 先行）。使い捨て spec は `e2e/tmp-*.spec.ts`（確認後削除）・スクショ `tmp_shots/`。
- TC トレーサビリティ＝リポジトリ直下で `python3 scripts/check_tc_traceability.py`（コミット前ゲート・**一意性は見ない**）。
- ポート＝frontend `:3000`／backend `:8000`／MailHog `:8025`。ログイン（ACME）＝会社コード `ACME-01`／ID `user@acme.example`／PW `Passw0rd!`。管理者＝`kanri@acme`(company_account_admin)・会社 `OPS`／`admin@ops.example`(system_admin)・共に `Passw0rd!`。
- DB 直確認＝`docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "…"`（会社DB＝`ideaquest_company_acme`／control＝`ideaquest_control`）。トークン表＝`entity_tokens`（owner_type/owner_id）・`info_tokens` は残置（未使用）。会社別しきい値＝control `companies.auto_link_threshold`。
