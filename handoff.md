# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-15 JST**
- ブランチ: **main**（受入/レビュー反映＝main 直コミット）。`feature/game-feel` は今回未使用。
- 最新コミット（本 handoff コミット前）: **f3c9541** `fix(e2e): sc-00 MailHog ホスト名・sc-11 参加部署の Multiselect 化に追随`
- **push 状況＝本 handoff コミット前まで全て push 済み**（`origin/main..HEAD` が空だった）。本 handoff もコミット後 push する。

## 2. プロジェクトのゴール
社内アイデア創出をゲーミフィケーションするマルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。現在は**ブラウザ受入フェーズ**＝全画面 backend 接続済み。受入デモデータを `seed_demo.py` で群単位に用意→ブラウザ受入→指摘修正、を実装順 **D→E→G→F→H** で回している。

## 3. 今回やったこと（変更と理由）

### A. レビュー3件→設計ドラフト正本化（将来機能・現バージョンでは未実装）
- **テスト規約 §5.3 新設**（commit e6adb40）＝受入で不具合認定されたら**必ず再現テスト（単体優先・red-green）を修正に同梱**。TCトレーサビリティ検査（`scripts/check_tc_traceability.py`）の走査対象に **vitest（`src/**/*.test.ts`）を追加**（従来は素通りだった穴を封鎖）。memory `defect-regression-test-policy`。
- **コンセプト機能の再設計**（commit 27e83df）＝`doc/設計ドラフト/コンセプト機能_ISO56002_再設計.md`。**FR-39 の ISO 対応マッピングを置換**＝旧「アイデア＝②コンセプト創造／評価＝③検証」は無効。**新＝アイデア段（現行アプリ）＝①機会特定＋アイデアの発散・選別／コンセプト段（新機能・将来）＝②創造＋③検証**（前提の証拠検証・採算 viability・複数コンセプト競合・Go/Pivot/Kill・前提は検証プールを M:N 共有＋検証イベント[方法/結果/判定/実施日/規模]・チャットは総合1＋グループ3〜5＋前提1件=1スレッド）。評価観点は仮採用（desirability/feasibility/viability/前提検証の強さ/差別化）。memory `fr39-iso-mapping-superseded`・`concept-feature-design-split`。
- **情報インプット機能の設計**（commit 36f2e04）＝`doc/設計ドラフト/情報インプット機能_設計.md`。外部WEB情報を**手動貼付**で登録→属性付与（新規権限「情報判定権限」保有者のみ・登録自体は全ユーザー）→アイデア/コンセプトへ**動的リンク**（種別＝関連/裏付け/反証を per-link、情報レベルは影響分類=機会/脅威で併用・反証→要再評価）。設定項目14件（単一選択が既定・複数は情報カテゴリのみ）。ワードクラウド/類似度は janome 再利用・MVP はキーワード/TF-IDF・矛盾自動検出は Phase2。memory `info-input-feature-design`。

### B. FR-39「結果タブ」の位置づけ直し＝**現バージョンに反映（アイデアまでの範囲）**（commit ad33ada）
- 再設計に伴い**現行アプリの文言/正本のみ**を読み替え（**挙動・API契約・識別子は不変**）。「検証済みコンセプト票」→**「アイデア選別の申し送り」**、「①検証済みコンセプト」→「①選定アイデア」、「②検証サマリ」→「②評価・選別サマリ」。正本＝要件定義 FR-39行・SC-12 §4.5・API C.8・データモデル §5.32／UI＝`QuestResultTab.tsx`・`QuestDetailView.tsx`・mock SC-12・schema.d.ts description／backend はコメント/docstring のみ。FR-39 ドラフト2本に「ISO対応は再設計で置換済み」注記（結果タブの構成・段階実装は現行仕様として有効）。

### C. E群受入不具合の回帰テスト（commit e6adb40）＝**完了**
- 受入で認定された E群フロント修正4件（af448c6）に回帰テストが無かったため、中核ロジックを純関数へ抽出して単体化。`features/chat/render.ts`（`renderTextHtml`=①メンション/`resolveMagic`=②game_mode OFF魔法非表示）・`features/notifications/api.ts` の `markNotificationRead`（④）。unit＝`chat/render.test.ts`（E-TC-211/212）・`notifications/api.test.ts`（H-TC-209/210）＋md TC行（defect-ID付き）。red は修正revertで behavior-red 目視→green、`red確認台帳.md` 記録。

### D. G群 seed（commit 6479c22）＝**seed 済み・ブラウザ受入待ち**
- `seed_demo.py` に `seed_g`（魔法解放/ショップ購入・装備/実績/ランキング）＋`Client.put`/`purchase`。owner を HTTP 駆動（owner のみ SP/コイン保有）。dispatch に `g`。

