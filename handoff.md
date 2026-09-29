# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/バックログ/未実装・ギャップ一覧.md`（未実装/ISOギャップ/follow-up の台帳）／`doc/テスト/R_経営資料.md`（R ドメインの TC 台帳）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-09-29（本セッション末）
- ブランチ: `main`（作業ツリー clean）。
- push: ピッカー行アイコン（backend strategy/info 候補 DTO＋frontend 両ピッカー＋R-TC-109/N-TC-228＋TC台帳＋impl/README に FR-44 節追加）を **feat コミット済**。push は未（次セッション/指示で push）。
- 直近コミット（新しい順・本ファイル＝最新の docs(handoff) コミット）:
  - `docs(handoff)` 本ファイル全文更新（このコミット）
  - `d76a1d66` feat(strategy): SC-22 に方針整合バッジ＋アイデア詳細に alignment 露出（Step3）
  - `a576c75e` feat(strategy): 整合率＋コイン backend（Step3・R.2/R.3）
  - `274e313d` / `60dca04c` / `b3b336b0` / `fc08f070` strategy「紐づくクエスト」＋主要語 UI 群（Step2B）
  - `4244e90c` / `9cf6c3dc` / `8dcd6d21` / `09be4a6f` / `7ab86ae5` / `f5e2cf97` strategy CRUD＋画面（Step2A）
  - `09c50788` / `2baffec5` strategy 基盤＋クエスト単位選択（Step1）
- 本セッション前半（すでに push 済・詳細は git）＝`56c6615b` @全員メンション／`62e28964` ブラウザ通知 Tier1／`831724e2` entity_tokens 一般化＋会社別 一致率しきい値／`36c0e371` しきい値スライダー。

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発を、ゲーム感のある UI で一気通貫に回す。本セッションの本命は **経営資料整合（FR-44・ドメイン R）**＝中長期計画/方針資料を登録し、クエストが適用資料を選択→アイデアと資料の**整合率**を算出→**コイン付与**、将来は機会/脅威率と AI 用 Markdown エクスポートまで。

## 3. 今回やったこと（変更と理由）

### 経営資料整合 ドメイン R（FR-44）＝ Step1〜3 完了
方針＝Step 単位で実装しユーザー受入ゲートを挟む。設計正本＝`doc/設計ドラフト/経営資料整合・自動関連付け_設計.md`・`doc/API設計/R_経営資料・整合.md`・`doc/画面設計/screens/SC-80_経営資料.md`・データモデル §5.54/5.55/5.56・要件 FR-44。

**Step1 基盤**（`2baffec5`/`09c50788`）
- 新ドメイン `impl/backend/app/tenant/strategy/`（`orm.py`/`schemas.py`/`repository.py`/`application.py`/`router.py`/`alignment.py`/`__init__.py`）。router prefix=`/api/v1`。
- migration `migrations/company/versions/0045_strategy_documents.py`・`0046_quest_strategy_documents.py`＝テーブル `strategy_documents`（ISO 構造化項目・doc_kind・対象期間 period_from/to・body_text 連結・status active/archived）・`idea_alignment`（idea×資料の率＋効いた語）・`quest_strategy_documents`（クエスト↔資料の多対多）。
- **適用はクエスト単位の手動選択**（日付自動ではない）＝1 アイデア × N 資料。クエストが選ぶ資料を母集合に整合率を出す。資料選択の変更は**クエスト版履歴に記録**（`quests/application.py` の `_quest_content_snapshot` に `strategy_documents`＝資料タイトルを追加、`QUEST_REVISION_FIELDS`/`_QUEST_EMPTY_SNAPSHOT` にも追加）。

**Step2 CRUD＋画面**（`f5e2cf97`〜`4244e90c`）
- backend CRUD＝**管理者スコープ**（作成/更新/アーカイブは `company_account_admin`/`system_admin` のみ・一般/クエスト権限は 403）。選択用一覧 `?for=selection` は軽量（クエスト作成者が閲覧可・active のみ）。`body_text` 連結→`persist_entity_tokens(owner_type='strategy_doc')` でトークン永続化。
- frontend `impl/frontend/src/features/strategy/`（`StrategyListView`＝カード/表トグル＋複製・`StrategyFormPanel`/`StrategyFormModal`＝URL付きモーダル・§4.7 検証・ⓘガイド・重点領域は複数自由入力・`StrategyQuestLinks`・`strategy.css`・`types.ts`・`api.ts`）。画面 SC-80（メニュー「経営資料」）。
- **削除は論理削除に統一**（`4244e90c`）＝アーカイブ（status=archived）＋復元（unarchive）。**物理削除は廃止**（repository の physical delete 撤去）。参照中も安全（選択用一覧から外れるだけ）。
- 「紐づくクエスト」UI（`StrategyQuestLinks`）＝**情報の「関連リンク」と同一 UI**（`@/features/info-input/info-input.css` の link-*/pick-* を流用）。編集時は API 即時・登録時はローカルステージ→作成後にまとめて追加。「対象を選ぶ」ピッカーの絞り込み順＝**ステータス→タイトル→期限（FROM〜TO）**、種別/種別設定は無し、結果行のクエストバッジは除去、ステータスは日本語表示（`questStatusLabel`）。「この資料の主要語」（cloudTokens）は情報の登録ダイアログと同 UI。

