# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-24 JST**
- ブランチ: **main**（本 handoff の docs コミット＝tip・push 済。それ以外の作業ツリーは clean）。
- **本セッションは設計ドキュメントのみ（`doc/` 配下）＝`impl/`〔実装コード〕は一切変更していない**。
- 最新コミット（新→古／tip は本 handoff 更新コミット）:
  - `docs(handoff)` セッション終了・handoff 全文更新（本コミット）
  - `00027a8` docs(concept): コンセプト投票（賛成/反対＋XP+5）を追記（FR-42）
  - `913053d` docs(concept): スコープ境界を確定・追記（クエストの範囲／横断は収束クエスト／④⑤はPM領域）
  - `6b37297` docs(concept): コンセプトAPI設計ドラフト（ドメインP・FR-42）
  - `d76e3be` docs(concept): コンセプト段データモデル第一版（FR-42・§5.38-5.45＋enum6種＋チャット一般化）
  - `2adbac1` docs(concept): ISO56002 §8.3 原本突合を反映（評価軸/価値実現モデル/Go-Pivot-Kill注記）
  - `252960e` docs(requirements): FR-42 コンセプト創造・検証（ISO56002 ②③段）を起票
  - `f8def7b`（前セッションの tip）docs(handoff): FR-41 Phase2 完了で全文更新
- コミット方針: ユーザーが「コミット/プッシュして」と言うまで実行しない。**1スライス=1コミット**。末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

## 2. プロジェクトのゴール
社内アイデア創出のゲーミフィケーション Web アプリ **IdeaQuest**（マルチテナント＝会社ごとに会社DB）。バック=FastAPI 4層（schemas/repository/application/router）、フロント=Next.js App Router（feature 構成）。設計の正本は `doc/` 配下（要件 FR-xx・データモデル・API設計 A..P・画面 SC-xx）。実装は `impl/`。

## 3. 今回やったこと＝**FR-42「コンセプト創造・検証（ISO56002 ②③段）」の設計を起票→データモデル→API→スコープ境界→投票 まで**
本セッションは新機能 FR-42 の**設計フェーズ**。実装（`impl/`）には未着手。正本ドラフト＝[`doc/設計ドラフト/コンセプト機能_ISO56002_再設計.md`](doc/設計ドラフト/コンセプト機能_ISO56002_再設計.md)。

### 3-0. 前段＝「社内レビュー残」は両方とも実装済みと判明
- 着手前に「社内レビュー残（①評価ダイアログにクエスト情報 ②クエスト最終結果）」を裏取り→**両方実装済み**（①=commit `c2f9fee`／②=FR-39 の QuestResultTab＋backend＋通知/フィード/XP 全実装）。
- **FR-39 の ISO 見直し（検証済みコンセプト票→アイデア選別の申し送り）も既に適用済み**（commit `ad33ada`・正本＋impl 網羅）。旧語の残りは migration `0025` docstring のみ（履歴・非スキーマ）。
- → メモリ `internal-review-remaining-items` を削除、`fr39-iso-mapping-superseded` を「見直し済・残はコンセプト機能」に更新。

### 3-1. FR-42 起票（`252960e`）
- [`doc/要件定義/README.md`](doc/要件定義/README.md) §6 に **FR-42 行**（優先度 Should・【設計ドラフト】・FR-41 直後）。

### 3-2. ISO 56002 §8.3 原本突合（`2adbac1`）
- Web で ISO 56002:2019(E) 原本 PDF を取得し §8.3 本文を抽出・突合（工程名 8.3.2〜8.3.6・評価軸・assumptions 中核性・検証手段）。
- **訂正確認**＝desirability/feasibility/viability は **ISO §8.3.3 b) に明記**（当初「デザイン思考由来」は誤り）。`"Go/Pivot/Kill"` は当社ラベル（ISO は反復検証＋選定）。
- ドラフト §1 に突合ノート／§3.3 viability を「価値実現モデル」に／§3.6 評価観点に novelty/sustainability/IP 追加（中核5＋補助3）。

### 3-3. データモデル第一版（`d76e3be`）＝[`doc/データモデル.md`](doc/データモデル.md)
- **enum 6種**（§3）＝`concept_status`/`concept_decision`/`assumption_verdict`/`concept_criticality`/`concept_eval_aspect`/`concept_chat_scope_kind`。
- **テーブル §5.38〜5.45**＝`concepts`／`concept_source_ideas`／`assumptions`／`assumption_validations`／`concept_assumption_links`／`concept_evaluations`／`concept_evaluation_scores`／`concept_chat_scopes`。
- **チャット一般化（最小侵襲）**＝`chat_messages`（§5.16）/`chat_reads`（§5.31）に `concept_chat_scope_id`（NULL可）追加＋`chat_group_id` を NULL 可へ緩和＋CHECK 排他。

