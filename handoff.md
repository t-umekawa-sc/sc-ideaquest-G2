# handoff.md（セッション引き継ぎ・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる**ことを目標に書く。
> 履歴は git に任せる。事実のみ・未確認は「未確認」と明記・コードは貼らずファイル/関数で示す。

---

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: **2026-09-13 JST**
- ブランチ: **main**（このプロジェクトは main に直接コミット。`feature/game-feel` はゲーム感フェーズ用の別系統）
- 最新コミット: **663ea15** `docs(SC-12): 画面設計に「🏁 結果」タブ（FR-39）を追記`（push 済み）
- 本セッションの主眼＝**社内レビュー反映の続き**。前半＝UI一括改善（管理メニュー集約・グループ表示・パーティー限定編集・一覧/カード・スクロール連鎖・複製引き継ぎ）。後半＝**FR-39「クエストの最終結果＝検証済みコンセプト票（ISO 56002）」を Phase 1〜3 まで完成**＋評価画面のクエスト情報表示＋**FR-39 の正本正規化（要件定義/API C.8/データモデル §5.32/画面設計 SC-12/モック SC-12・SC-24/設計意図メモ）まで完了**。加えて**ステータス後退遷移の許可**・**投票失敗の理由明示**。すべて main に push 済み。

## 2. プロジェクトのゴール
社内アイデア創出をゲーミフィケーションするマルチテナント SaaS「ideaquest」。フロント＝Next.js App Router（`impl/frontend`）、バック＝FastAPI 4層（`impl/backend`）。現在は**社内レビュー反映フェーズ**。

## 3. 今回やったこと（要点・詳細は git ログ §1 の各コミット）
### A. 社内レビュー由来のUI改善（前半）
- 評価画面（SC-25）にクエスト情報＝**「クエストを確認」折りたたみパネル**（目的・テーマ/カテゴリ/締切・「アイデアを確認」と同一UI）。backend＝`IdeaQuestRefDTO.purpose` 追加（D-TC-130 拡張）。commit c2f9fee。
- 複製（SC-11）で**参加グループ＋パーティー（権限/所属込み）を引き継ぐ**（7efa3d2）。
- ダッシュボード未投票カードの**クエスト名リンク化**（349c2ec）。
- クエスト詳細タブ＝**アクティブ強調**（20b5c57）＋**ヘッダー直下 sticky（フローティング）**（dccaaa4）＋**フローティング「戻る」ピルと重ならない段差配置**（1a94ecb 内）。

### B. FR-39 クエスト最終結果＝検証済みコンセプト票（ISO 56002）＝**完了**
> 設計正本＝[doc/設計ドラフト/FR-39_クエスト最終結果_ISO56002.md](doc/設計ドラフト/FR-39_クエスト最終結果_ISO56002.md)（状態=ドラフト・実装済み）／要件定義 FR-39。
- **考え方**：ideaquest は ISO 56002 の①機会特定〜③コンセプト検証を担う（アイデア=創造/チャット=精緻化/評価=検証）。最終結果＝③の締め＝既存3成果物を凝縮した「検証済みコンセプト票」（④開発はアプリ外＝将来拡張）。
- **画面**：SC-12 に「🏁 結果」タブ（`completed` 時のみ・`QuestResultTab.tsx`）。①検証済みコンセプト（選定＋評価平均＋(a)チャットリンク）②検証サマリ（観点別平均・参加指標）③意思決定④議論の要点〔(a)リンク＋(b)ピン留め＋(c)自動要約〕⑤振り返り・学び＋KPI（owner/管理が編集）⑥次アクション＋複製導線。
- **backend**：`quest_outcomes`（migration 0025・総括/KPI/要約キャッシュ）。`GET /quests/{id}/result`（既存集計の合成＋総括・門番C.0・評価visibility尊重）／`PUT /quests/{id}/result`（総括保存・owner/quest_admin）／`POST /quests/{id}/result/chat-summary`（(c)自動要約）。`evaluations.aspect_averages_for_quest`。
- **④通知/フィード**：`completed` 遷移で作成者以外へ通知（新種別 `quest_result_ready`・catalog/service/NotificationsView 追加）＋チーム成果フィードに `quest_completed`（`PUBLIC_FEED_REASONS` 追加・0XPマイルストーン・冪等）。
- **⑥XP**：総括初回記入で XP+20（`quest_result_summary`・クエスト単位1回・冪等）。
- **(b)ピン留め**：`chat_messages.is_pinned`（migration 0026）＋`POST/DELETE /chat-messages/{id}/pin`（owner/quest_admin・完了後も可）。SC-24 に📌トグル＋「📌重要」バッジ。結果に `pinned_messages` 集約。
- **(c)自動要約**：**無料・オフライン抽出型**（`janome`＋自前頻度ベース・`app/tenant/quests/summarize.py`＝将来LLM差し替えseam）。**同期処理**・入力上限500件・外部送信なし。結果タブに「自動要約/再生成」（管理者）。
- **TC**：C-TC-240〜246・E-TC-210・D-TC-130 拡張。
- **表示タイミング（2026-09-13 変更）**：結果タブは**常時表示**＝完了前は「暫定」明示（タブ「暫定」チップ＋進行中バナー）。ISO 56002 §9 継続モニタリングに整合（`GET result` は元来 status 非依存）。commit e8f671e。
- **正本正規化（完了）**：API設計 [C.8](doc/API設計/C_クエスト・パーティー・権限.md)／[データモデル §5.32](doc/データモデル.md)（`quest_outcomes`＋`chat_messages.is_pinned`）／[画面設計 SC-12 §4.5](doc/画面設計/screens/SC-12_クエスト詳細.md)／モック [SC-12](doc/画面設計/mocks/SC-12_クエスト詳細.html)（🏁結果タブ）・[SC-24](doc/画面設計/mocks/SC-24_アイデアチャット.html)（📌ピンUI）／[設計意図メモ](doc/設計ドラフト/FR-39_ISO56002との関係と設計意図.md)。commit 487a477/663ea15。

