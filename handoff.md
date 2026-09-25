# handoff.md（セッション申し送り・全文上書き運用）

> 読者＝このセッションの記憶が無い次回の自分。会話ログは参照不可。**本ファイルだけで再開できる状態**を目指す。
> 各種正本＝`CLAUDE.md`（規約参照元）／`doc/実装計画.md`（実装順）／`impl/README.md`（実装現況）／`doc/フェーズ毎ルール/`。

## 1. 最終更新 / ブランチ / 最新コミット
- 最終更新: 2026-09-25
- ブランチ: `main`（`origin/main` と一致＝**未プッシュのコミットは無い**。※本 handoff コミット直前時点）
- 最新コミット（プッシュ済）: `ebe9958 refactor(iso): ISO 56002:2019 → 56001:2024 準拠へ全面改訂`
- 直近の流れ: `ea70b55`（ガイダンスⓘ高さ/縦位置一致・DPR対策）→ `ba4f0bf`（テスト規約§5.5 新設）→ `ebe9958`（ISO56001化）。
- **本セッションで積んだ未コミット作業は、この handoff と一緒にコミットして終える**（§3(B)参照）。

## 2. プロジェクトのゴール
ゲーミフィケーションされたアイデア/コンセプト管理 Web アプリ（マルチテナント・FastAPI 4層 + Next.js App Router）。現在は **FR-42「コンセプト創造・検証（ISO 56001 ②③段）」** の frontend 実装フェーズ。直近の焦点は **コンセプト議論チャットを「アイデアチャットと完全同一（フル機能パリティ）」にする共通化リファクタ**。

## 3. 今回やったこと（変更ファイルと理由）
### (A) コミット済み・プッシュ済み（本セッション）
- **ガイダンス ⓘ の高さ/縦位置ズレ修正**（`ea70b55`）＝`impl/frontend/src/styles/design-system.css` の `.screen-purpose`/`__pop` を **固定 `--sp-h:30px` ＋上下ボーダーを box-shadow ＋ pop を `top:0`** に。理由＝Windows 150%拡大(DPR1.5)で `top:-1px` のサブピクセル丸めが 0.33px ズレたため。`doc/画面設計/mocks/style-guide.html`「4d」と `doc/画面設計/デザイン標準.md §4.13` も同期。
- **テスト規約 §5.5 新設**（`ba4f0bf`）＝`doc/規約/テスト規約.md`。不具合対応方針＝**デザイン崩れ修正は目視スクショ検証を必須**（数値測定だけを根拠にしない）。
- **ISO 56002→56001 全面改訂**（`ebe9958`・35ファイル）＝`56002→56001`／`56002:2019→56001:2024`／細目文字(`§8.3.3 b/e` 等)を箇条レベルに一般化／`§9→§9.1`・`§7→§7.1.6`／設計ドラフト3ファイルを `*_ISO56001_*` にリネーム。§8.3 の工程段構成は 56001 公式目次で同一確認済（本文は有償未取得）。`doc/設計ドラフト/コンセプト機能_ISO56001_再設計.md` の突合ノートに経緯を明記。

### (B) 未コミット（この handoff と一緒にコミット予定）
1. **ガイダンス ⓘ 拡充＋💡アイデア eyebrow**（deploy 済・検証は§4）
   - `impl/frontend/src/components/ui/Field.tsx`＝再利用可能な `guide?` スロット追加（ラベル行に横並び）。
   - `impl/frontend/src/styles/design-system.css`＝`.field__labelrow` 追加。
   - `impl/frontend/src/features/concepts/components/ConceptForm.tsx`（SC-60）＝`FIELD_GUIDE`/`inputGuide()` 追加、課題/価値/対象/差別化/解の形態の5項目に **icon-only ⓘ**（名前・由来は除外＝ユーザー指示）。
   - `impl/frontend/src/features/concepts/components/ConceptDetailView.tsx`（SC-61）＝A/B/C グループに icon-only ⓘ 追加、C・前提と検証は `label` を外して icon-only 化。**チャット動線（下記2）も同ファイルに実装**。
   - `impl/frontend/src/features/ideas/components/IdeaDetailView.tsx`（SC-22）＝件名上に `<div class="idea-eyebrow">💡 アイデア</div>`（コンセプト詳細の `🧩 コンセプト` と対）。`impl/frontend/src/features/ideas/ideas.css`＝`.idea-eyebrow`。
   - 仕様: `doc/画面設計/screens/SC-60_...md §4`・`SC-61_...md §4`（ⓘ配置）更新。
