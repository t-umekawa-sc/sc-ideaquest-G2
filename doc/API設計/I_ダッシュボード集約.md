# ドメイン I. ダッシュボード集約（テナントプレーン）＝詳細確定（2026-08-08）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.5 会社DB動的ルーティング・§1.6 認可・§1.8 一覧〔カーソル〕）を参照。本ドメインは**新しい業務ロジックを持たず、各ドメインの取得系を1レスポンスに合成する「読取合成の殻」**。合成元＝[`C_クエスト・パーティー・権限.md`](./C_クエスト・パーティー・権限.md)（参加中/下書きクエスト）・[`D_アイデア・添付・版・投票・フォロー.md`](./D_アイデア・添付・版・投票・フォロー.md)（下書き/未投票/フォロー中アイデア）・[`F_評価.md`](./F_評価.md)（下書き評価）・[`G_ゲーミフィケーション.md`](./G_ゲーミフィケーション.md)（週間ランキング・残高ヒーロー）・[`H_通知.md`](./H_通知.md)（最近の通知）。本ファイルはドメイン I の分割レビュー成果。

対象画面＝**SC-01 ダッシュボード（ログイン後ホーム）**。すべて**テナントAPI**（会社DB。ヒーロー残高・roles はセッション/`users`）。データモデル §5.3 users（残高）・§5.23 follows・§5.10 ideas・§5.11 votes・§5.21 evaluations。コーディング規約 §1・§2.2・**§3.1（薄い CRUD はドメイン層を通さない・application が repository を直接読む）**・**§3.5-(2)（他モジュールの純粋 domain / repository を read で再利用）**準拠。

**この分割レビューでユーザー選択により確定（2026-08-08）**:
- **取得方式＝集約1本 `GET /dashboard`**（SC-01 §10 の未決を決定）。不採用＝分割並列（下記 I.0「なぜ集約1本か」）。
- **I は読取合成に徹し、業務ロジックを持たない**。横断クエリ（全クエスト/全アイデア跨ぎの「自分の〜」）は**所有ドメインの repository に read を追加して I が合成**し、**別個の REST エンドポイントは新設しない**（I.3）。

## I.0 責務境界・アクター

- **責務**＝SC-01 の各パネル（下書き〔クエスト/アイデア/評価〕・未投票アイデア・参加中クエスト・フォロー中アイデア・週間ランキング TOP3＋自分・ヒーロー〔Lv/XP/コイン/SP〕・最近の通知・管理導線 roles・ログインボーナス）を**1レスポンスに合成して返すだけ**。I 自身は匿名化・visibility・権限・ランキングスコア等を**一切再実装しない**（各ドメインの純粋関数/repository が権威・コーディング規約 §1）。
- **アクター＝認証済みユーザー全員**（自分のダッシュボードのみ＝セッションユーザー・テナント内）。未認証＝**401**。クロステナント参照は不可（会社特定はセッションの `company_id`・§1.5）。
- **可視範囲の門番は合成元が強制**＝参加中クエスト/アイデアの「パーティー所属門番」（C.0/D.0）、評価の `visibility`（F.1）、投票集計の匿名化（会社設定・D.5）、ランキングのテナント内集計（G.5）は**各ドメインの read がそのまま適用**される。I は絞り込み済みの結果を並べるのみ。
- **なぜ集約1本か（採用理由）**＝SC-01 は**ログイン直後のランディング**で 1 往復・1 ローディングが体験価値。パネル構成は固定なので専用集約が素直で、サーバー内で各読取を並列実行できる。**不採用＝分割並列**：後述の横断クエリ（I.3）に対応する取得系が現状 D/F に無く、分割にすると**狭い横断リスト EP を4本前後 新設**することになり、ランディングで N 本のリクエスト＋EP 乱立を招く。I が実質「目次」だけになり集約の価値も薄い。
- 認可・業務判定はサーバー強制（§1.1）。ヒーロー数値・投票集計・順位はサーバー値が正でフロントは再計算しない（§9・SC-01 §9）。

## I.1 ダッシュボード取得（集約）

| メソッド/パス | 概要 | リクエスト | レスポンス（トップレベル） |
| --- | --- | --- | --- |
| `GET /dashboard` | SC-01 の全パネルを1レスポンスに集約 | クエリ（任意・件数上限の微調整用。既定は I.2 の各上限）: `-`（現状パラメータなし） | `{hero, drafts[], unvoted_ideas[], quests[], followed_ideas[], weekly_ranking, notifications, roles, login_bonus?}` |

- **合成の実行**＝I の application が各ドメインの read（repository / 純粋 domain）を**並列に呼び**、下記の形へ整形して返す（副作用なし・純粋な読取・トランザクション不要）。個々のパネルは**独立に空**になりうる（空パネルはフロントが非表示＝SC-01 §7）。
- **エラー方針**＝集約の一部が失敗しても**ダッシュボード全体を落とさない**方針を既定とし、失敗したパネルは `null`（or 空配列）＋そのパネルのみ再取得可能にする（実装 TBD＝I.5）。認証/テナント解決の失敗は全体 401/エラー。