**Step3 整合率＋コイン**（`a576c75e`/`d76a1d66`）
- `strategy/alignment.py`＝`recompute_for_idea(ts, idea, award=)`（アイデア公開/更新時に `ideas/application.py` から発火）。クエストが選択した資料を母集合に **keyword cosine**（`app/tenant/info/derive.py` の `token_cosine`・entity_tokens を読む）で best を算出→`idea_alignment` upsert＋`matched_tokens` 保存。`coins_for(best)`＝段階 `≥0.50→+3／≥0.70→+7／≥0.90→+15`。コインは `ledger.grant`＋`gami_repo.exists_ref` で**冪等・初回のみ・下げない**（reason=`idea_alignment`）。`recompute_for_quest` は資料選択変更時に公開アイデアを再計算（**award=False＝再付与しない**）。`alignment_payload` が SC-22 表示データを返す。
- `ideas/schemas.py`＝`IdeaDetailDTO.alignment: dict|None`（**これが無いと FastAPI が応答から剥がす**＝ハマりどころ）。`ideas/application.py` の `_build_detail` に `alignment` 合成。
- `IdeaDetailView.tsx`＝ヘッダに「🎯 方針整合 X% ・ +N🪙」バッジ（best_score>0 のみ・付与済=`badge-success`／未=`badge-muted`）。`schema.d.ts` codegen 反映。

### 本セッション前半（すでに完了・受入 OK・詳細は git／前版 handoff）
@全員/@all メンション（frontend クライアント展開）・ブラウザ通知 Tier1（前景・タブ非アクティブ時のみ）・entity_tokens 一般化＋会社別 一致率しきい値（既定 0.12・SC-92 スライダー）。

## 4. 現在の状態
- 動いている（本セッションで実機/テスト確認済み）:
  - 経営資料 CRUD＋画面（一覧カード/表・登録/編集モーダル・アーカイブ/復元・複製・紐づくクエスト）。ユーザー受入 OK（Step2）。
  - Step3 整合＝資料+クエスト+一致アイデアを作成→紐づけ→公開で `GET /ideas/{id}.alignment` に `best_score 0.962 / coins_awarded 15`、SC-22 に「🎯 方針整合 96% ・ +15🪙」バッジをスクショ目視確認（ヘッダのコインも +15 反映）。使い捨て spec と dev DB のテスト残骸は掃除済。
- ピッカー行アイコン（次アクション#1・**未コミット**）＝backend+frontend 実装済・実機ビルド反映済。クエストを選ぶ/対象を選ぶダイアログの候補行に画像アイコン（設定時）or 頭文字タイル（未設定）をタイトル前に表示。スクショ目視 OK（`tmp_shots/strategy-quest-picker.png`／`info-target-picker.png`）。
- テスト（本セッションで実行）:
  - backend **フル pytest = 862 passed**（次セッション冒頭の裏取りで実行）。追加後の `tests/strategy`＋`tests/info` = 90 passed（R-TC-109／N-TC-228 含む）。
  - `python3 scripts/check_tc_traceability.py` = ✅（890）。
- 壊れているもの＝**確認範囲では無し**。
- **未確認**＝(a) frontend `vitest` 全域は未再実行（`npm run build` は今回通過）、(b) Playwright e2e フルスイート未実行（使い捨て spec での目視のみ）。

## 5. 詰まっている点（試して失敗した/落とし穴）
- **`IdeaDetailDTO` に alignment 未追加だと剥がれる**＝backend で payload を積んでも Pydantic 応答モデルにフィールドが無いと FastAPI が除去。DTO に `alignment: dict|None` を追加して解決。
- **ビルド順序**＝`npm run build` が codegen より先だと `idea.alignment` が型エラー。正順＝backend 再ビルド→`openapi.json` に alignment 出現を待つ→`npm run codegen`→frontend build→`up -d --build frontend`。
- **dev DB のテスト残骸 physical 削除の FK 連鎖**＝アイデアは公開時に chat_group が自動生成される。掃除順＝`chat_thread`(単数形・owner_type='chat_group')→`chat_groups`→`idea_revisions`/`idea_alignment`/`entity_tokens`→`ideas`。クエストは `quest_member_permissions`→`quest_revisions`→`quest_categories`→`quest_members`→`quest_strategy_documents`→`quests`。**psql の複数文 `-c` は 1 トランザクション**＝途中で FK 失敗すると全ロールバックするので、掃除は文ごとに分けて実行する。
- **R-TC-108 teardown FK**＝quest 子（revisions/members/permissions）が factory admin を参照→物理クリーンアップ＋クエスト所有者で再ログインして解消。
- **R-TC-201 FK**＝Idea を Quest/doc flush 前に insert すると FK 落ち→`ts.flush()` を Quest+doc 追加後に入れて解消。
- **frontend/backend はイメージにベイク**＝変更は `docker compose up -d --build frontend|backend` しないと実機/e2e に反映されない。