2. **コンセプト議論チャット・スライスA（＝後述フル・パリティに置換予定の暫定版。deploy 済・smoke 検証のみ）**
   - backend: `impl/backend/app/tenant/concepts/schemas.py`＝`ConceptChatMessageDTO` に `author`（表示名/アバター/level）追加。`impl/backend/app/tenant/concepts/application.py`＝`_message_dto()` 著者 enrich、`list_messages`/`post_message` で著者一括ロード（`quests_repo.get_users_by_ids`）。
   - frontend: `impl/frontend/src/lib/api/schema.d.ts`＝`npm run codegen` で再生成（author 反映）。`impl/frontend/src/features/concepts/api.ts`＝`listChatScopes`/`createGroupScope`/`listScopeMessages`/`postScopeMessage`/`readScope`。`impl/frontend/src/features/concepts/components/ConceptChatView.tsx`＝**簡素なスコープ別チャット（新規）**。ルート `impl/frontend/src/app/(app)/concepts/[conceptId]/chat/[scopeId]/page.tsx`。`index.ts` に export。`impl/frontend/src/features/concepts/concepts.css`＝`.concept-chat-*`/`.schema-group__discuss`/`.concept-overall-chat`。
   - 動線（`ConceptDetailView.tsx`）＝A/B/C 末尾に「💬 このグループを議論 →」（`discussGroup(label)`＝ラベル一致ルームへ／無ければ `createGroupScope` して遷移）＋下部に総合チャットカード（`overallScope` へのリンク）。`SchemaGroup` に `onDiscuss?` prop 追加。
   - 仕様: `SC-61_...md §4.8` に「スライスA実装・活発度グラフ/プレビュー/前提スレッドは次スライス」を追記。
3. **フル・パリティ Phase 1 の基盤のみ（未適用・未リビルド・未テスト）**
   - `impl/backend/migrations/company/versions/0034_reactions_scope.py`（新規）＝`reactions.chat_group_id` を nullable 化＋`concept_chat_scope_id` 追加＋どちらか一方の CHECK。**DB 未適用**（適用済は 0033）。
   - `impl/backend/app/tenant/chat/orm.py`＝`Reaction` を上記に合わせて変更。**backend 未リビルド**（稼働中は旧 ORM）。

## 4. 現在の状態
- **稼働中**: `backend`/`db`/`frontend` コンテナ Up（handoff 作成時点）。frontend にガイダンスⓘ拡充＋スライスAチャットが**デプロイ済**。backend にコンセプトDTO著者enrichが**デプロイ済**。
- **DB マイグレーション**: 適用済＝**0033**。**0034 は未適用**（＝稼働中 backend の Reaction ORM は旧のままで DB と整合＝壊れていない）。
- **整合性の注意（重要）**: 未コミットの `chat/orm.py`(Reaction) 変更は 0034 とセットでのみ整合する。**backend を今リビルドするなら必ず 0034 適用が伴う**＝`cd impl && docker compose up -d --build backend`（entrypoint bootstrap が head までマイグレート・冪等）。0034 を適用せず ORM だけ載せるとリアクション系で列不整合エラーになる想定（未確認）。
- **ビルド/型**: frontend `npx tsc --noEmit` は対象コンポーネントでクリーン（既存 test ファイルの型 warning は別件）。`cd impl/frontend && npm run build` 成功（新ルート `/concepts/[conceptId]/chat/[scopeId]` 登録確認）。
- **テスト**: 本セッションで **backend pytest 未実行**（Phase1基盤は未テスト）。アイデアチャットの回帰テストも未実行。
- **壊れているもの**: 認識範囲では無し。

