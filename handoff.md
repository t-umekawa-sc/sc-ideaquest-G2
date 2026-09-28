# handoff（引き継ぎメモ）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるように書く。全文上書き運用（履歴は git）。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/バックログ/未実装・ギャップ一覧.md`（未実装/ISOギャップ/follow-up の台帳）。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-09-28 14:21 JST
- ブランチ: `main`（作業ツリー clean・origin/main と一致・push 済み）
- 最新コミット: `07df5aba fix(datatable): 列設定ポップオーバーがウィンドウ外に出て候補を選べない不具合を修正`
- 本セッションの主なコミット（新しい順・抜粋）:
  - `07df5aba` 列設定ポップオーバーのはみ出し修正（M-TC-018）
  - `ea794940` Revert（`c5954df8` の DataTable max-width 修正を撤回＝下記§5）
  - `6a234d35` entity_tokens をデータモデル §5.36b に設計（実装は未着手）
  - `dd6c3b5a` 情報インプット自動関連付け＝**成果物保存トリガ(逆方向)** 実装（双方向完成）
  - `a5814559` 情報インプット自動関連付け＝**情報保存トリガ** 実装（FR-41③/N.6 の未実装分）
  - `b7241a4a` `doc/バックログ/未実装・ギャップ一覧.md` 新設
  - `1fabb9ea` ISO 56001:2024 全文精読の準拠再チェック（`doc/ISO56001/`）
  - `6b6a5620`/`6d1bd114` 経営資料整合・自動関連付け 設計ドラフト起票＋6論点合意
  - `13185e44` chat_preview は別呼び出し方式を正として E.1/D.1 是正
  - `c72265f3` 「未実装」記述の陳腐化を実態へ是正
  - `4cb902a0` Step B 回帰 e2e（N-TC-226/227）
  - `e23978aa` プロジェクト(Q)の設計doc同期

## 2. ゴール
社内イノベーション支援アプリ（ideaquest）。ISO 56001 の①機会→②③コンセプト→④⑤ソリューション開発を、ゲーム感のある UI で一気通貫に回す。現在の主戦場は **情報インプット(FR-41/N) の高度化（自動関連付け・経営資料整合）** と **UI 品質改善**。

## 3. 今回やったこと（変更ファイルと理由）
すべて設計書ファースト＋red-green（テスト規約 §5.1）。

### A. 情報インプットの自動関連付け（類似度 auto-link・双方向）＝FR-41③/N.6 の未実装分
- 理由: 監査で「自動関連付けは未実装」と判明（当初サブエージェントが実装済と誤認→ユーザー指摘で訂正）。手動リンク/続報複製は既存だが、**類似度による自動生成が無かった**。
- `impl/backend/app/tenant/info/derive.py`: `token_cosine()` 追加（トークン頻度 cosine・純関数・janome・オフライン決定的）。
- `impl/backend/app/tenant/info/repository.py`: `list_candidate_targets()`（published idea/非削除 quest・concept/前提のテキスト）・`get_target_text()`・`all_info_tokens()`・`links_for_target_all()` 追加。`create_link()` に `score` 引数。`Decimal` import 追加。
- `impl/backend/app/tenant/info/application.py`: `_recompute_auto_links()`（情報保存トリガ＝`create_info_item`/`update_info_item` にフック）と `recompute_auto_links_for_target()`（成果物保存トリガ＝逆方向）追加。定数 `_AUTO_LINK_THRESHOLD=0.12`/`_AUTO_LINK_TOP_N=5`。規則＝閾値+上位N で新規生成、既存 auto は score のみ更新し人の kind/rejected_at/disposition は保持（棄却は復活しない）。
- フック（逆方向）: `impl/backend/app/tenant/ideas/application.py` の `publish_idea`/`update_idea`（公開/本文更新時）・`impl/backend/app/tenant/concepts/application.py` の `create`/`patch`。いずれも `from app.tenant.info import application as info_app` で遅延 import。
- テスト: `impl/backend/tests/info/test_auto_link.py`（N-TC-149〜155）。設計doc＝`doc/API設計/N_情報インプット.md` N.6 実装状況・`doc/テスト/N_情報インプット.md` §2.6。

### B. 列設定ポップオーバーのはみ出し修正（UI 実バグ）
- 理由: ユーザー報告＝一覧ツールバーが画面下方にあると「列設定」メニューがウィンドウ下を突き抜け、下の候補が画面外で選択不可。
- `impl/frontend/src/components/ui/DataTable.tsx`: `openColMenu()` で上下余白を測り、下が足りなければ**上向き(bottom基準)** に開く＋余白に収まる `maxHeight` を inline 付与。state `colMenuPos` に `bottom?`/`maxHeight` 追加。`.col-menu` は既存 CSS で `overflow:auto`。
- テスト: `impl/frontend/e2e/sc-10-list-state.spec.ts` に M-TC-018 追加（`doc/テスト/M_共通シェル・ナビ.md`）。