### E. ピン留め不具合（commit ebe6bcb）＝**修正・回帰済み**（受入で検出＝DFT-E-005）
- チャットで📌ピン留め後、マウスホバーが外れてもアクションメニューが消えない。原因＝`chat.css` の `.msg:focus-within .msg__actions{display:inline-flex}`（クリックのフォーカスが残る）。**修正＝`:focus-within`→`:has(:focus-visible)`**。回帰 e2e **E-TC-213**（red-green 目視・sc-24-chat.spec.ts）。
- **ピン留めアニメを style-guide.html §17P に追加**（モック先行）＝ON（📌スタンプ押印＋枠ハイライト）／OFF（浮き上がり回転で peel-off）・reduce 対応。**production 未移植**（受入OK後に `IdeaChatView` へ）。

### F. e2e スイートの大規模ドリフト修正（commits bc949bd〜f3c9541）＝**実 drift は全解消**
- 受入とは別に、e2e が現行アプリから広く drift して大量赤だった。**原因は蓄積した意図的変更**（下記）。以下を修正：
  - **systemic**＝クエスト作成 `quest_group_id`（単数）→`quest_group_ids`（複数・0件=会社全体）（10本）／login 判定「ようこそ」（現在無い文言）→`waitForURL`＋`.app-header`（24本）。
  - **個別**＝ナビ既定ピン留め化（sc-99-appnav）／shop コイン3桁区切り／概要タブ廃止（C-TC-205→ヘッダー検証）／完了フォローは無効化しない（D-TC-214）／戻るラベル動的化（D-TC-213）／完了編集の事前無効化（D-TC-216 は recruiting で開く→API で完了→保存で409に組替、③スナックバーは2026-09-06改定で timer あり）／game_mode OFF のナビは docked（M-TC-005）／自社アカウント管理の検索ボックス2つ（sc-93）／メンバーシップピッカーが Multiselect 化（B-TC-122）／保存成功文言（k-profile）／グループ RowMenu「編集/削除」＋カスタム確認（sc-92c）／MailHog ホスト名（sc-00）／参加部署 Multiselect 化（sc-11）。
- **私の反復実行で溜まった e2e 汚染も掃除**＝ACME-01 の junk グループ9件・クエスト8件を API 削除（受入環境もクリーン化）。

## 4. 現在の状態
- **動いている**: D群デモ・E群デモ・G群デモとも seed 済み。ピン修正はフル再ビルド反映済み。全コンテナ `--profile workers` でフル起動中。
- **テスト**:
  - backend **548 passed**（app/ 無変更＝有効。今回 backend は seed_demo.py とコメント/docstring のみ変更）。
  - frontend **vitest 176 passed**／`tsc` OK／`npm run build` OK。
  - **TCトレーサビリティ ✅ code 509**（vitess 込みに拡張後）。
  - **e2e＝個別・サブセットでは全 green**（例：後半クラスタだけなら 31/33）。**ただしシリアル全実行（99本）は run ごとに 66/73/81 passed とばらつく**＝**残りはアプリ drift でなく「テストスイートの hermeticity 不足」**（〜99本が同一 ACME-01/OPS を直列で叩き、後半で①データ累積のページング②負荷での 5s timeout でフレーク連鎖）。bisect しても単一犯に収束せず（sc-24/25/30-32 は無罪）・回数で結果が変わる＝フレーク確定。**§7 の別タスク**。
- **受入の進捗**（`impl/README` 受入サマリ）:
  - **D群＝✅完了**。
  - **E群（チャット）＝🟡 seed 済み・受入待ち**。②③④修正＋ピン修正の再確認・要（`seed_demo.py e` の出力URL）。魔法/ゲーム層は owner の game_mode を ON に。
  - **G群＝🟡 seed 済み・受入待ち**（`seed_demo.py g`）。
  - **F群（評価）・H群（通知）・その他（メール ADR-0009）＝未着手**（seed_f/seed_h 未実装）。
- **壊れているもの**: 既知の失敗テストは無し（e2e フルランのフレークは上記のとおりアプリバグではない）。

## 5. 詰まっている点（試して失敗した経緯）
- **e2e フルラン full green は未達**＝原因は drift でなく hermeticity（共有テナント直列＋負荷）。timeout 引き上げ・テナント分離・データ cleanup が要る（§7）。個別/サブセットは green なのでアプリは正常。
- ピンの red-green で **frontend 再ビルド直後は warmup で login timeout** が出る＝`curl localhost:3000/login` が 200 を返すまで待ってから e2e 実行。
- e2e は**ホスト実行**（Playwright browsers 導入済み）。baseURL=localhost:3000・MailHog は localhost:8025（docker 内実行なら `MAILHOG_URL=http://mailhog:8025`）。