## 5. 詰まっている点（失敗したアプローチと理由）
- **コンセプト機能の実データ目視検証ができない**＝ログイン可能なテスト垢 `user@acme.example`(ACME-01/`Passw0rd!`) は**コンセプト/アイデアのデータを保有しておらず**（全クエストが空・コンセプトタブも出ない）、ユーザー実データ（「座席レイアウト管理」等・作成者=SC開発部ユーザー）にはアクセス不可。
  - UI からクエスト新規作成を試みたが `/quests/new` submit で検証に掛かり遷移せず（フォーム要件多数）。
  - `backend/scripts/seed_demo.py` はアイデア＋アイデアチャットを作るが**コンセプトは作らない**。
  - 結果: SC-61/SC-22/コンセプトチャットの実画面 e2e は未実施（＝§4の一部は「ユーザーのブラウザで受入」待ち）。
- 検証できた範囲: Field guide 行はログイン画面に注入して実CSSで描画確認（非展開＋ホバー）。SC-61 の A/B/C・前提の ⓘ は**ユーザーのスクショで表示確認済**。チャット・ルートのシェル描画スモーク（戻る/💬タイトル/作成欄/送信）＋404時の空表示・未捕捉エラー0を確認。💡アイデアeyebrow の実画面は**未確認**。

## 6. 決定事項と根拠
- **コンセプトチャットは「アイデアチャットと完全同一（フル機能パリティ）」にする＝A を採用**（ユーザー明示）。魔法(spell)/リアクション/メンション/添付/リアルタイム/活発度グラフまで同一。
  - 不採用: **B（見た目とパネルだけ揃える・魔法/リアクション無し）**。理由＝ユーザーが A を選択。
- **実装方式＝E ドメインチャットを container 非依存（`chat_group_id` or `concept_chat_scope_id`）に一般化**して再利用（設計ドラフト §3.8「ループ機構は一般化して共有」に沿う）。
  - **鍵の事実（確認済）**: `impl/backend/app/tenant/chat/application.py` の `_messages_payload(ts, messages, *, viewer_id)` は **行ベースの純粋関数**＝ソース非依存で scope メッセージにそのまま再利用可能。`ChatMessage`/`ChatRead` は 0033 で既に scope 対応。reactions/edit/delete/pin の EP は **message-id ベース**なので scope メッセージにも効く（`reactions.chat_group_id` が NOT NULL だったため 0034 が必要＝作成済）。
- **スライスA（簡素な `ConceptChatView`）は暫定でありフル・パリティに置換予定**。ただし `concepts/api.ts` のチャット関数・ルート・`ConceptDetailView` の動線（`discussGroup`/総合チャットカード）は概ね再利用可能。
- **フェーズ分割で進める**（コア・サブシステム改修＝アイデアチャット回帰リスクありのため、テスト保護しつつ段階的に）。

## 7. 次にやること（優先順・具体）
**Phase 1（backend 一般化）— 途中。基盤(0034+ORM)のみ済。**
1. `impl/backend/app/tenant/chat/repository.py` の container 依存関数を **`concept_chat_scope_id` でも動くよう一般化**（or scope 版を追加）: `list_messages`・`first_message_after`・`count_messages_after`・`count_active_messages`・`daily_message_counts`・`get_read`・`upsert_read`・`create_message`・`add_reaction`（全て現状 `ChatMessage.chat_group_id == chat_group_id` で絞る）。
2. `impl/backend/app/tenant/chat/application.py` に scope 版を追加（`_messages_payload`/`_message_reactions` 再利用）: `get_scope_chat`・`get_scope_chat_activity`（コンセプトに版は無い＝revision_markers 空）・`post_scope_message`（本文/メンション/引用/添付）・`mark_scope_read`。既存 `add_reaction`(≈L289)/`remove_reaction`(≈L333) は `chat_group_id=cg.id` 前提なので **scope メッセージのとき `concept_chat_scope_id` を入れる分岐**。スコープ門番は `impl/backend/app/tenant/concepts/application.py` の `_resolve_scope` を再利用（import か再実装）。
3. `impl/backend/app/tenant/chat/router.py`: `GET /concept-chat-scopes/{scope_id}/chat`・`GET /concept-chat-scopes/{scope_id}/chat-activity`・`POST /concept-chat-scopes/{scope_id}/chat/read` を追加。`POST /chat-messages`（≈L61・現状 `idea_id: str = Form(...)`）を **`concept_chat_scope_id` も受理**するよう拡張。応答は既存 `ChatMessageDTO`/`ChatListResponse`/`ChatActivityResponse`（`chat/schemas.py`）流用。
4. スライスAの簡素EP（`impl/backend/app/tenant/concepts/router.py` の `list_scope_messages`/`post_scope_message`/`read_scope`・≈L325-373）は**リッチ版に置換 or 削除**を判断（frontend が新EPを使うなら不要化）。
5. **テスト**: アイデアチャット回帰（既存 `impl/backend/tests/` の chat 系）が壊れないこと＋コンセプト scope チャットの新規TC（`doc/テスト/` に TC 行を先に足す＝テスト規約§5手順2・`root で python3 scripts/check_tc_traceability.py`）。**red-green 必須**。
6. **適用/検証**: `cd impl && docker compose up -d --build backend`（0034 適用）→ pytest（§8のコマンド・workers停止）。

