# handoff.md — 次セッションの自分への引き継ぎ

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。本ファイルだけで再開できるよう**全文上書き**で維持（履歴は git）。
> 規約の正本＝リポジトリ直下 `CLAUDE.md`（毎セッション自動読込）。設計の正本は `doc/` 配下、実装現況は `impl/README.md`、**残作業の正本は `doc/バックログ/未実装・ギャップ一覧.md`**。

## 1. 最終更新 / ブランチ / 最新コミット
- 更新: 2026-10-10（**ボタンUI統一＝デザイン標準 §66「色＝アクションの種類」を全 feature に strict 適用**するセッション）。
- ブランチ: `main`（worktree 無し＝通常クローン直下 `/home/t-umekawa/sc-ideaquest-G2`）。**main 直コミット/push が本プロジェクトの慣習**（複数セッションが main に直接積む＝§9 の並行注意）。
- **更新開始時点の最新コミット**: `faa84846`（info/auth への §66 第一バッチ）。※前回セッションは WSL クラッシュで handoff を更新できずに終了したため、開始時の handoff は約5コミット stale だった（本更新で解消）。
- **更新時点の最新コミット**: `40dc6ec7`（本セッション3コミット目）。本ファイル＋台帳のコミットはこの直後に作成・push する。
- **未コミット変更**: `handoff.md` と `doc/バックログ/未実装・ギャップ一覧.md` のみ（このコミットで push 予定）。ソースは全て commit 済み。
- **push 状況**: `origin/main` は `1bbfe9db`（別セッションが G2 ポートフォリオ設計で push）。**本セッションの3コミット（`f51ad2f7`/`abdff9ec`/`40dc6ec7`）は未 push**＝本更新と合わせて push する。
- alembic heads: **本セッションで migration 変更なし**（未再確認。前回記録＝company `0067_company_ai_settings` / control `0020_signup_challenges`）。

## 2. このプロジェクトのゴール
ISO56001 準拠のアイデア/イノベーション管理 SaaS（マルチテナント＝control DB＋会社別DB・ゲーミフィケーション）。直近フェーズ＝ユーザー指摘の消化＋仕様確定済み未実装の処理。本セッションは横断 UI 標準（ボタン色 §66）の全画面適用を実施。

## 3. 今回やったこと（新しい順・理由つき・コミット）
前提＝前セッションで `faa84846` が **デザイン標準 §66「色＝アクションの種類」を明文化**し、第一バッチ（ユーザーメニュー/ログアウト/情報ダイアログ SC-50/51/52＝info/auth）に適用済み。本セッションは**残り全 feature への適用**。

- **解釈の確定（strict・ユーザー決定）**＝§66 を strict に適用。全 feature（25）を**並列サブエージェントで2度監査**（初回は edit/開く/遷移/生成の見落としがあり、strict ルールを明示して再監査）。
- **第二バッチ（ideas/quests の確信分）＝`f51ad2f7`**＋**台帳 `X2` 起票**（クラッシュ耐性のため監査結果をチェックリスト化）。却下/拒否→danger・申請を取り消す→outline・フィルタトグルの danger 誤用→修正。
- **第三バッチ（strict 全 feature 一巡）＝`abdff9ec`**（14 ファイル）。feature 別内訳は台帳 X2 参照。要点＝編集/前方遷移/生成(AI評価生成含む)/ダイアログを開く→primary、却下/退出/剥奪→danger。
- **取りこぼし修正（ユーザー実機レビュー指摘）＝`40dc6ec7`**。前方遷移「→」(前提スレッド/このグループを議論/コンセプトタブへ)→primary／リンク解除→danger／カスタム class `ri-head__btn`(関連情報を追加/全画面で一覧)を標準 `.btn` へ統一。**投票の賛成/反対は専用 `.vote-btn` で §66 対象外＝未変更**（確認済み）。
- **台帳**＝`X2` を「ほぼ完了・残=要確認5件」に更新。
- 変更 feature（ソース）＝quests(QuestForm/QuestCatalogView/QuestResultTab/QuestDetailView/JoinRequestDialog)・ideas(IdeaDetailView)・concepts(ConceptDetailView/AssumptionCard)・contests(ContestDetailView/ContestJoinRequestDialog)・projects(ProjectDetailView/ProjectPartyPicker)・strategy(StrategyQuestLinks)・accounts(AccountSelfSection/CapabilitiesSection)・chat(IdeaChatView)・info-input(RelatedInfoPanel)。