### C. ドキュメント/設計（実装なし）
- **ISO 56001:2024 準拠再チェック**＝`doc/ISO56001/ISO56001_準拠状況_再チェック_2026-09-28.md`（全文 PDF `C2_ISO_56001_2024_01.pdf` は .gitignore で追跡外）。条項別に支援度を評価。主要ギャップ＝6.4ポートフォリオ・9.1指標・4.3/5.2/5.3文書化。
- **経営資料整合・自動関連付け 設計ドラフト**＝`doc/設計ドラフト/経営資料整合・自動関連付け_設計.md`（6論点合意済み・§11）。
- **entity_tokens 設計**＝`doc/データモデル.md` §5.36b（`info_tokens` をポリモーフィック一般化。**実装は未着手**）。
- **未実装台帳**＝`doc/バックログ/未実装・ギャップ一覧.md`。
- プロジェクト(Q)設計doc同期・chat_preview 是正・「未実装」陳腐化是正（詳細は各コミット）。

## 4. 現在の状態
- 動いている（本セッションで確認済み）:
  - **自動関連付け（双方向）**: 実機スモーク＝情報作成で類似アイデアへ auto-link 生成（score 0.742）／アイデア公開で既存情報から逆リンク生成（score 0.979）を live API＋DB で確認。backend は再ビルド済み（デプロイ反映済）。
  - **列設定はみ出し修正**: DPR1.5・短ビューポートで `.col-menu` が `bottom≤innerHeight`・`top≥0`・スクロール可を実測。frontend 再ビルド済み（デプロイ反映済）。
- テスト通過状況（本セッションで実行したもののみ）:
  - `pytest tests/info tests/ideas tests/concepts` = **236 passed**（自動関連付け N-TC-149〜155 含む・回帰なし）。※`-v` マウント実行（下記§8）。
  - e2e `sc-10-list-state`（M-TC-016/017/018）= **5 passed**（setup/cleanup 込み）。
  - e2e `sc-50-info-to-quest-draft`（Step B・N-TC-226/227）= 3 passed（前半）。
  - `python3 scripts/check_tc_traceability.py` = ✅（873件）。
- 壊れているもの: 確認した範囲では無し（誤修正 `c5954df8` は `ea794940` でリバート済み・デプロイも復元済）。
- 未確認: **backend フル pytest** と **Playwright e2e フルスイート** は本セッション未実行。ユーザーによる①列設定修正②⋯位置 のブラウザ最終確認（ハードリロード後）は**未確認**（下記§5/§7）。

## 5. 詰まっている点（試して失敗した/注意）
- **⋯（操作列）が右に寄りすぎる、というユーザー報告は本セッションで再現できず**。
  - ユーザー環境＝**Win150%拡大＝DPR 1.5**（メモリ `subpixel-align-dpr-fractional`）。私が DPR=1 で見ていたため差が出なかった。DPR 1.5・CSS幅1280 で再現したところ、`main.container` は `max-width:1120px`(design-system.css) でキャップされ、projects 一覧の⋯は更新列直後（隙間16px）でテーブル右端＝**正常**だった。
  - **失敗した修正**: `c5954df8` で DataTable に `max-width=sumW` を課したが、**sumW<コンテナの小さいテーブル（WBSタスク等）を content 幅に縮めて右に大余白**を作り悪化。projects一覧(sumW1216>コンテナ)には効かず。→ `ea794940` でリバート。
  - **教訓**: 本番を直接触らず、ユーザー提案どおり**モック先行**（style-guide.html §9 の DataTable デモ）で再現→検証すべきだった。style-guide のモックは**vanilla DataTable**（本番は React DataTable）で別実装な点に注意。
  - 現状の見立て＝以前のスクショの乖離は「私の不良修正のキャッシュ」か「列設定の保存値(localStorage `sc10-quests` 等の列幅)」の可能性。**ユーザーのハードリロード＋列設定リセット後の再確認待ち**。
- pytest は backend がソースをベイク（volumes 無）のため、未コミット編集を反映するには `-v` マウント実行が必要（メモリ `backend-no-source-mount`）。

## 6. 決定事項と根拠
- **自動関連付けの規則（N.6）**: 既存 auto は score のみ更新し、人が変えた kind・棄却(rejected_at)・採否(disposition)は保持＝人の決定を上書きしない。閾値+上位N でノイズ抑制。候補外（下書きアイデア等）は no-op。
- **成果物保存トリガは info_tokens（永続）を読む**（逆方向）。情報保存トリガは候補ごとに都度トークン抽出（janome）＝性能課題。恒久解＝**entity_tokens**（§5.36b・下記§7）。
- **経営資料整合（合意済み・6論点）**: 「率」は Phase1=決定的（キーワード/ワードクラウド重なり）／Phase2=LLM。機会/脅威率は `info_items.impact_class`（curator手入力）の集計で出す（キーワードでは機会/脅威を判別不可）。経営資料入力は **ISO56001 用語の構造化入力**（意図/方針・コミットメント/戦略/重点領域/目標）。トークン基盤は **entity_tokens に一般化**（chat_thread と同方式）。生成は Phase1=AI用Markdownエクスポート、Phase2 in-app 生成は**オンプレ無料LLM既定・クラウド有料オプション**。
- **chat_preview（E.1）は別呼び出し方式を採用**（DTO内包はしない）＝frontend が `GET /ideas/{id}/chat` で直近3件を表示済み。DTO内包は新価値なしのため見送り。
- **列設定はみ出し修正**: 「下向き固定＋max-height:70vh」を「余白測定→上下判定＋余白に収まる max-height」へ。全一覧共通の DataTable で一元修正。
- **不採用**: DataTable `max-width=sumW`（§5＝小テーブルで余白を作り悪化）。flex-primary（先頭列吸収）案（キャップ環境で先頭列が過度に縮む副作用）。