### 3-4. コンセプト API 設計ドラフト（`6b37297`）＝新規 [`doc/API設計/P_コンセプト.md`](doc/API設計/P_コンセプト.md)（ドメイン **P**）
- P.0 门番／P.1 取得／P.2 登録・編集・遷移・選定・判定／P.3 前提（検証プール）／P.4 前提リンク／P.5 評価／P.6 チャット／P.7 反証波及／P.8-10。README §2 表＋詳細に P 追加。

### 3-5. スコープ境界の確定（`913053d`）
- ドラフト §1.1 新設＋FR-42／API P.0／データモデル §5.38-45 intro に同期（下記 §6 参照）。

### 3-6. コンセプト投票＋XP（`00027a8`）
- ドラフト §3.4/§3.8 にあった「投票」を第一版で落としていた抜けを補完。`concept_votes`（§5.46）＋API P.5b＋要件 XP 表＋`activity_ref_type=concepts`。投票 XP+5（参加促進）。

## 4. 現在の状態（本セッションで確認）
- **`impl/`（実装コード）は一切変更なし**＝FR-41 Phase2 完了時点（前 handoff `f8def7b`）から動作は不変。稼働・テスト状況は前回から変わっていない。
- **稼働コンテナ**＝**全 exited（停止中）**。本セッションは docs のみのため起動していない。再開時は §8 の起動コマンドで復帰。
- **テスト**＝docs のみ変更＝テストコード無変更。**TC トレーサビリティ 755件 ✅**（本ターンで `python3 scripts/check_tc_traceability.py` 実行し確認・本セッションで TC 追加なし）。
- **壊れているもの**＝無し（コード無変更）。
- **未確認**＝backend/frontend/e2e の再実行（コード無変更のため今回は不要と判断・未実行）。

## 5. 詰まっている点 / 試して失敗したこと（＝次回同じ轍を踏まない）
- **投票を設計から落としていた**＝データモデル/API 第一版でコンセプト投票を実装し忘れ、ユーザー指摘で発覚（`00027a8` で補完）。**教訓＝コンセプト段を実体化する時はドラフト §3.4/§3.8 の「ループ機構＝議論／投票／評価／結果タグ／版／通知／realtime」を必ずチェックリストにする**（アイデア段と同型に揃える）。
- **画面構造の質問を一度リジェクトされた**＝先に「クエストをまたぐコンセプトを想定すべきか」を議論したいというユーザー意図だった。→ スコープ境界（§6）を確定してから画面へ、が正しい順序だった。
- **ISO 原本 PDF は WebFetch では中身が取れない**（圧縮 PDF）＝ローカル保存後 `pdftotext -layout` で抽出できた（`/usr/bin/pdftotext` 使用可）。原本 URL＝`https://www.presidencia.gob.cu/media/filer/public/2022/10/12/iso_56002_2019.pdf`（§8.3 本文あり）。