### レスポンス構造（各キー）

- **`hero`**（ヒーロー・ゲーム層／源泉＝`users` 残高・G が canonical）
  `{id, display_name, avatar_image_path, locale, level, xp, xp_to_next, level_span, coin_balance, skill_point_balance}`。
  - `level`/`xp`/`coin_balance`/`skill_point_balance`＝`users` のキャッシュ残高（真実は `activities`・G.0）。`xp_to_next`＝次レベルまでの残り XP、`level_span`＝現レベルの必要総量（`100+(level-1)×50`・データモデル §7・**算出は G の純粋 level 関数**）。フロントは `level_span - xp_to_next` で XP バーを描く（SC-01 §4.2）。
- **`drafts[]`**（作成者本人の下書き・最上段・SC-01 §4.4／種別混在）
  各要素＝`{kind:'quest'|'idea'|'evaluation', updated_at, ...種別固有}`。
  - `quest`＝`{kind, quest_id, title, categories[], deadline}`（→SC-11 編集モーダル）。
  - `idea`＝`{kind, idea_id, title, quest:{id,title}}`（→SC-21 編集モーダル）。
  - `evaluation`＝`{kind, idea:{id,title}, quest:{id,title}, progress:{scored, total:5}}`（→SC-25 採点再開・`progress` は採点済み観点数/5）。
- **`unvoted_ideas[]`**（参加クエストで自分が未投票の公開アイデア・SC-01 §4.5）
  `{id, title, quest:{id,title}, category, poster:{name, avatar}, value, vote_summary〔匿名化考慮・D.5〕, deadline}`。クイック投票は既存 `POST /ideas/{id}/vote`（D）を叩く（I は投票 EP を持たない）。
- **`quests[]`**（参加中クエスト・SC-01 §4.6）
  C の `GET /quests` カード形（`id/title/color/icon_image_path/categories[]/status/deadline/member_count/idea_count/owner/quest_group/my_state`）。
- **`followed_ideas[]`**（フォロー中アイデア・SC-01 §4.7）
  `{id, title, quest:{id,title,quest_status〔完了バッジ判定用〕}, poster:{name, avatar}, value, vote_summary, comment_count, updated_at, following:true}`。`quest_status=completed` はフロントが「⏸完了（凍結）／解除のみ」を表示（D.6・再フォロー不可）。
- **`weekly_ranking`**（週間 TOP3＋自分・SC-01 §4.3／G.5）
  `{top3:[{rank, user:{id,name,avatar,level}, score, xp, coin}], me:{rank, score, xp, coin, total_users}}`。`score=weekly_xp+weekly_coin`（SP 非対象・週起点 月曜 00:00 JST）は**G の算定**（I は `GET /rankings?period=this_week&scope=company&limit=3` 相当の read を呼ぶだけ）。
- **`notifications`**（最近の通知・SC-01 §4.8／H）
  `{data:[H.2 の通知表現〔取得時レンダリング済み body〕], unread_count}`。H の `GET /notifications?limit=n` 相当の read。**「XP 獲得」自体は通知種別に無い**（F.5＝投稿者向け獲得通知は無し）＝この欄はメンション/コメント/評価/選定/実績/セキュリティ等（H.0 の10種別）を新着順に数件。
- **`roles`**（管理導線の出し分け・SC-01 §4.10）
  `{is_qg_admin〔`quest_group_members.role=admin` の有効所属が1つ以上〕, is_company_account_admin〔`system_role`〕, is_system_admin〔`system_role`〕}`。**判定はサーバー権威**（B案 §8-⑯・導線表示は UX 便宜で実アクセスは各管理 API が再認可）。
- **`login_bonus?`**（ログインボーナス演出・SC-01 §4/§6・任意）
  ログイン処理（A）で確定した付与結果を**初回ダッシュボード取得時に一度だけ**返す（多重表示を防ぐため、返却後にワンショットフラグを消費）。XP 付与自体はログイン時に確定済み（1日1回・日次上限＝A/G）で、**ここは演出データのみ**。形＝`{xp, message?, levelup?}`（`levelup` 詳細演出は SC-01 §10 TBD）。

## I.2 各パネルの合成元・件数上限・並び

| パネル | 合成元ドメイン | 呼ぶ read（概念） | 既定の上限/並び |
| --- | --- | --- | --- |
| ヒーロー | G（`users` 残高） | 残高＋level 純粋算出 | 単一 |
| 下書き クエスト | C | `GET /quests` の `status=draft`（本人のみ・C.1(B)） | 最終更新降順・全件（下書きは少数想定・上限 TBD） |
| 下書き アイデア | D（横断・I.3） | 本人 `draft` アイデアを全クエスト横断で列挙 | 最終更新降順 |
| 下書き 評価 | F（横断・I.3） | 本人 `draft` 評価を全アイデア横断で列挙 | 最終更新降順 |
| 未投票アイデア | D（横断・I.3） | 参加クエストの公開アイデアで `my_vote IS NULL` | 締切近い順・上限 n（TBD） |
| 参加中クエスト | C | `GET /quests`（参加中・(A)） | 締切近い順・上限 n（TBD）＋「すべて見る」→SC-10 |
| フォロー中アイデア | D（横断・I.3） | `follows`（自分）×`ideas` を join した一覧 | 直近動き順・上限 n（TBD） |
| 週間ランキング | G | `GET /rankings?period=this_week&scope=company&limit=3`（`me` 同梱） | TOP3＋自分 |
| 最近の通知 | H | `GET /notifications?limit=n`（`unread_count` 同梱） | 新着降順・上限 n（TBD・目安5） |
| roles | セッション/管理DB | `quest_group_members.role`／`system_role` | 単一 |