### C. ステータス後退遷移の許可（commit cc1ee0e・C.5 更新）
- 前進に加え**後退も隣接1段のみ許可**（`completed→evaluating` 等・運用戻し/再検討）。**`recruiting→draft`（非公開化）は不可**（下限 recruiting・unpublish は別概念）。飛び越えは 409。
- **完了の確定物（投稿者コイン/総括XP/完了通知/成果フィード）は後退で取り消さない**（会計・通知の整合）。**再完了は冪等**＝コイン/フィード冪等・**完了通知は初回完了時のみ**。TC＝C-TC-140。

### D. 投票失敗の理由明示（commit ee5dc4f）
- 締切後/完了/公開前/権限などの失敗理由を**サーバーの detail でそのまま表示**（`features/ideas/voteError.ts`）。ダッシュボード・クエスト詳細・アイデア詳細の3画面に適用（409/403=detail 優先・404/401=専用文言）。

**現在の総テスト＝backend 547 passed・TCトレーサビリティ✅（479）**。

## 4. 現在の状態
### 検証済み（本セッションで実測）
- backend フル **547 passed**／TCトレーサビリティ **✅（479）**。frontend `tsc`/`build` OK（各変更で実行）。
- 全コンテナ `docker compose --profile workers up -d --build` でフル起動・ユーザーがブラウザQA実施（UI改善・FR-39 各所・後退遷移・投票文言を目視確認・OK）。
- **注意**：FR-39 で backend 依存に `janome` を追加＝**backend イメージ再ビルド必須**（`docker compose build backend` 済み）。

### follow-up（残）
- **FR-39 の正本正規化・モック追随は完了**（§3B「正本正規化（完了）」参照）。SC-25 もモック反映済み。
- (c) 自動要約は抽出型のため品質は粗い。高品質化は seam（`summarize.summarize_text`）を LLM に差し替え（別途データ保護/コスト方針）。
- ステータス後退の軽微な残：別管理者による再完了時の通知冪等はユーザー単位判定（極端ケースで重複余地・実害小）。必要なら quest 単位判定に強化。
- **画面設計ドキュメントの一部ドリフト**：SC-12 screen doc/mock は「概要」タブが残る（production は レビュー#3 で撤去済み）。FR-39 とは別件の負債（気づいた時に整理）。

## 5. 詰まっている点
- 技術的ブロックは**無い**。
- 教訓：**完了(completed)遷移の副作用（通知/フィード活動）を追加したら、既存テストの teardown で quest_id 参照（Notification.ref_quest_id / Activity.quest_id）を先に掃除**しないと FK 違反で ERROR になる（F テストで顕在化・是正済み）。同様に ChatMessage は ChatGroup 削除前に消す。