## 6. 決定事項と根拠（不採用案も）
- **スコープ境界（最重要・§1.1）**＝**クエスト＝ISO ①②③で1サイクル**。**④ソリューション開発・⑤導入はクエスト外＝プロジェクト管理（WBS/タスク）領域**（根拠＝ISO 原本 §8.3.5 出力が "plans with activities, resources, timing"＝WBS・仕事の質が探索→デリバリに変わる・ゲーム感が馴染まない）。コンセプトは go 判定まで出して**受け渡す成果物**。
- **コンセプト＝クエスト内**（1クエスト＝1イニシアチブ＝検証プールの単位）。**クエスト横断コンセプトは直接作らない**（門番＝パーティー AND クエストグループ所属の単一モデルを崩さない＝漏えい防止）。**横断は「収束クエスト」**（複数ソース取り込みの後続クエスト＝FR-39 継ぎ目の一般化）で実現。**quest merge は不採用**（ライフサイクル結合が濁る・粒度粗・不可逆）。
- **viability＝jsonb**（価値実現モデル・柔軟構造）。構造化列は不採用（初期の項目変更に弱い）。
- **`concepts.decision`（go/pivot/kill）と `is_selected` は別列**（コンセプト自身の判定 vs owner の勝ち残り選定は別概念）。
- **チャット一般化＝最小侵襲拡張**（`concept_chat_scope_id` 追加）。`chat_rooms` 全面リファクタ・別テーブル複製は不採用（DRY）。
- **評価観点＝中核5＋補助3（ISO §8.3.3 b 準拠）**。中核必須・補助任意の2段。
- **投票＝賛成/反対（アイデア同型）＋XP+5**（参加促進・ユーザー決定）。N 個競合ゆえの「推し/ランキング」は不採用（機構共有・一貫性で賛成/反対が有利）。**評価/選定/投稿の XP・コインは実装時に判断**（第一版は投票のみ付与）。
- **API ドメインレター＝P**（A〜O 使用済み＝M 共通シェル・N 情報インプット・O システムログ／テスト接頭辞 P-TC）。
- **チャット API＝P にスコープ単位EP**（`/concept-chat-scopes/{id}/messages`・機構は E 再利用・E 無改修）。E 全面一般化は不採用（確定済み E のルート契約を触らない）。
- **情報リンクは各 read に委譲**（`GET /concepts|assumptions/{id}` に合成・N.1 委譲方針＝横断EP増やさない）。
- **画面構造（ユーザー確定）**＝**SC-12 に「🧩 コンセプト」タブ**（一覧＋検証プール）／**SC-60 登録・編集モーダル**／**SC-61 コンセプト詳細フルページ**／**SC-62 評価モーダル**（アイデアの SC-21/22/25 と対称）。詳細はモーダルでなくフルページ（情報量が多い）。

## 7. 次にやること（優先順・具体的に）
1. **SC-61 コンセプト詳細（フルページ）の画面設計書を新規作成**＝`doc/画面設計/screens/SC-61_コンセプト詳細.md`（未作成）。**レイアウトはユーザーに提示済み（投票込み）だが最終OKを取る前にセッション終了＝再開時にレイアウトを再提示して確定**してから書く。提示済みレイアウト＝**ヘッダー**（クエスト名パンくず／コンセプト名／status／Go-Pivot-Kill バッジ／★選定／由来アイデアchip／編集・活性化/保管）＋**メイン**（課題機会／価値提案+対象／競合差別化／解の形態+能力／viability／**前提と検証＝核心〔前提ごとに重要度・現在判定・検証履歴・stale・＋リンク〕**／🔗関連情報ストリップ〔`RelatedInfoPanel` 流用〕）＋**右レール**（**投票**〔賛成/反対・XP+5〕／総合判定〔Go/Pivot/Kill+根拠〕／評価結果〔中核5+補助3・推奨分布・評価する→SC-62〕／メタ）＋**下部＝議論ルーム タブ**（総合/グループ3-5/前提スレッド・チャットは機構共有）。参考＝SC-22（`doc/画面設計/screens/SC-22_アイデア詳細.md`）の構成に対称化。
2. **SC-12 に「🧩 コンセプト」タブを追記**＝`doc/画面設計/screens/SC-12_クエスト詳細.md`（§4.5 結果タブの並びにタブ追加・一覧＋検証プールへの導線）。
3. **SC-60 コンセプト登録・編集モーダル**・**SC-62 コンセプト評価モーダル**の画面設計書（`doc/画面設計/screens/`）。SC-60=由来アイデア選択＋スキーマ入力／SC-62=中核5+補助3スコアリング＋Go/Pivot/Kill 推奨（SC-25 評価モーダルと同型）。
4. **画面遷移図に反映**＝`doc/画面設計/画面遷移図.md`（SC-12 コンセプトタブ→SC-60/61/62 の動線・情報インプット SC-50 系の並びに追加）。
5. **テスト設計（TC 先行）**＝`doc/テスト/P_コンセプト.md`（新規・接頭辞 **P-TC**）→ その後 **実装**（migration でデータモデル §5.38-5.46 を追加 → backend 4層 → frontend はモック先行＝フロントエンド実装フロー規約）。
6. **付随（コンセプト実装と同時に必須）**＝関連リンク対象ピッカーに `concepts`/`assumptions` を追加（backend `impl/backend/app/tenant/info/repository.py::search_link_candidates` が現状 concepts/assumptions で `else: return []`・ドラフト §4 ⚠️）。
- 正本の相互参照は張り済み（FR-42／ドラフト／データモデル §5.38-5.46／API P が相互リンク）。**ER 図（データモデル mermaid）へのコンセプト8テーブル反映は未着手**（テーブル定義が正・図は追随・次アクション）。