## 6. 決定事項と根拠（本セッション）
- **受入不具合は必ず回帰テスト化（テスト規約 §5.3）**＝デグレ防止・単体優先。トレーサビリティに vitest を含めた。
- **FR-39 の ISO 対応を置換**＝ピア採点+選定は「選別」であって前提を証拠で de-risk する ISO③検証ではない（ユーザー判断・ISO に忠実）。現バージョンは文言/正本のみ読み替え（挙動不変）、真の②③（コンセプト段）は将来機能。
- **ピンのアクションメニュー消え不具合**＝`:focus-within`→`:has(:focus-visible)`（キーボード可視性は維持・マウスのフォーカスは残さない）。
- **e2e drift は「意図的な仕様変更にテストが追随してなかった」もの**＝spec-is-source-of-truth に従い、多くはテスト側を現行仕様へ更新（設計変更が正）。
- **e2e full green は hermeticity タスクとして分離**（区切り＝ユーザー合意「(1)」）。

## 7. 次にやること（優先順・具体）
1. **E群・G群のブラウザ受入**（あなた＝ユーザーの確認作業）＝`seed_demo.py e`／`g` の出力URLで確認 → OK なら `impl/README` の該当を [x]。ピン修正・②③④修正の再確認も。**ゲーム層は owner のプロフィールで game_mode を ON**。
2. **F群 seed（`seed_f`＝評価・選定）** を `seed_demo.py` に追加＝提出済み評価（5観点＋総評＋公開範囲）を複数評価者で＋owner 選定。要 evaluator 権限付与。
3. **H群 seed（`seed_h`＝通知）**＝2ユーザー発火（メンション/フォロー中コメント/評価/選定/更新）。
4. **その他**＝メール確認 ADR-0009（MailHog `http://localhost:8025`）。
5. **【別タスク】e2e スイートの hermeticity 対応**（full green 化）＝(a) テストごとに専用テナント/ユーザ or 自データ cleanup（共有ユーザを変更しない）(b) グローバル timeout 引き上げ (c) 累積データの定期クリーンアップ (d) シャーディング/並列分離。現状は個別/サブセット green・フルランはフレーク。
6. **【将来機能の実装】** コンセプト機能・情報インプット機能＝設計ドラフト（`doc/設計ドラフト/`）を実体化（データモデル/API/画面 SC-xx・新規 FR 起票）。ピンアニメの production 移植（style-guide §17P → `IdeaChatView`・受入後）。

## 8. 再開に必要な環境情報
- **起動**: `cd impl && docker compose --profile workers up -d --build`（db/redis/minio/mailhog/backend/frontend/worker/mail-worker）。**コード変更後は該当サービスを `--build` で再ビルド必須**（backend/worker/mail-worker は同一イメージ＝`... up -d --build backend worker mail-worker`／backend はホスト未マウント）。frontend も本番ビルド＝CSS/TS 変更は `docker compose up -d --build frontend`（反映後 `curl localhost:3000/login` が 200 を待つ）。
- **ポート**: frontend 3000 / backend 8000(/healthz) / db 5432 / redis 6379 / minio 9000・9001 / mailhog 8025。
- **受入デモデータ生成**: リポジトリ直下から `python3 impl/backend/scripts/seed_demo.py [d|e|g|all]`（ホストの python3＋requests・稼働中 backend 必須・冪等）。**出力の URL を正**。dev ログイン＝`ACME-01`/`user@acme.example`/`Passw0rd!`（user2/user3/kanri も同PW）。**owner=user@ のみ SP/コイン保有・game_mode OFF**（ゲーム層はプロフィールで ON）。
- **frontend 検証**: `cd impl/frontend && npx tsc --noEmit && npx vitest run && npm run build`。
- **e2e（ホスト実行）**: `cd impl/frontend && npx playwright test [e2e/xxx.spec.ts] --reporter=line`（baseURL=localhost:3000・要 backend+frontend 起動）。**フル実行中は手動ブラウザ操作を避ける**（共有状態が競合し後半が連鎖失敗する）。MailHog は既定 localhost:8025。
- **backend テスト**: `cd impl && docker compose stop worker mail-worker` →（cwd=impl）`docker compose run --rm -T -v "$PWD/backend:/app" backend python -m pytest tests -q` → 済んだら worker 再開。
- **TCトレーサビリティ**: TC を `doc/テスト/<ドメイン>_*.md` に先に足す →**リポジトリ直下**で `python3 scripts/check_tc_traceability.py` ✅（vitest 込みで走査）。
- **規約の正本**: リポジトリ直下 `CLAUDE.md` から各規約。**commit/push はユーザー明示時のみ**。main 直コミット。
- **正本の所在**: 要件＝`doc/要件定義/README.md`／API＝`doc/API設計/{README,A..L}.md`／データモデル＝`doc/データモデル.md`／画面＝`doc/画面設計/screens/SC-xx_*.md`＋`mocks/*.html`（style-guide.html §17P にピンアニメ）／実装現況＝`impl/README.md`／実装順＝`doc/実装計画.md`／**将来機能の設計＝`doc/設計ドラフト/`（コンセプト機能・情報インプット・FR-39）**。
- **本セッションの memory 追加**: `defect-regression-test-policy`・`concept-feature-design-split`・`fr39-iso-mapping-superseded`・`info-input-feature-design`。