## 6. 決定事項と根拠
- **コインは段階 50/70/90%→+3/+7/+15・初回のみ・下げない**＝整合率の初期到達を報酬化。再計算（資料選択変更）では再付与しない（`award=False`）＝二重取り防止。
- **適用はクエスト単位の手動選択（1 アイデア×N 資料）**＝日付自動より、クエスト作成者が資料を見て選ぶ運用が実態に合う（ユーザー判断）。
- **削除は論理削除（アーカイブ＋復元）のみ・物理削除廃止**＝プロジェクト全体の方針（info-raw 以外は論理）に合わせる。参照中の資料も安全。
- **登録権限は company_account_admin/system_admin**＝経営資料は会社の正式文書。選択用一覧のみ一般（クエスト作成者）に開放。
- **整合率は SimilarityProvider 抽象（既定 keyword cosine）**＝将来ローカル埋め込み（Step3ب）へ差し替え可能に。無料 Python ライブラリ範囲。
- **「紐づくクエスト」は情報の関連リンク UI を流用**＝新規 UI を作らない方針（[[reuse-existing-ui-no-new]]）。
- **owner_type は単数形**＝entity_tokens に `strategy_doc` を追加（info/idea/concept/quest/assumption と同系）。

## 7. 次にやること（優先順・具体的に）
1. ~~**ピッカー行にアイコン表示**~~ **【完了 2026-09-29】** クエストを選ぶ（`StrategyQuestLinks`）／対象を選ぶ（`TargetPicker`）の候補行に共通 `QuestIcon`（画像 or 頭文字タイル）をタイトル前に表示。backend 候補 DTO に `icon_image_url` 追加（strategy=`QuestLinkItem`／info=`InfoLinkCandidateDTO`・ideas は個別→作成者既定フォールバック・presigned は application 層で解決）。テスト R-TC-109／N-TC-228 green・両ピッカーをスクショ目視確認済。**未コミット**（次セッションでコミット可）。
2. **Step3ب ローカル埋め込み SimilarityProvider**＝keyword cosine を意味的一致に差し替え可能な provider 実装（無料ライブラリ）。差し替え点＝`strategy/alignment.py` の `score`。
3. **Step4 機会/脅威/影響率＋ワードクラウド**＝`doc/テスト/R_経営資料.md` §3 に TC 追加してから実装（R.4）。
4. **Step5 AI 用 Markdown エクスポート**＝R.5・`doc/テスト/R_経営資料.md` §4 に TC 追加してから。
5. **回帰**＝着手前に backend フル pytest（`-v`マウント・mail-worker 停止）と Playwright e2e フルを通す（本セッション未実行）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ＝リポジトリ直下。実装は `impl/`（`impl/backend`=FastAPI+SQLAlchemy+Alembic、`impl/frontend`=Next.js）。**コマンドは絶対パス**（このシェルは cd が持続しない）。compose ファイル＝`impl/compose.yaml`。
- フル起動＝`cd impl && docker compose up -d --build`。フロント反映＝`up -d --build frontend`／backend 反映＝`up -d --build backend`。**新 DTO の型は backend 変更後に `cd impl/frontend && npm run codegen`**（`http://localhost:8000/openapi.json`→`src/lib/api/schema.d.ts`）してから frontend ビルド。
- 非同期系（mail=MFA/PW設定・sc-90 ディレクトリ）＝`docker compose --profile workers up -d`（既定 up では worker 非起動）。**MFA コードが届かない時はこれ**。※本セッション中に起動済み。**pytest 時は競合回避に `docker compose stop worker mail-worker`**。
- backend pytest（未コミット編集反映＝`-v`マウント・cwd=impl）＝`cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/strategy -q`。entrypoint が pytest 前に bootstrap（migration 適用）を走らせる＝新 migration は自動適用。
- frontend 検証＝`cd impl/frontend && npm run build`（tsc/lint 兼）・`npx vitest run <path>`。e2e＝`npx playwright test <spec> --project=chromium`（storageState 認証・auth.setup 先行）。使い捨て spec は `e2e/tmp-*.spec.ts`（確認後削除）・スクショ `tmp_shots/`。
- TC トレーサビリティ＝リポジトリ直下で `python3 scripts/check_tc_traceability.py`（コミット前ゲート・**一意性は見ない**＝採番前に当該ドメインの max を grep）。
- ポート＝frontend `:3000`／backend `:8000`／MailHog `:8025`。ログイン（ACME）＝会社コード `ACME-01`／ID `user@acme.example`／PW `Passw0rd!`。管理者＝`kanri@acme`(company_account_admin)／`admin@ops.example`(system_admin・会社 OPS)・共に `Passw0rd!`。経営資料の登録は管理者で。
- DB 直確認＝`docker compose -f impl/compose.yaml exec -T db psql -U ideaquest -d ideaquest_company_acme -c "…"`（会社DB＝`ideaquest_company_acme`／control＝`ideaquest_control`）。R ドメイン表＝`strategy_documents`・`idea_alignment`・`quest_strategy_documents`。トークン＝`entity_tokens`（owner_type/owner_id・`strategy_doc` 含む）。会社別しきい値＝control `companies.auto_link_threshold`。