## 7. 次にやること（優先順・具体的に）
1. **ユーザーのブラウザ最終確認を待つ（未確認）**: ①列設定(`07df5aba`)が全候補ウィンドウ内で選べるか ②⋯位置。まだ⋯が寄って見える場合は、その一覧の「列設定」を開いた状態のスクショ（保存列幅/表示列）を受領→**style-guide.html §9 のモックに同構成を再現**して原因特定→モックで直して本番移植（モック先行を厳守）。
2. **entity_tokens 基盤の実装（合意済み・設計 §5.36b）＝経営資料整合フェーズの土台**。順:
   - migration `impl/backend/migrations/company/versions/0044_entity_tokens.py`（`entity_tokens` 作成＋既存 `info_tokens` を `owner_type='info'` で移送）。company head は現在 `0043_project_groups`。
   - ORM `EntityToken`（`impl/backend/app/tenant/info/orm.py` かユーティリティ）＋ repo 汎用化（`replace_tokens(owner_type, owner_id, …)`／`tokens_for`／`all_tokens_by_type`）。
   - info 側の token 参照（`repository.py` の word_cloud/`all_info_tokens`/`replace_tokens`）を `entity_tokens` 経由に切替。
   - idea 公開/concept 作成更新で token を永続化。
   - 自動関連付け（`application._recompute_auto_links`/`recompute_auto_links_for_target`）を `entity_tokens` 読取に切替＝**情報保存側の候補都度抽出を撤廃**（`doc/バックログ` F2/S1）。
   - red-green テスト（既存 word cloud・N-TC-149〜155 が緑のまま＋新 TC）。
3. **経営資料整合 Phase1**（entity_tokens 後）: 経営資料エンティティ（ISO構造化入力）→ アイデア整合率→コイン → 機会/脅威率(impact_class集計) → AI用Markdownエクスポート。正＝`doc/設計ドラフト/経営資料整合・自動関連付け_設計.md`。
4. **回帰**: 着手前に backend フル pytest（`-v`マウント・ワーカ停止）と Playwright e2e フルを通す（本セッション未実行）。
5. **ISO ギャップ（任意・価値高）**: 6.4 イノベーションのポートフォリオ、9.1 指標ダッシュボード（`doc/バックログ` G2/G3）。

## 8. 再開に必要な環境情報
- 作業ディレクトリ: リポジトリ直下。実装は `impl/`（`impl/backend`=FastAPI+SQLAlchemy+Alembic、`impl/frontend`=Next.js）。**コマンドは絶対パスかフルパス指定**（このシェルは cd が持続しない）。
- フル起動: `cd impl && docker compose up -d --build`。フロント反映＝`docker compose up -d --build frontend`（ビルドをベイク）。backend 反映＝`up -d --build backend`＋必要時 `docker compose exec -T backend python -m scripts.bootstrap`（company head=`0043_project_groups`）。
- backend pytest（**未コミット編集を反映するには -v マウント**・ワーカ停止・cwd=impl）: `cd impl && docker compose run --rm -T -v "$PWD/backend:/app" backend pytest tests/info -q`（対象を絞る）。
- frontend 検証: `cd impl/frontend && npm run build`（tsc/lint 兼）。e2e: `cd impl/frontend && npx playwright test <spec> --project=chromium`（storageState 認証・auth.setup が先行）。
- TC トレーサビリティ: リポジトリ直下で `python3 scripts/check_tc_traceability.py`（コミット前ゲート）。
- ポート: frontend `http://localhost:3000`／backend `http://localhost:8000`／MailHog `http://localhost:8025`。
- ログイン（seed・ACME）: 会社コード `ACME-01`／ID `user@acme.example`／PW `Passw0rd!`。管理者 seed＝`kanri@acme`(company_account_admin)・`admin@ops`(system_admin) いずれも `Passw0rd!`。
- DB 直確認: `docker compose exec -T db psql -U ideaquest -d ideaquest_company_acme -c "…"`（会社DB＝`ideaquest_company_acme`／control＝`ideaquest_control`）。accounts は control DB。
- Playwright 検証スクリプトは `impl/frontend/tmp_shots/*.mjs`（git 追跡外）。**ユーザー環境再現には `deviceScaleFactor:1.5`（Win150%）を必ず設定**。列設定はリスト表示切替後に出現（カード表示では非表示）。
- 検証で作った下書き/プロジェクトは soft-delete で片付け済み（quests/projects は `deleted_at`／info_items は物理削除）。
