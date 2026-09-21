# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-21 23:45 JST**
- ブランチ: **main**（作業ツリー clean・`origin/main` と同期・この handoff コミットが tip として載る）
- 最新の機能コミット: **`57e1a33`** `docs(test std): §5.4 追加`。直前が **`94c1d29`** `feat(info detail): 参考資料を保存でまとめて反映＋属性を折り畳み`。
- 本セッションのコミット列（古→新・すべて push 済）: `78cf8d6`/`44c7a64`（ダイアログ余白＝`.dialog-label` display:block・§4.1）→ `6fccaa3`/`02f2fb3`/`6289f5d`（アカウント複製422・所属列の非同期反映・silent reload）→ `ff01c8d`（発見カタログ discoverable）→ `2693f85`/`9916da2`（情報判定権限を SC-92 自社にも表示・SC-93/92 を QG 管理と同構成へ）→ `db0314e`（**アイデア添付の版管理デグレ修正**）→ `f990f15`（情報＝版1記録＋要約150字）→ `94c1d29`（情報詳細の添付を保存時バッチ化＋属性折り畳み）→ `57e1a33`（テスト規約 §5.4）。
- コミット方針: ユーザーが「コミットして/プッシュして」と言うまでコミットしない。1スライス=1コミット。末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

## 2. プロジェクトのゴール
社内アイデア創出のゲーミフィケーション Web アプリ **IdeaQuest**（マルチテナント＝会社ごとに会社DB）。バック=FastAPI 4層（schemas/repository/application/router）、フロント=Next.js App Router（feature 構成）。設計の正本は `doc/` 配下（要件 FR-xx・データモデル・API設計 A..N・画面 SC-xx）。実装は `impl/`。本セッションは**ブラウザ実機受入で見つかった不具合の修正**が中心（アカウント発行/複製・発見カタログ・情報判定権限UI・情報インプットの添付/要約/版・アイデア添付の版管理デグレ）。

## 3. 今回やったこと（変更ファイルと理由）