**Phase 2（frontend 一般化）**
7. `impl/frontend/src/features/chat/components/IdeaChatView.tsx`（≈600行・`ideaId` と E API に直結）を **source 抽象（idea | concept-scope）で汎用化**。約30箇所の `getChat/postMessage/markRead/getChatActivity/getIdea/getPartyMembers/getSpells/backHref` を source 経由に。`impl/frontend/src/features/chat/api.ts` も scope ターゲット対応。
8. コンセプト側は `ConceptChatView.tsx` を**汎用ビューに置換**（スライスAは破棄）。
9. アイデア詳細のチャットパネル（`IdeaDetailView.tsx` ≈L507 の chat preview + 共有 `ActivitySpark`）を**再利用可能化**し、`ConceptDetailView` の総合チャットカードを**アイデアと同一パネル**（活発度グラフ＋直近プレビュー＋開く）に差し替え（SC-61 §4.8）。

**Phase 3（結線・受入）**
10. SC-61 の各動線（グループ/前提スレッド/総合）をアイデアと同一UIに。**ユーザーのブラウザで受入確認**（実データ）。

## 8. 再開に必要な環境情報
- **起動**: `cd impl && docker compose up -d`。frontend/backend は**ソースをベイク（volumes 無）**＝反映は `docker compose up -d --build frontend`（or backend）。**migration/seed 追加後は `--build backend`**（entrypoint bootstrap が DB作成/migrate(head)/seed を毎起動・冪等）。**workers は profiles**＝`docker compose up -d worker mail-worker`。
- **backend テスト**: `cd impl && docker compose run --rm -v "$(pwd)/backend:/app" backend python -m pytest tests/<domain> -q`（`-v` で未コミット反映）。**pytest 前に `docker compose stop worker mail-worker`**→終わったら start（*_outbox 競合回避）。
- **frontend 検証**: `cd impl/frontend && npm run build`（必須ゲート＝Next lint 含む）。**backend の API 型を変えたら `cd impl/frontend && npm run codegen`**（openapi→`src/lib/api/schema.d.ts`）。
- **e2e**: `cd impl/frontend && npx playwright test e2e/<spec> --workers=1`（フルスタック＋frontend `--build` 前提・storageState 認証）。
- **DB 直接確認**: `docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d ideaquest_company_acme -tAc "SELECT version_num FROM alembic_version"'`（テナントDB＝`ideaquest_company_acme`）。
- **ポート**: frontend 3000 / backend 8000（`/api/v1`・health `/healthz`）/ db 5432 / redis 6379 / minio 9000・9001 / mailhog 1025・8025。
- **ログイン（テスト垢）**: 会社コード `ACME-01`／`user@acme.example`（他 `user2`/`user3`/`kanri`@acme.example）／パスワード `Passw0rd!`。**注意＝これらの垢は現DBにコンセプト/アイデアのデータを持たない**（実画面検証は要データ用意 or ユーザーのブラウザ）。
- **一時ファイル**: 検証用 Playwright スクリプトは `/tmp/*.cjs`（git 管理外・破棄可）。

---
（自己チェック済み: 本ファイルだけで「full-parity チャット共通化 Phase1 の続き」から再開可能。未確認事項は明記した。）