## 8. 再開に必要な環境情報
- **リポジトリ直下**=`/home/t-umekawa/sc-ideaquest-G2`。remote=`origin`（GitHub `t-umekawa-sc/sc-ideaquest-G2`）。compose=**`impl/compose.yaml`**（`docker-compose.yml` は無い＝罠）。docker は **cwd=`impl/`**。
- **起動**: `cd impl && docker compose up -d`。**frontend/backend はソースをベイク（volumes 無）**＝コード反映は **`docker compose up -d --build frontend`**（または backend）。**migration/`_SEEDS` 追加後は `--build backend`**（entrypoint が bootstrap＝DB作成/migrate/seed を毎起動・冪等）。**worker/mail-worker は `profiles: ["workers"]`**＝`docker compose up -d worker mail-worker` で明示起動。
- **frontend 検証**: `cd impl/frontend && npm run build`（必須ゲート＝Next lint 含む）。**backend の API 型を変えたら `npm run codegen`**（openapi→`src/lib/api/schema.d.ts`）。
- **backend テスト**: `cd impl && docker compose run --rm -v "$(pwd)/backend:/app" backend python -m pytest tests/<domain> -q`（`-v` で未コミット反映）。**pytest 前に `docker compose stop worker mail-worker`**（*_outbox 競合回避）→終わったら start。
- **e2e（Playwright）**: **必ず `cd /home/t-umekawa/sc-ideaquest-G2/impl/frontend` から** `npx playwright test e2e/<spec> --workers=1`（フルスタック起動＋frontend `--build` が前提）。認証は **storageState 方式**（`e2e/auth.setup.ts`）。
- **TC トレーサビリティ**: `cd <repo root> && python3 scripts/check_tc_traceability.py`（前回 755件・TC-ID＝`[A-Z]-TC-\d{3}`）。**TC はコードより先に `doc/テスト/<ドメイン>_*.md` に行追加**（`根拠` 列付き）。コンセプトの接頭辞＝**P-TC**。
- **ドキュメント抽出補助**: 圧縮 PDF の本文は `pdftotext -layout <pdf> <out.txt>` で抽出可（ISO 原本など）。
- **ポート**: frontend 3000 / backend 8000（`/api/v1`・health=`/healthz`）/ db 5432 / redis 6379 / minio 9000・9001 / mailhog 1025・8025。
- **ログイン**: `user@acme.example`/`ACME-01`/`Passw0rd!`＝一般。`kanri@acme.example`＝company_account_admin。`admin@ops.example`/`OPS`＝system_admin。状態変更 API は `iq_csrf` Cookie を `X-CSRF-Token` に載せる。
- **DB 名（罠）**: control=`ideaquest_control`／ops=`ideaquest_ops`／ACME=`ideaquest_company_acme`／ACME2=`ideaquest_company_acme2`／システムコンシェルジュ=`db_systemcon`。ユーザー/パス=ideaquest。
- **設計正本/メモリ**: `CLAUDE.md`（毎回自動ロード）から各規約・正本へ。メモリ index=`~/.claude/projects/-home-t-umekawa-sc-ideaquest-G2/memory/MEMORY.md`（本セッションで `fr42-concept-stage` 追加・`fr39-iso-mapping-superseded` 更新・`internal-review-remaining-items` 削除）。FR-42 の全経緯＝メモリ `fr42-concept-stage`。

---
### 自己チェック（本ファイルだけで再開できるか）
- FR-42 の到達点（起票→ISO突合→データモデル §5.38-5.46→API ドメインP→スコープ境界→投票）と**次＝画面設計（SC-61 詳細フルページ→SC-12 タブ→SC-60/62 モーダル→遷移図→P-TC→実装）**をファイル/関数レベルで記載。
- 主要な設計決定（スコープ境界＝④⑤はクエスト外/横断は収束クエスト／viability=jsonb／チャット最小侵襲／評価は中核5+補助3／投票+XP／ドメインP）を根拠付きで §6 に記録。
- 本セッションは **docs のみ・impl 無変更**＝動作は前 handoff（FR-41 Phase2 完了）から不変、コンテナは停止中、を明記。
- 起動/再ビルド/テスト/TC/ログイン/ポート/DB名罠/compose ファイル名罠/pdftotext＝§8 に記載。
- 失敗した点（投票の実体化漏れ＝ドラフト §3.4/§3.8 ループ機構チェック／画面質問の順序／ISO PDF 抽出法）を §5 に記録＝再発防止。