### A. アカウント（会社アカウント管理 SC-92/93）
- **複製で発行が 422 になる不具合を修正**（`6fccaa3`）＝一覧応答 `memberships` は `MembershipView`（group_id/role/**name**）で、複製プリフィルにそのまま載せると発行スキーマ `MembershipInput`（`extra="forbid"`・group_id/role のみ）が `name` を弾いて 422。共通ヘルパ **`features/accounts/memberships.ts::toMembershipInputs`**（新規）で `{group_id, role}` に絞り、`AccountSection.tsx`/`AccountSelfSection.tsx`/`AccountFormPanel.tsx` の3箇所に適用（DRY）。**422 の詳細をフロントで表示**（`AccountFormPanel.tsx::issueErrorMessage`／`fieldLabel`＝`errors[].field` を業務ラベル化・該当欄を赤字）。回帰=**B-TC-177**（unit）。
- **発行直後に所属クエストグループ列が「—」のまま**を修正（`02f2fb3`＋カクつき対処 `6289f5d`）＝所属は outbox ワーカが会社DB `users` ミラー生成の後に非同期適用（B.5 step3）。発行成功の `ACCOUNTS_CHANGED_EVENT` で一度しか再取得していなかった。新フック **`features/accounts/useAccountsChangedReload.ts`**（即時＋1.2/3/6s の bounded 遅延再取得）を SC-92/93 両セクションに適用。`useAllAccounts.ts::reload` に **silent オプション**を追加（ローディング表示に切替えず背後で差し替え＝再取得3回のチラつき/カクつき解消）。

### B. 発見カタログ discoverable をクエスト一覧に（`ff01c8d`）
- backend=`quests/schemas.py::QuestCardDTO.discoverable` 追加＋`quests/application.py::_quest_card_dto` で付与（一覧クエリは Quest エンティティ取得済＝追加コスト無）。回帰=**C-TC-252**（api）。**OpenAPI 型再生成**（`impl/frontend/src/lib/api/schema.d.ts`）。
- frontend=`quests/components/QuestListView.tsx` に「発見カタログ」列（掲載=badge-success/非掲載=badge-muted）＋ソート＋enum 絞込。`QuestForm.tsx` の複製プリフィルに `discoverable` を継承（従来は常に OFF 起動）。設計=`doc/画面設計/screens/SC-10_クエスト一覧.md`。

### C. 情報判定権限（info_curator）UI（`2693f85`/`9916da2`）
- **SC-92 会社詳細で“自社”（セッション会社＝表示中会社）を開いたときにもセクション表示**（B対応）＝`admin/companies/[id]/page.tsx` が `isOwnCompany={session.company_id===id}` を渡し、`companies/components/CompanyDetailView.tsx` が true 時のみ `InfoCuratorSection` を描画。`info-curators` API はセッション会社固定＝新 EP 不要。他社では非表示（クロステナント付与は未対応）。
- **UI をクエストグループ管理（SC-90）と同構成に刷新**＝`features/accounts/components/InfoCuratorSection.tsx` を書換＝付与済みユーザーの **DataTable 一覧（行 ⋯ から「情報判定権限を剥奪」）**＋「＋ 権限を付与する」→ **メンバー追加ダイアログ風モーダル**（会社ディレクトリ検索＋もっと見る＋各行「付与」で連続付与）。`dir-*` クラスは `features/qgadmin/qgadmin.css` を再利用。
- **配置＝アカウント一覧の“次”**＝`AccountSelfSection.tsx` に `after` スロットを追加し、SC-93 `admin/accounts/page.tsx` は `after={<InfoCuratorSection/>}`（QuestGroupSection は表の前の `children`）。設計=API N §N.5／SC-92 §4.4／SC-93 §3。

### D. アイデア添付の版管理デグレ修正（`db0314e`・厳格レビュー実施）
- **症状**＝公開中アイデアで本文無変更・**添付だけ変更して保存しても版が付かない**（ユーザーは受入で動作確認済みと証言）。
- **根本原因（git 追跡で特定）**＝`1aed8ad`（2026-09-14・添付の版管理・受入対応）では公開中は保存で常に `_record_revision`。`a57da50`（2026-09-17・無変更保存の版抑制ガード）が `before/after` スナップショット比較を導入した際、**`before` を「`_apply_content` 前のライブ状態」から取得**。だが**添付は保存の前に別 API（POST/DELETE attachments）で適用済み**のため `before` に新添付が入り、本文無変更だと `before==after` で版がスキップ＝ここで回帰。
- **なぜテストで検知できなかったか**＝既存 `D-TC-145` が添付追加と**同時に body も変更**して版を作っており、「添付だけ変更で版が付くか」を検証していなかった（素通し）。
- **修正**＝`ideas/application.py::update_idea` の無変更判定基準を「**直近の記録済み版スナップショット**」に変更（`repo.get_revision(ts, idea.id, idea.current_revision).changes`／publish が rev1 を必ず記録＝基準は常に存在）。回帰テスト **D-TC-234**（添付のみ→版+1／完全無変更→据え置き＝D-TC-229 非回帰）。
- **規約化**＝`doc/規約/テスト規約.md §5.4`（同一結果を生む複数トリガは要因ごとに単独で検証する・抑制ガード追加時は各要因の対照を置く・out-of-band 副作用は直近確定状態を基準に単独検証）を新設（`57e1a33`）。

### E. 情報インプット＝版1記録＋要約短縮＋添付バッチ化＋属性折り畳み（`f990f15`/`94c1d29`）
- **登録直後に版1を記録**（更新履歴が作成時から出る）＝`info/application.py::create_info_item` で `repo.add_revision`。回帰=**N-TC-147**。テスト後始末 `tests/info/test_api.py::_delete_info` に `InfoItemRevision` 削除を追加（FK 順序）。
- **選別用要約を約150字に丸める**＝`quests/summarize.py::summarize_text` に `max_chars` 引数＋`_cap_chars`（句点境界優先・末尾…）。`info/application.py` は `_SUMMARY_MAX_CHARS=150` を create/update の要約生成に適用。チャット要約（FR-39）は既定=無制限のまま。回帰=**N-TC-148**。
- **参考資料の添付を「保存でまとめて反映」に統一**（アイデア D.3 と同仕様）＝`info-input/components/InfoDetailView.tsx` を即時コミットからステージ方式へ＝新規は `newFiles`、既存削除は `removedAttIds`（「削除予定」マーク・元に戻せる）→ `save()` で `addAttachmentsApi`→`deleteAttachmentApi` を適用。**添付変更も「変更あり」に含め、保存成功で `onClose()`**（従来は save が閉じずユーザー体験が不一致だった）。
- **curator の属性を折り畳み（disclosure・既定 open）**＝`InfoDetailView.tsx` の curator 属性編集を `<details className="disclosure ..." open>` に（登録ダイアログの属性 disclosure と同 UI）。設計=API N.4 フロント UX 注記／SC-50 §7。

### F. ダイアログ余白の一定化（`78cf8d6`/`44c7a64`ほか）
- `styles/design-system.css` の `.dialog-label` に **`display:block`**（`<label class="dialog-label">` でも margin-bottom が効く＝見出し→中身の下余白を要素種別に依存せず統一）。入力項目は全て `dialog-section is-quiet`。設計=`doc/画面設計/デザイン標準.md §4.1`。

## 4. 現在の状態
- **本セッションで実行し確認したテスト**（`impl/` で `docker compose run --rm -v "$(pwd)/backend:/app" backend python -m pytest ...`）:
  - `tests/ideas/` = **80 passed**（#8 修正後・D-TC-234 含む）。
  - `tests/info/` = **64 passed**（N-TC-147/148 含む・`_delete_info` 修正後）。
  - `tests/quests/test_api.py` = 13 passed（C-TC-252 含む）。
  - `python3 scripts/check_tc_traceability.py` = ✅ **708件**。
  - frontend `cd impl/frontend && npm run build` = **Compiled successfully**（複数回）。
- **red→green を目視した回帰**: D-TC-234（修正を一時 revert して版が付かず fail）／N-TC-147・N-TC-148（create の版1/要約cap を一時撤回して fail）／B-TC-177・C-TC-252（実装ロジックを素通し版に差替えて fail）。
- **バックエンド E2E（CSRF 付き curl・ACME で実機確認）**: 情報の `POST /info-items` は応答に **版1（content_revisions=1）**、`POST /info-items/{id}/attachments` は**アップロード成功**、`DELETE /info-items/{id}` は 204（版があっても本体 DELETE はカスケードOK）。＝**#1「登録で添付できない」にバックエンド不具合は無い**（登録の添付はステージ→保存で送信される正しい経路）。
- **稼働コンテナ**（本セッションで backend/frontend を複数回 `--build` 再ビルド＝最新コード反映済）: backend/db/redis/mailhog/minio/frontend/worker/mail-worker が Up。
- **壊れているもの**: 認識範囲では無し。

## 5. 詰まっている点 / 未確認 / 未修正の既知漏れ
- **未確認（本セッションで未実施）**:
  - backend の**全**テストスイート（ideas/info/quests 以外）／frontend の**全** vitest／**Playwright e2e**。
  - **本セッションの各修正のブラウザ実機再確認**＝ユーザーが受入中に報告→私が修正した一連（情報詳細の添付バッチ化・属性折り畳み・要約150字表示・発見カタログ列・情報判定権限UI・アカウント複製/所属反映・アイデア添付の版管理）は**コード/自動テストで green だが、修正後のブラウザ確認は次回ゲート**。
  - `#1` の**登録ダイアログでの添付**は backend E2E は健全だが、**ブラウザでの登録→添付→表示は未再確認**（原因が一過性だった可能性）。
- **未修正の既知漏れ（SC-50 §78/§79 突合・低優先）**:
  - ⑤ **未保存で閉じる時の破棄確認（dirty 時）未実装**（§78）＝`InfoDetailView.tsx` フッター「閉じる」は `onClose` 直呼び。**添付をバッチ化した今、閉じるとステージした添付/削除予定が黙って破棄される**＝優先度が上がった。`useConfirm` で dirty（contentDirty/curationDirty/attachmentsDirty のいずれか）時に破棄確認を出す。
  - ⑥ **作成者モードで要約 read が非表示**（§79「要約は全モード共通」）＝`InfoDetailView.tsx` の `!r.can.edit_content && r.summary` 条件。意図的か**要確認**（本文編集中の重複回避の可能性）。
  - ⑦ **一覧⋯「リンクを編集」項目が無い**（§5）＝詳細内「🔗 リンクを編集」はある＝実害小。
  - ※旧 handoff の④（更新履歴 UI 未実装）は**解消済み**＝`InfoDetailDTO.content_revisions` あり・`InfoDetailView.tsx` に「🕘 更新履歴」disclosure あり・create で版1記録（本セッション）。
- **ツール上の詰まり（時短用）**: Edit ツールはテンプレートリテラルや全角特殊文字を含む行を「not found」で外すことがある→`perl -0777 -i -pe` か Python の read/replace/write で置換。テスト seed の FK 違反は依存順に `ts.flush()` を刻む。

## 6. 決定事項と根拠（不採用案も）
- **情報判定権限（info_curator）の付与主体＝会社アカウント管理者＋system_admin**、スコープ＝**セッション会社固定**（`company_id` を受けない）。SC-93 に置き、system_admin が“自社”を SC-92 で見たときも表示（B案）。**不採用=クロステナント EP `/admin/companies/{id}/info-curators`（system_admin が他社の curator を管理）**＝現行は各社の管理者に委任する方針のため見送り（必要になれば新 EP）。
- **アイデア無変更判定の基準＝直近版スナップショット**（ライブの適用前状態ではなく）。理由=添付など out-of-band に適用される副作用も差分検知でき、完全無変更は従来どおり抑制できる（D-TC-229 非回帰）。
- **要約の字数上限＝150字**（ユーザー選択・句点境界優先・末尾…）。チャット要約は無制限のまま（用途別）。
- **情報の参考資料/属性は「保存でまとめて反映」＋保存で閉じる**（アイデア D.3・他ダイアログと統一）。不採用=即時コミット継続（save が閉じない不一致が残る）。
- **複製プリフィルの memberships は入力スキーマに絞る**（`toMembershipInputs`）。不採用=一覧応答をそのまま流用（`name` で 422）。
- （継続）反証通知は宛先=作成者/所有者＋評価者＋クエスト管理者・**要再評価は通知のみ(MVP)**／続報スレッドは root 基準の統合タイムライン＋「表示中」／編集は詳細インライン(PATCH)一本化／フッターは「閉じる/保存する」限定。

## 7. 次にやること（優先順・具体的に）
1. **本セッション修正のブラウザ実機受入**（次回ゲート）＝`http://localhost:3000` を `user@acme.example`(一般) と `kanri@acme.example`(curator/管理者) で。確認対象: ①情報詳細の**添付＝保存でまとめて反映**（追加ステージ/削除予定→保存で確定、保存でダイアログが閉じる）②**登録ダイアログでの添付**（#1 の再確認）③**要約が短い**（150字・詳細/一覧カード）④**更新履歴に版1**が出る⑤**curator の属性が折り畳み**⑥`/admin/accounts` と自社 SC-92 の**情報判定権限UI**（付与ダイアログ/剥奪）⑦クエスト一覧の**発見カタログ列/ソート/絞込**＋複製での継承⑧アカウント**複製→発行**（422 なし・数秒で所属列反映）⑨**アイデア公開中に添付だけ変更→更新履歴に版が増える**。不具合は再現テスト同梱で修正（メモリ `defect-regression-test-policy`・規約 §5.3/§5.4）。
2. **⑤ dirty 破棄確認の実装**（優先度上昇）＝`info-input/components/InfoDetailView.tsx` の「閉じる」に、`contentDirty || curationDirty || attachmentsDirty` のとき `useConfirm` で破棄確認。
3. **⑥ 要約 read の表示条件**＝SC-50 §79 の解釈をユーザー確認のうえ `InfoDetailView.tsx` の表示条件を調整（作成者モードでも要約 read を出すか）。
4. **メモリ `internal-review-remaining-items`（社内レビュー未実施2件）**: ①評価ダイアログにクエスト情報追加、②クエスト最終結果の機能実装。着手前に該当 SC/API 設計を確認。
5. **反証の続き＝要再評価フラグ/リセット**（§3.5）＝成果物(アイデア/評価)側とコンセプト段の設計判断が要る。
6. **コンセプト機能の設計**（メモリ `concept-feature-design-split`・`fr39-iso-mapping-superseded`）。`doc/実装計画.md` で次ドメインを確認。

## 8. 再開に必要な環境情報
- **リポジトリ直下**=`/home/t-umekawa/sc-ideaquest-G2`。compose ファイル=**`impl/compose.yaml`**（`docker-compose.yml` は無い＝罠）。docker コマンドは **cwd=`impl/`**。
- **起動**: `cd impl && docker compose up -d`。コード変更を反映＝**`docker compose up -d --build backend`**（backend はソースをベイク＝ボリューム無・メモリ `backend-no-source-mount`）。frontend 変更も **`docker compose up -d --build frontend`**。schema/DTO 変更時は backend 再ビルド後に `cd impl/frontend && npm run codegen`。
- **ポート**: frontend 3000 / backend 8000（`/api/v1`・health=`/api/v1/health`）/ db 5432 / redis 6379 / minio 9000(API)・9001(console) / mailhog 1025・8025。
- **backend テスト**: `cd impl && docker compose run --rm -v "$(pwd)/backend:/app" backend python -m pytest tests/<domain> -q`（`-v` マウントで**未コミットの app 本体変更も反映**して回せる＝再ビルド不要・本セッションで多用）。**pytest 前に outbox 系を止める**＝`docker compose stop worker mail-worker`（共有 control DB の *_outbox を real sender が drain して干渉するため）→ 終わったら `docker compose start worker mail-worker`。
- **frontend 検証**: `cd impl/frontend && npm run build`（**必須ゲート**＝Next lint 含む・メモリ `frontend-build-gate-eslint`）／`npx vitest run <path>`。
- **TC トレーサビリティ**: `cd <repo root> && python3 scripts/check_tc_traceability.py`（コミット前に ✅ 確認・現在 708件）。
- **ログイン（本セッションで再確認済）**: `user@acme.example` / 会社 `ACME-01` / `Passw0rd!`＝一般。`kanri@acme.example` / `ACME-01` / `Passw0rd!`＝company_account_admin。`admin@ops.example` / 会社 `OPS` / `Passw0rd!`＝system_admin。※認証は **Cookie セッション**（レスポンスに bearer は無い）。状態変更 API は **`iq_csrf` Cookie を `X-CSRF-Token` ヘッダに載せる**（ダブルサブミット）＝curl 検証時は cookie jar から取り出して付与しないと 403 csrf_failed。
- **DB 直接確認**（seed 後始末等）: `docker compose exec -T db psql -U ideaquest -d <dbname> ...`。ユーザー=`ideaquest`/パス=`ideaquest`。DB 名=control=`ideaquest_control`／ops=`ideaquest_ops`／ACME=`ideaquest_company_acme`／ACME2=`ideaquest_company_acme2`／システムコンシェルジュ=`db_systemcon`（会社ごとに命名規則が異なる＝罠。会社詳細画面のバナー「DB:」で確認可）。テナントセッション=`app.db.tenant.get_tenant_session(db_identifier)`。
- **migration**（会社DB）: `impl/backend/migrations/company/versions/`（情報インプット=`0028_info_input`/`0029_info_revisions`/`0030_info_attachments`）。起動時 `scripts/bootstrap.py` が全会社DBへ migrate＋非本番 seed（seed アカウントは DB volume に永続）。
- **設計正本**: `CLAUDE.md`（毎回自動ロード）から各規約・正本へリンク。ドメイン設計=`doc/API設計/{A..N}_*.md`・画面=`doc/画面設計/screens/SC-xx_*.md`・データモデル=`doc/データモデル.md`・テスト台帳=`doc/テスト/*.md`。メモリ index=`~/.claude/projects/-home-t-umekawa-sc-ideaquest-G2/memory/MEMORY.md`。

---
### 自己チェック（本ファイルだけで再開できるか）
- 起動/再ビルド/テスト（-v マウント＋worker 停止の作法）/ログイン（Cookie+CSRF）/ポート/DB名の会社別命名の罠/compose ファイル名の罠=記載済。
- 本セッションの全変更（アカウント・discoverable・情報判定権限UI・アイデア版管理デグレの根本原因と修正・情報の版1/要約/添付バッチ/属性折り畳み・規約§5.4）＝対応ファイル/関数/テストID付きで記載。
- 未確認（全スイート/e2e/修正後のブラウザ受入/#1 のブラウザ再確認）と未修正の既知漏れ⑤⑥⑦、④解消を明記＝過信防止。
- 次アクションはファイル/関数レベルまで具体化（特に⑤ dirty 破棄確認は添付バッチ化で優先度上昇と明記）。