- **件数上限・並び順の具体値**は SC-01 §10 の TBD（下書き/未投票/参加中/フォロー中の「表示件数・並び順・すべて見る閾値」）に従い、実装/運用で確定（I.5 に再掲）。集約段では**各パネルに妥当な上限を課し、詳細は各一覧画面（SC-10/SC-41/SC-02）へ誘導**する。

## I.3 横断 read の所在（エンドポイントは新設しない）

SC-01 が要求する「全クエスト/全アイデア跨ぎの自分の〜」は、現状 D/F の取得系（**クエスト単位/アイデア単位**）では賄えない。これらを**所有ドメインの repository に read として追加**し、**I の application が `GET /dashboard` の内部で合成**する（**別個の REST エンドポイントは作らない**）。

- **D（ideas モジュール）に追加する read**（会社DB `ideas`/`votes`/`follows`。すべてテナント内・パーティー門番を D と同一に適用）:
  1. **本人の下書きアイデア一覧**（全クエスト横断＝`author_id=自分 AND status=draft`）。
  2. **未投票アイデア一覧**（自分が参加中のクエストの `published` で `votes` に自分の行が無いもの・締切内）。
  3. **フォロー中アイデア一覧**（`follows(user_id=自分)`×`ideas` join・`quest_status` 同梱）。
- **F（evaluations モジュール）に追加する read**:
  4. **本人の下書き評価一覧**（全アイデア横断＝`evaluator_id=自分 AND status=draft`・採点進捗 `scored/5` 付き）。
- **設計上の位置づけ（なぜ EP を増やさないか）**＝これらは**ダッシュボード専用の合成入力**であり、単体の画面を持たない。個別 REST 化すると狭い EP が乱立し、ランディングの往復も増える（I.0 の集約採用理由）。read は所有ドメインの repository に置く（テーブル所有権を D/F に残す）ことで、**匿名化/門番/visibility 等の規則を各ドメインの純粋関数で一元適用**でき、I は結果を並べるだけで済む（コーディング規約 §3.1/§3.5-(2)）。将来これらを単体画面（例＝「フォロー中の全一覧」）で使うことになれば、その時点で该当ドメインに GET を公開する（現状は不要）。

## I.4 他ドメイン境界・残 TBD

- **委譲/連携**: 参加中/下書きクエスト＝**C**／下書き・未投票・フォロー中アイデア＝**D**（I.3 の横断 read）／下書き評価＝**F**（I.3）／週間ランキング・残高＝**G**（`GET /rankings`・`users` 残高）／最近の通知＝**H**（`GET /notifications`）／`login_bonus` の付与確定＝**A**（ログイン処理・I はワンショット返却のみ）／背景画像・プロフィール（残高の別入口 `GET /me`）＝**K**（未着手・ヒーロー残高は当面 I が直接返す＝G.0 の「残高参照は I でも可」と整合）。
- **セキュリティ突合（規約 §2.2）**: 主リスク＝**クロステナント/他人データ混入**。対策＝全 read はセッションの `company_id`（§1.5）と `recipient/author/user_id=自分` を強制し、可視範囲は各合成元の門番（パーティー所属・visibility・匿名化）をそのまま通す。I は新たな公開面を作らない（横断 read は内部 read で、他人スコープを受け取るクエリパラメータを持たない＝IDOR 面を増やさない）。roles の導線表示は UX 便宜で、実アクセスは各管理 API が再認可（§1.6）。
- **確定済み（本レビュー）**: 集約1本 `GET /dashboard`／I は読取合成の殻（新業務ロジックなし）／横断 read は D/F の repository に置き別 EP を新設しない／ヒーロー残高は I が直接返す（K 未着手の当面）。
- **残 TBD（軽微・実装 or 運用で確定）**: 各パネルの**表示件数・並び順・「すべて見る」閾値**（SC-01 §10）／**部分失敗時の挙動**（パネル単位 `null`＋再取得 or 全体エラー）と各 read の**キャッシュ/タイムアウト**／`login_bonus` のワンショット保持（Redis フラグ or セッション・A と協調）と**レベルアップ演出**（SC-01 §10）／通知ベルの簡易ドロップダウン化（SC-01 §10）／実績サマリ（直近バッジ）を載せるか（SC-01 §10・現状は非搭載）／3D アバターの表示方法（静止画キャッシュ or 軽量3D・SC-01 §10）。