## 4. 現在の状態（動作 / テスト）
- **ビルド**＝`cd impl/frontend && npm run build` ✓ Compiled（警告は既存の DataTable useMemo/aria 系＝本件と無関係）。
- **TC トレーサビリティ**＝✅ 1134（テストファイル未変更＝本件は純粋な variant 差し替え）。
- **目視**＝`style-guide.html` で primary/outline/danger の描画確認。加えてユーザーが**実機（コンセプト詳細 `/concepts/{id}`）をレビュー**し、前提スレッド/関連情報を追加/このグループを議論→primary・リンク解除→danger を指摘→`40dc6ec7` で反映。
- **Docker**＝本セッションで `cd impl && docker compose up -d` で起動し frontend を `--build` 済み・稼働中（次回は要再確認）。
- **未検証**＝フル `tests/` 未実行／**e2e 未実行（破壊的なので回避）**／変更ボタンの一部は特定データ状態（保留中 join リクエスト・コンテスト参加リクエスト・自分の保留申請・所有クエストのメンバー付きパーティ等）が必要で**既定シードの `kanri@acme` では実機到達できず未確認**（variant 描画自体は既存流用＋style-guide で確認済み＝描画リスクは実質ゼロ）。

## 5. 詰まっている点 / 未確認
- **変更ボタンの実機目視が一部未完**＝上記の特定状態が既定シードで作れず未到達（次回の最優先＝ユーザー要望の目視チェック）。
- **要確認5件（台帳 X2）**＝おすすめトグル／経営資料コピー・DL／帳票ボタン(⬇青で primary 化不可)／すべて既読／MembershipsEditor セグメント。いずれも現状 outline 据え置き・ユーザー判断待ち。
- **未処理の監査引継2件**（§9）＝本セッションでは**コード裏取り未実施＝台帳へ未 triage**。
- alembic heads を本セッションで再確認していない（migration は触っていない）。

## 6. 決定事項と根拠（本セッション）
- **§66 解釈＝strict（ユーザー決定 2026-10-10）**＝prominence ではなく**意味**で色を決める（1画面に青が複数あってよい）。編集(編集画面/モード/ダイアログを開く)・前方遷移(詳細を開く/〜へ/スレッドへ)・生成(AI評価生成/再生成含む)・選ぶ/紐づける/追加(別ダイアログを開く)＝**primary**／却下・削除・退出・除外・無効化・剥奪・**リンク解除**＝**danger**／閉じる・キャンセル・戻る・編集を終える・ページング(次へ/前へ/もっと見る)・**下書き保存**・画像クリア/削除(既定へ戻す)・すべて既読＝**outline**。
- **AI評価を生成/再生成＝primary**＝§66「生成＝青」。info-input の「要約生成/キーワード抽出＝青」と全系統で整合（これらは primary のままが正＝batch 1 を変更しない）。
- **フィルタ/状態トグル**＝base=outline・active(aria-pressed)=primary（danger は使わない）。
- **投票の賛成/反対＝専用 `.vote-btn`（§66 対象外・未変更）**。ゲーム層 `.btn-pixel`(shop/spells/avatar)も対象外。
- **帳票ボタン(AccountSelfSection:300)**＝⬇ アイコンが `--color-primary`(青)のため primary(青地)化すると潰れる＝**outline 維持**。
- **カスタム pill は標準 `.btn` へ統一**（例 `ri-head__btn`→`btn btn-primary/outline btn-sm`）＝設計システム一本化。
- 非採用＝(a) 保守的解釈（編集/開く/遷移を outline 据え置き）→ユーザーが strict を選択。(b) 到達困難な状態のシード作り込み→コスト過大につき style-guide 確認で代替（ユーザー合意）。