## 6. 決定事項と根拠（本セッション追加分）
- **社内レビューの残指摘は memory に記録**（`internal-review-remaining-items.md`）＝①評価ダイアログのクエスト情報（完了）②クエスト最終結果（FR-39・完了）。以前チャットで受けた指摘を保存し損ねた反省から。
- **最終結果＝検証済みコンセプト票**（ISO 56002 マッピング・§3B）。④ソリューション開発のアプリ内実装は将来拡張（今回スコープ外）。
- **(c)自動要約は無料Pythonライブラリのオフライン抽出型**（外部API/課金なし・会社データを外部に出さない）＝同期処理・seam化。
- **複製はパーティーも引き継ぐ**（2026-09-13・旧「引き継がない」を上書き）。
- **ステータス遷移は隣接1段の前進＋後退**（2026-09-13・旧「前進のみ」を上書き）。draft戻し不可・完了確定物は非取り消し・再完了は冪等（§3C）。
- **結果タブは常時表示＋未完了は暫定**（2026-09-13・旧「完了後のみ」を上書き・ISO56002 §9）。
- 管理導線はサイドバー集約／チップのグループは会社全体の全所属を先頭2件＋「+M」表示。

## 7. 次にやること（優先順）
1. **実装計画の残ドメイン**＝`doc/実装計画.md` 順で未接続画面が残れば backend 接続を1画面単位で（現況は `impl/README.md` が正）。着手前に `impl/README.md` で現況把握。
2. UI 微調整の余地（`GROUP_CHIP_MAX`・列幅・要約の文数上限 `max_sentences=5`・要約入力上限500 等）。
3. （任意）SC-12 screen doc/mock の「概要」タブ撤去（production 整合・§4 のドリフト）。

## 8. 再開に必要な環境情報
- **起動**: `cd impl && docker compose up -d --build`（db/redis/minio/mailhog/backend/frontend）。ワーカは `profiles:["workers"]`＝QA フル起動は `docker compose --profile workers up -d --build`。
- **ポート**: backend 8000 / frontend 3000 / db 5432 / minio 9000・9001 / mailhog 8025 / redis 6379。QA は http://localhost:3000 。
- **落とし穴（確認済み）**:
  - backend/frontend コンテナは**ホストコードをマウントしない**＝ソース変更は**イメージ再ビルド必須**（`docker compose up -d --build backend`／`… frontend`）。**依存追加時（例＝janome）も backend 再ビルド必須**。UI を直したら必ず frontend を `--build`。
  - **pytest はホストコードをマウント**＝`docker compose run --rm -v "$(pwd)/backend:/app" backend python -m pytest tests -q`（cwd=`impl`）。**ただし新規 pip 依存はイメージ側に必要**＝先に `docker compose build backend`。ワーカ稼働中は `docker compose stop worker mail-worker` してから。`docker compose run backend …` は entrypoint が bootstrap（DB作成＋migrate＋seed・冪等）を先に走らせる。
  - **codegen**＝先に `docker compose up -d --build backend` → `cd impl/frontend && npm run codegen`。
  - **フラキー時のDBクリーン**＝会社DB drop（`docker compose exec -T db psql -U ideaquest -d postgres -c "DROP DATABASE IF EXISTS ideaquest_company_acme;"` 等）→ 次の bootstrap で再作成。psql ユーザ＝`ideaquest`。
- **frontend 検証**: `cd impl/frontend && npm run codegen && npx tsc --noEmit && npm run build`（build 必須＝Next lint/`<Link>` を tsc/vitest だけだと見逃す）。
- **TC先行 & トレーサビリティ**: TC を `doc/テスト/<ドメイン>_*.md` に先に足す → `python3 scripts/check_tc_traceability.py` ✅（リポジトリ直下）。
- **seed ログイン**: `tests/conftest.py` の `SEED_COMPANY_CODE`/`SEED_LOGIN`/`SEED_PASSWORD`（`ACME-01`/`user@acme.example`/`Passw0rd!`）。権限が要る操作（結果編集/ピン留め/要約）は owner/quest_admin で確認。
- **規約の正本**: リポジトリ直下 `CLAUDE.md`。レビュー反映フェーズ＝main 直コミット。commit/push はユーザー明示時のみ。
- **同種コンポーネントの重複に注意**: アカウント一覧は `AccountSection`（system_admin 横断）と `AccountSelfSection`（自社）の2系統。