## 7. 次にやること（優先順・ファイル/関数レベル）
> 着手前に実コードで裏取り。残作業の正本＝`doc/バックログ/未実装・ギャップ一覧.md`。
1. **【最優先・ユーザー要望】ボタンの実機目視チェックから再開**＝`kanri@acme.example`(`ACME-01`/`Passw0rd!`) でログインし、本セッションで変更した画面を確認（特に未到達だった状態＝コンテスト パーティタブの退出/再承認、join リクエスト拒否ダイアログ、クエスト結果タブの自動要約/編集/複製起票、アイデア詳細の編集/昇格/AI評価）。崩れ・意味不一致があれば修正。**台帳 X2 の「残=要確認5件」をユーザーと確定**（おすすめトグル／経営資料コピー・DL／帳票ボタン／すべて既読／MembershipsEditor）。確定で X2 を更新、全消化なら X2 行を削除。
2. **監査引継2件の受領→台帳 triage**（§9）＝`2026-10-10_バグ監査-ソース解析-セキュリティ.md`（A-1 機能バグ＝最優先・B-1/B-2 セキュリティ hardening・C 群 stale コメント）と `2026-10-10_全ソースコード品質セキュリティ監査.md`（AUDIT-xxx・重複注意）。**各項目を実コードで裏取りしてから出典付きで起票**（`(出典: セッション調整/引継/...)`）→消化。
3. 以降は台帳の未着手＝**D8**(プロジェクト管理拡張 Phase A)／**G2/G3**(ISO ポートフォリオ/指標・G2 は別セッションが設計中)／**D2/D3**／**F7**(concepts レガシー掃除)／**D6(B)** 等（優先順・未確定点は台帳の各行＋着手時ユーザー確認）。
4. 完了時＝`impl/README.md` 現況更新・台帳から完了行削除・handoff 全文更新。

## 8. 再開に必要な環境情報
- 作業ディレクトリ：`/home/t-umekawa/sc-ideaquest-G2`（実装 `impl/`・frontend `impl/frontend`・backend `impl/backend`・帳票 `impl/jasper`）。Docker Compose プロジェクト＝`impl`（コンテナ `impl-backend-1` 等）。
- 起動：`cd impl && docker compose up -d`（dev）。backend=`:8000`・frontend=`:3000`・MailHog=`:8025`・MinIO=`:9000/:9001`・db=`:5432`・redis=`:6379`。
- **フロント反映はソースベイク**＝`cd impl && docker compose up -d --build frontend`（`npm run build` だけでは `:3000` に反映されない）。backend 再ビルド後の型再生成＝`cd impl/frontend && npm run codegen`。
- テスト：
  - frontend ゲート＝`cd impl/frontend && npm run build`（必須）／`npx vitest run <path>`／e2e `npx playwright test <spec> -g "<TC>" --workers=1`。
  - backend（ベイク）`cd impl && docker compose exec -T backend pytest <path> -q`。未コミット/新規テスト反映は `docker compose run --rm -T -v "$(pwd)/backend:/app" backend pytest <path> -q`。
  - TC トレーサビリティ：`cd /home/t-umekawa/sc-ideaquest-G2 && python3 scripts/check_tc_traceability.py`（リポジトリ**ルート**で実行）。
- 目視検証の型：`impl/frontend` に使い捨て `_*.mjs`（Playwright chromium）を作り**使い終わったら削除**。ログインは hydration 待ち必須（`#company_code`/`#login_id`/`#password` を fill 前に ~1.3s）。モック目視は `file://` で `doc/画面設計/mocks/*.html`（`style-guide.html` にボタン §3 の見本）。
- ログイン（PW いずれも `Passw0rd!`）：一般 `ACME-01`/`user@acme.example`／会社管理 `ACME-01`/`kanri@acme.example`／OPS `admin@ops.example`。
- **DB/テストデータ注意**＝共有 dev DB は非冪等。**フル e2e は会社DBを DROP→bootstrap する破壊的操作**＝セッション終了目的で実行しない（本セッションも未実行）。

## 9. 残作業・並行開発への参照
- 残作業の正本＝**`doc/バックログ/未実装・ギャップ一覧.md`**（本セッションで X2 を起票・更新）。次回確認＝**X2 残=要確認5件**／監査引継2件の triage／D8・G2・G3・D2・D3・F7・D6(B)。
- **並行開発**＝別セッションが **G2 イノベーションポートフォリオ**を設計中で main に push 済み（`1bbfe9db`＝引継 `2026-10-10_イノベーションポートフォリオ-G2.md`＋設計ドラフト）。台帳 `G2` 行の状態更新は**その実装セッションの担当**＝本セッションは触っていない。push 前に `git fetch`/`git log` で競合確認。
- **未処理の引継（次回要対応）**＝`2026-10-10_バグ監査-ソース解析-セキュリティ.md`・`2026-10-10_全ソースコード品質セキュリティ監査.md`（いずれも読み取り専用監査＝**実装セッションがコード裏取り→台帳 triage→消化**／本セッション未着手）。`2026-10-09_プロジェクト管理機能拡張.md`（→台帳 D8/F4・未消化）。`2026-10-09_リッチテキスト2系統統一-tiptap移行.md`（→F7 出典）。
- 並行開発の取り決め＝`doc/セッション調整/並行開発の取り決め.md`（記載のブランチ名/担当が現在も有効かは実行時に確認）。
