# impl — ideaquest 実装

社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」の実装コード。
設計の正本は [`../doc/`](../doc/)（要件・API・画面・データモデル）、開発の引き継ぎは [`../handoff.md`](../handoff.md)。

- **frontend/** — Next.js（App Router・dev モード起動）。`shared.css` を単一デザインシステムに段階移行中。
- **backend/** — FastAPI 4層（router / application / repository / infra）。
- **compose.yaml** — フルスタック（PostgreSQL / Redis / MinIO / MailHog / workers / Docker）。

> 進捗の最終確認: **2026-08-27**。**tsc クリーン（Snackbar.tsx:122 の React19 useRef 型エラー修正済み）・frontend vitest 単体 19/19（`companies/api.test.ts` 9＋`search/snippet.test.ts` 6＋`avatar/avatar.test.ts` 4＝ベース正規化/WebGL・motion の SSR ガード）**・**backend `pytest tests/` 全体 468 passed（フラキー根治済み＝pytest 実行時はワーカ停止・8/8 green 実測）**（評価 F ＝23＋**SC-12 評価集計 D-TC-150／コメント数 D-TC-151／XP 結線 D-TC-160-162（投稿+50・投票+5）**＋**セキュリティ横断 SEC-TC-001-040＋J-TC-141（応答ヘッダ§10・マジックバイト§8・cross-tenant・機密ログ非出力・Mass Assignment・検索インジェクション）**／チャット E ＝22／魔法解放 G ＝6／ショップ/装備 G ＝8／ランキング G ＝5／実績 G ＝6／**通知 H ＝15＋security 6**／**リアルタイム L ＝8**／**ダッシュボード I ＝6**／**全文検索 J ＝8（PGroonga）**／**K アバターベース 4（K-TC-011-014＝`PUT /me/avatar-base`）**）・e2e sc-24（3）＋sc-32（1）＋sc-30（2）＋sc-41（1）＋sc-40（1）＋**sc-02（1＝通知実データ H-TC-208）**＋sc-25（3）＋sc-22（10）＋sc-21（6）＋sc-92d（1）＋**sc-31（1＝K-TC-015 ベース体切替の永続）**passed・TC-ID トレーサビリティ ✅（code 393）。**db は PGroonga 同梱のカスタムイメージ（`impl/db/Dockerfile`）**。**セキュリティ応答ヘッダ（nosniff/X-Frame/Referrer-Policy/CSP frame-ancestors・HSTS は TLS 時）を全応答に付与（main.py middleware・§10）／アップロードはマジックバイト検証（§8）**。
> 開発方針＝**1画面単位で backend 接続ループ**（各画面でユーザー受入ゲート）。実装順の正本＝[`../doc/実装計画.md`](../doc/実装計画.md)＝アカウント→クエスト(C)→アイデア(D)→評価→その他。
>
> **FR-38 再設計（2026-09-12）＝backend 完了**: 参加部署（`quest_group_links`・フラット 0..N・主グループ廃止）＝**アクセス条件**（門番 `can_access_quest` を詳細/一覧/D/F/E,L/J/G に統一・作成者別格・異動で都度失効・0件=会社全体・409 group_in_use 撤去）。migration `0024_flatten_quest_groups` で `quests.quest_group_id`/`is_primary` を撤去（全3社DB適用済み）。**backend `pytest tests` = 534 passed／TC 468 ✅／frontend codegen+tsc+build OK**（frontend は新DTO最小追随のみ＝**参加部署UIの本改修は #8 で未着手**）。



## 画面実装進捗（SC-xx）

凡例: ✅ backend 接続済み ／ 🟡 部分接続（一部が表示のみ/デモ）／ ⬜ モック（画面のみ・backend 未接続）

| 画面 | 名称 | 状態 | ルート | 備考 |
|---|---|---|---|---|
| SC-00 | ログイン | ✅ | `(auth)/login` | 401→`/login?reason=…` セッション終了通知（デザイン標準 §14）。password-reset/-setup・email-change・**email-verify/confirm**（ADR-0009）も配置 |
| SC-01 | ダッシュボード | ✅ | `(app)/` | **実接続（`GET /dashboard`＝I 集約1本）**＝ヒーロー（残高＋level）・週間ランキング・下書き（quest/idea/eval 進捗）・未投票・参加中クエスト・フォロー中・最近の通知・roles・login_bonus。クイック投票（POST /ideas/{id}/vote）・フォロー解除（D follow EP）実接続・login_bonus トースト。空パネル非表示。**FR-40＝フォロー中クエスト/参加リクエスト状況／`incoming_join_requests`（owner/quest_admin の未処理リクエスト・カードクリックで承認/却下ダイアログ＝共有 `JoinRequestDialog`）（2026-09-18・I-TC-159/160）** |
| SC-02 | 通知一覧 | ✅ | `(app)/notifications` | 実接続（`getNotifications`＝一覧＋未読数・取得時レンダリング済み body・`markRead`/`markUnread`/`markAllRead`）。状態/種別（9カテゴリー）絞り込み・日付グループ・クリックで既読化＋ref 遷移。生成はサーバー（発火ドメイン）。**security_* も実データ**。**リアルタイム(L) 接続済み＝WS で新着/未読数を即時反映（ヘッダーベル＋一覧）**。**`join_request_received` は `/quests/{id}?joinreq={申請者}` へディープリンク＝該当申請者の承認/却下ダイアログを直接オープン（`ref.user_id`＝params 由来・H-TC-211）** |
| SC-03 | プロフィール | ✅ | `(app)/profile` | K.1（`/me`）接続済み |
| SC-10 | クエスト一覧 | ✅ | `(app)/quests` | 複製対応済み。💡件数列は `idea_count`（公開アイデア数）に連動。**backend `GET /quests?sort=` 実装済み（2026-09-17・§1.8.1＝`-created_at`/`deadline`/`-idea_count`/`-member_count`・複数キー・keyset・未知キー422）**＝frontend DataTable への結線は未（backend 側は契約充足） |
| SC-11 | クエスト作成/編集 | ✅ | `(app)/quests/new`・`[questId]/edit` | URL 付きモーダル（Parallel＋Intercept） |
| SC-12 | クエスト詳細 | ✅ | `(app)/quests/[questId]` | 本体＋**アイデアタブ（D.1・評価列 F 実接続＝`evaluation` 集計 n/5・評価待ち/評価済・可視のみ）**＋**全文検索タブ（J・PGroonga・種別/スニペット/ページング/遷移）**＋**クエスト内週間ランキング（G 実接続＝`GET /rankings?scope=quest:{id}&period=this_week`）**。ヘッダー💡件数は `idea_count` 連動。**💬 コメント数も実接続（E 非削除チャット件数）**。残 demo なし |
| SC-21 | アイデア登録/編集 | ✅ | `(app)/quests/[questId]/ideas/new`（＋モーダル） | §4.7 入力検証（**サーバエラー経由の 3 チャネル e2e D-TC-216**＝完了クエスト編集 409）・登録モーダル初期誤検証 fix 済み・**添付アップロード**（D.3・保存後に送信）・**編集での既存添付の一覧＋削除**（D-TC-218・確認ダイアログ→即時削除・版を生まない） |
| SC-22 | アイデア詳細 | ✅ | `(app)/ideas/[ideaId]` | 本体＋投票/フォロー（D.5/D.6）＋添付（D.3）＋quest 参照（D.1）＋更新履歴（D.4）＋評価結果/選定（F.1/F.3）＋**チャット活発度/プレビュー（E.1・`getChatActivity`/`getChat`）**。全セクション実接続 |
| SC-24 | アイデアチャット | ✅ | `(app)/ideas/[ideaId]/chat` | **実接続**（`getChat`/`postMessage`/`editMessage`/`deleteMessage`/`markRead`/`addReaction`/`removeReaction`/`getSpells`）＝投稿/編集/削除・リアクション/魔法・メンション（実メンバー）・添付（署名DL）・**複数引用**（`chat_message_quotes`・§5.16b）・既読・comment 権限/completed 凍結。**リアルタイム(L) 接続済み＝chat:{cg} 購読で新着/編集/削除/リアクションを即時反映（WS 受信で再取得）** |
| SC-25 | 評価画面 | ✅ | `(app)/ideas/[ideaId]/eval`＋`@modal/(.)ideas/[ideaId]/eval` | 5観点採点＋観点別コメント＋総評＋公開範囲＋集計プレビュー（F.2）。`getMyEvaluation` プリフィル・確定/下書き＝`putEvaluation`・422/403/409 はサーバー権威。**URL 付きモーダル化済み**＝SC-22 ソフト遷移＝Intercept モーダル（`EvaluationModal`）／URL直・リロード＝フルページ（`EvaluationView` が `onClose` で chrome 出し分け） |
| SC-30 | ショップ | ✅ | `(app)/shop` | 実接続。**一覧は DataTable サーバーモード委譲（2026-09-17・G.1 拡張＝`GET /items` に q/slot/rarity/owned/affordable/state/price範囲/sort/番号ページャ/pin/CSV）**＝検索/絞込/ソート/ページをサーバーで解決（`itemsQueryParams`・列 flags=backend ホワイトリスト一致）。購入は確認ダイアログ→報酬スナックバー、購入後は `refreshToken` で絞込維持のまま再クエリ。アイコンはクライアント presentation |
| SC-31 | アバター着せ替え | ✅ | `(app)/avatar` | 実接続（`getItems`＝所有/装備・`updateEquipment`＝各スロット1点・楽観更新＋サーバー権威）。未所有はショップ導線。**3D＝R3F(three)骨組み導入**＝WebGL 対応時は 3D ビューア（プレースホルダ humanoid＋ドラッグ回転・`prefers-reduced-motion` 尊重）／非対応は 2D マスコットへ自動フォールバック（progressive enhancement・§9.3）。**ベース切替（男/女）→`PUT /me/avatar-base`**（SSR 初期値＝`GET /me`）。**実VRMアセット（男女2体＋装備パーツ）は未整備＝差し替え seam**（`AvatarViewer3D.tsx` TODO・§9.2） |
| SC-32 | 魔法スキル | ✅ | `(app)/spells` | 実接続（`getSpells`＝カタログ＋SP残高＋unlocked/can_unlock・`unlockSpell`＝SP消費・前提/二重解放はサーバー権威）。解放は確認ダイアログ→報酬スナックバー。演出コピーはクライアント（G シードに説明文なし） |
| SC-40 | 実績バッジ | ✅ | `(app)/achievements` | 実接続（`getAchievements`＝カタログ＋自分の獲得/進捗＋summary・シークレット未獲得は伏せる）。付与はサーバー（台帳フック）が自動判定＝表示のみ。DataTable（カテゴリー/ティア/状態） |
| SC-41 | ランキング | ✅ | `(app)/ranking` | 実接続（`getRankings`＝期間×会社スコープ・獲得XP＋獲得コイン集計・me 常時同梱）。期間タブ（今週/先週/今月/通算）で再取得・表彰台/一覧/自分順位 |
| SC-50/51/52 | 情報インプット（一覧/登録/詳細） | 🟩 | **一覧＝Phase A／詳細＝Phase B／登録・編集・リンク・画像・参考資料＝Phase C／アーカイブ・続報登録・この情報からクエスト作成＝Phase D 進行中（backend 接続済）**（反証通知・curator 付与 EP・raw 物理削除＝Phase D 残） | **モック→Next.js 移植→Phase A 一覧（2026-09-20）→Phase B 詳細（2026-09-21）→Phase C 変更系（2026-09-21）**。**一覧＝サーバー委譲（`GET /info-items`・§1.8.1・`app/tenant/info` 4層＋migration 0028）**＝状態タブ(facets)／続報束ね(`roots_only`)／ワードクラウド／全文検索(PGroonga)。**詳細＝`GET /info-items/{id}`**＝全属性＋関連リンク〔title 解決〕＋続報スレッド＋ミニ・ワードクラウド＋**参考資料**＋`can`（`edit_content`＝作成者／`curate`＝curator／`add_link`＝全員）。**Phase C＝登録/続報（`POST`・nh3/janome/要約・親リンク複製）／内容編集（`PATCH`＝作成者・再派生＋版履歴 migration 0029）／キュレーション（`PATCH`＝curator・raw→curated）／関連リンク（候補検索＋追加/種別変更/棄却・全員）／貼付画像の MinIO 再ホスト（`POST /info-items/images`・paste ハンドラ・§12-4）／参考資料（`POST`/`DELETE .../attachments`・作成者・migration 0030・§5.33）**。詳細はインライン編集を `can` で出し分け。**Phase D＝アーカイブ/解除（`POST .../archive`・`/unarchive`＝curator・論理削除〔監査保持〕・状態タブに「アーカイブ」追加・facets.archived・詳細本文 curator ブロック/行メニューから操作）／続報登録（親を実 API でプレビュー・`POST /info-items {parent_info_id}`＝登録時に親の未棄却リンクを origin=auto で自動複製・スレッドは根に紐づけ・詳細/行メニューから起票）／この情報からクエスト作成（`POST /quests {from_info_id}`＝作成後にサーバーが info_link〔quests・related・manual〕を自動生成＝逆リンク・下書き作成→SC-11 で仕上げ・C.2）**。demo seed＝bootstrap `seed_demo_info`（i1〜i5＋filler30・冪等）。テスト＝pytest `tests/info` 49 green＋front unit（api.test.ts 7）。 |
| SC-90 | クエストグループ管理 | ✅ | `(app)/admin/quest-groups` | メンバー管理含む |
| SC-91 | システム管理 | ✅ | `(app)/admin/companies` | 会社一覧・手動プロビジョニング。複製対応済み（会社=会社コード/DB識別子/名前/カラー・QG=コード/名前を引き継ぎ） |
| SC-92 | 会社詳細 | ✅ | `(app)/admin/companies/[id]` | 会社プロビジョニングは MVP 手動。**メール確認バッジ（未確認/確認済み）＋⋯「確認メールを送信」**（ADR-0009）。アカウント複製対応（ログインID/メール/所属も引き継ぎ）・編集で現所属を読み取り専用表示 |
| SC-93 | 会社アカウント管理 | ✅ | `(app)/admin/companies/[id]/accounts`・`admin/accounts` | 複製対応済み（ログインID/メール/所属も引き継ぎ）・編集で現所属を読み取り専用表示。**メール確認バッジ＋送信アクション**（ADR-0009） |

**接続済み画面のフロント feature**＝`auth`・`profile`・`quests`・`ideas`・`evaluations`・`chat`・`spells`・`shop`・`avatar`・`ranking`・`achievements`・`notifications`・`accounts`・`companies`・`questgroups`・`qgadmin`（各 `api.ts` が backend を叩く）。
**モック feature**（`api.ts` 無し）＝`dashboard`(一部)。

## ブラウザ受入状況（バッチ・後日まとめて）

> 上表の ✅/🟡＝**backend 接続＋e2e green** の状態。**ユーザーによるブラウザ受入は別軸**で、後日まとめて実施する（e2e green でクローズ扱い・次画面へ進む・[受入ゲート](../doc/規約/フロントエンド実装フロー規約.md) §1.1）。ここに受入待ちを集約し、受入完了までチェックを残す（受入用デモデータも受入完了まで削除しない）。**dev ログイン**＝`ACME-01`/`user@acme.example`/`Passw0rd!`・**MailHog**＝`http://localhost:8025`。
>
> **受入用デモデータは再生成可能**＝`backend/scripts/seed_demo.py`（冪等・HTTP API を実ユーザーで駆動）。群単位で育てる（実装順 D→E→G→F→H）。実行＝`python3 impl/backend/scripts/seed_demo.py [d|all]`（ホストの python3＋requests・稼働中 backend 必須）。**手動 seed が失われても本スクリプトで復元**。下の URL は最新生成の実 ID（ACME-01 db・生成のたびに ID は変わり得る＝スクリプト出力の URL を正とする）。

> **受入進捗サマリ（随時更新・2026-09-15）**
> - **D群（アイデア）＝✅完了（2026-09-14 受入クローズ）**: 217✅ / 209-212✅ / 213-214✅ / idea_count✅ / 216✅ / 215✅ / 218✅（添付の版管理・1保存1版・無変更は版なし・作成時添付は初版に記録）
> - **E群（チャット SC-24）＝✅受入OK（2026-09-16）**: 基本（E-TC-201/203＝投稿/編集/削除・複数引用・@メンション・👍/魔法リアクション・📎添付DL・既読セパレータ）・completed 凍結・受入指摘 DFT-E-006〜011＋ホバー操作メニュー改善（E-TC-214〜222/218）すべて受入クローズ。
> - **SC-01 ダッシュボード（UI要望）＝✅受入OK（2026-09-16）**: 「最近の通知」に既読ボタン・下段1:1・並び替え・通知フォント衝突解消（`notif-subject` 改名）（**I-TC-144**）＋日時表示（**I-TC-155**）・一覧スクロール位置復元（**M-TC-013/014**・§4.12）・既読ボタンの focus スクロール修正（**H-TC-211**）。
> - **G群（魔法/ショップ/アバター/ランキング/実績）＝✅受入クローズ（2026-09-16）**＝SC-32 魔法（G-TC-201）・SC-30/31 ショップ/アバター（G-TC-202/203）・SC-41 ランキング（G-TC-206・先頭で開く G-TC-171・積み上げ G-TC-401/402）・SC-40 実績（G-TC-207・積み上げタイミング G-TC-502〜512）・3D（K-TC-015）。※ゲーム層UIは owner の game_mode を ON にして確認
> - **SC-02 通知（H・画面/一覧）＝✅受入OK（2026-09-16）**: 一覧/絞り込み/既読化/すべて既読（H-TC-208）。**発火パターンは backend テストで担保**（役割分担＝視覚/操作感はユーザー・ロジック/パターンは自動テスト）。未担保 follow-up＝`follow_evaluation`/`idea_updated`/`magic_reaction`。
> - **F群（評価）**: 未着手
> - **H群（通知）**: 未着手（2ユーザー発火の seed が必要）
> - **その他（メール確認 ADR-0009）**: 未着手
> ※凍結UI改善（案B `is-frozen`）・フォロー info・チャット composer 崩れ修正・件名折返し・idea_count 追随 は D群受入中に併せて対応済み（横断UI＝完了クエスト凍結の標準化）。

### D 群（アイデア）— seed 済み `seed_demo.py d`
- [x] **SC-22 更新履歴 D.4（D-TC-217）** ✅受入OK＝`http://localhost:3000/ideas/cefce211-a77a-4794-bd30-d84755036f75`（クエスト「【受入】D-アイデア（投票/履歴/添付）」内「夜間配送の集約デモ」・**3版**）。「版 3/版 2（履歴）」→前版比の文字差分（value/body/time_limit）の見え方。
- [x] **SC-21 §4.7 サーバエラー3チャネル（D-TC-216）** ✅受入OK＝※完了クエスト編集は事前無効化に変更したため、3チャネル機構（①上部サマリ ②足元ヒント ③持続エラースナックバー）は recruiting アイデアの件名を空にして保存→422 で確認。
- [x] **SC-22 投票/フォロー（D-TC-209〜212）** ✅受入OK＝クエスト「【受入】D-アイデア」内「会議室予約の自動化デモ」（投票ゼロ始まり）で 賛成/反対/切替/同ボタン再クリック取消・★フォロートグルの楽観更新＋サーバー権威。
- [x] **SC-10/12 idea_count 連動** ✅受入OK＝`http://localhost:3000/quests` で上記2デモクエストの💡件数（【受入】D-アイデア=2件・【受入】D-完了=1件）が実データに連動。投稿後に SC-12 ヘッダー/KPI も即追随（IDEAS_CHANGED で quest 本体も再取得するよう修正）。
- [x] **SC-22 quest参照/completed 事前無効化（D-TC-213/214）** ✅受入OK＝完了クエスト「【受入】D-完了クエスト」内「請求書処理の電子化デモ」で「クエストへ戻る」導線・カテゴリーバッジ・完了時の投票/新規フォロー disabled＋⏸凍結バッジ。※完了クエストの凍結UIは案B（`is-frozen`＝グレー塗り＋斜線ハッチ）に統一＝投票（SC-22/SC-12 リスト・カード）・編集・評価・選定・クエスト編集・アイデア追加・パーティー編集を非活性＋ツールチップ。フォローは「解除のみ可」＝押下で info 表示。見本＝style-guide.html「3b」。
- [x] **SC-21/22 添付 D.3（D-TC-215）** ✅受入OK＝「夜間配送の集約デモ」に添付2件（設計メモ.png・コスト試算.png）→SC-22 に実添付表示＋DL。署名URL（AWS SigV4/MinIO・TTL300s・§1.10）を確認済み。
- [x] **SC-21 編集モードの既存添付 削除（D-TC-218）** ✅受入OK＝**ステージ削除（保存で確定）**に再設計（新規追加と統一）。× で「削除予定」にマーク（`.attach.is-removing`＋「元に戻す」）→「変更を保存」で確定／キャンセルなら無変更。**添付の追加/削除は更新履歴（版）に記録**＝**1保存1版**・差分に「📎 添付：〇〇を追加/削除」＋フォロワー通知（D-TC-145）。**無変更保存は版を作らない**／**作成時添付は初版に記録**（draft→添付→publish）。既存添付を版に載せるため seed に capture PATCH 追加。
### E 群（チャット）— seed 済み `seed_demo.py e`
- [x] **SC-24 チャット E（E-TC-201/203）** ✅受入OK（2026-09-16）＝クエスト「【受入】D-アイデア」内「Eチャットデモ」のチャット（`{APP}/ideas/<Eチャットデモ id>/chat`・seed 出力の URL が正）で: メッセージ投稿/編集/削除・**複数引用（owner の返信が u2/u3 を2件引用）**・**@メンション**（u3→owner・owner→u2/u3）・**👍通常リアクション**（u3）・**魔法リアクション**（owner＝SP保有者が付与済み。u2/u3 はSP0のため owner が担当）・**📎添付DL**（u2 の「議事メモ.png」）・**既読セパレータ**（初回オープンで未読区切り）・comment 権限。※自分でも SC-32 で解放した魔法をチャットで使える。
- [x] **SC-24 チャット completed 凍結** ✅受入OK（2026-09-16）＝完了クエスト「請求書処理の電子化デモ」のチャットで入力欄が**凍結バナー**（投稿/編集/削除/リアクション不可・過去ログ閲覧のみ）。
- [x] **SC-24 受入指摘 DFT-E-006〜011（E-TC-214〜222・コミット `5c5b539`）** ✅受入OK（2026-09-16）＝ブラウザ受入で認定した不具合を回帰テスト同梱で修正（全 green・ユーザー確認済み）:
  - DFT-E-006 引用ジャンプ＝引用元がフローティング文脈バー背後に潜り着地点が不明→バー下端＋余白へスクロール＋一時ハイライト（reduce は静止ハイライト・E-TC-214/215）
  - DFT-E-007 入力欄の右側が無反応＝`.composer`(sticky) の z-index 欠落で重なるメッセージ子要素にクリックを奪われた→`z-index:9`（上部バーと対称・E-TC-216）
  - DFT-E-008 最小化中の引用返信で無反応＝引用チップが非表示だった→引用追加時に入力欄を展開＋focus（E-TC-217）
  - DFT-E-009 自分の投稿が再入室で未読＝「ここから未読」が自分の投稿の上に出た→表示側で自分の投稿の上には区切りを出さない（`effectiveFirstUnread`・E-TC-219）
  - DFT-E-010 全件未読の初期スクロールがバー背後に潜る→`scrollTopForTarget` でバー下へ着地（E-TC-220）
  - DFT-E-011 既読を可視性ベースに一本化＝**実際に画面に見えたら既読**（背面タブは既読にしない・従来のアドホック既読を撤去・E-TC-221/222）
  - ホバー操作メニューにツールチップ＋使用中アクティブ表示（リアクション済/ピン/引用/編集中・E-TC-218）
- [x] **SC-32 魔法スキル G（G-TC-201）** ✅受入OK（2026-09-16）＝カタログ/SP残高/解放数が実データ・SP を使って解放（確認→報酬スナックバー）→ SC-24 の魔法ピッカーで使えるようになる通し。
- [x] **SC-30/SC-31 ショップ/アバター G（G-TC-202/203）** ✅受入OK（2026-09-16）＝ショップでコイン購入（確認→報酬・残高減）→アバターで着せ替え（各スロット1点・即反映）→SC-30 で「所有済み」。要コイン（評価等で獲得）。
- [x] **SC-31 3Dビューア/ベース体切替（K-TC-015・e2e green）**＝`/avatar` で 3D Canvas 描画（WebGL 時・非対応は 2D マスコットへ自動フォールバック§9.3）＋ベース切替（男/女）が `PUT /me/avatar-base` で永続（リロード反映）。**実VRMアセット未整備のためプレースホルダ humanoid**（実描画・回転・永続は e2e/スクショで確認済み）。実 VRM 差し替えは `AvatarViewer3D.tsx` seam。
- [x] **SC-41 ランキング G（G-TC-206）** ✅受入OK（2026-09-16）＝期間タブ（今週/先週/今月/通算）でスコア（獲得XP＋コイン）順位・自分順位/総人数が実データ・表彰台。※画面は**常に先頭で開く**（自分の順位へは「▼ 自分の順位へ」で手動ジャンプ・G-TC-171）。
- [x] **SC-40 実績 G（G-TC-207）** ✅受入OK（2026-09-16）＝収集サマリー「{unlocked} / 12」が実データ・シークレット未獲得は「？？？」で伏せ・DataTable（カテゴリー/ティア/状態フィルタ）。付与は活動連動で自動。**積み上げタイミングは backend で担保**＝count/評価(G-TC-502/503)・count/vote/selection/chat(G-TC-509)・level(G-TC-510)・streak_login(G-TC-511)・all_spells(G-TC-505)・all_items(G-TC-512)・報酬1回(G-TC-504)。
- [ ] **SC-25/SC-22 評価 F（F-TC-201〜203）**＝SC-25 で5観点採点＋総評→確定→SC-22 §4.6 に平均/観点/総評/コインが反映・下書き復元・owner の選定トグル（★選定済み＋「選定候補」バッジ）。評価者/選定は my_permissions 出し分け。
- [x] **SC-02 通知 H（H-TC-208）** ✅受入OK（2026-09-16・画面/一覧）＝別ユーザーの発火で通知が出る→状態/種別絞り込み・行クリックで既読化＋参照先遷移・「すべて既読」で未読0。**全発火パターンは手動でなく backend テストで担保**（役割分担）＝mention(E-TC-107/223)・idea_comment/follow_comment・follow_selection・achievement(H-TC-143)・quest_party_invited・security_*(H-TC-151〜162)・dedup(H-TC-141/142)・ゲーム除外(H-TC-110〜112)・locale(H-TC-170)。**未担保（follow-up）＝`follow_evaluation`・`idea_updated`・`magic_reaction` の生成テスト**。
- [ ] **SC-92/93 メール確認 ADR-0009（B-TC-169 等）**＝「確認メールを送信」→MailHog で確認リンク→`/email-verify/confirm` 確定→verified バッジ化を通しで。

## backend API 進捗

登録ルータ = **auth / admin / me**（control_plane）・**quests / ideas / evaluations / chat / gamification / shop / achievements / notifications**（tenant）。

| ドメイン | ルータ | 状態 |
|---|---|---|
| 認証（A/B） | `control_plane/auth`・`control_plane/admin`・`control_plane/me` | ✅ ログイン/管理/プロフィール。**K.4.1 `PUT /me/avatar-base`＝3D アバター男女2ベース選択（migration 0019・`users.avatar_base`・`GET /me` に同梱・K-TC-011-014）** |
| フィード（G.5.1・FR-36） | `tenant/gamification`（feed）／フロント `features/feed` | ✅ **backend＋フロント完了**＝`GET /quests/{id}/activities`（SC-12 クエスト内・門番パーティー所属）・`GET /me/feed`（SC-01 チーム横断・quest 付き）＝公開種別のみ（`PUBLIC_FEED_REASONS`）・カーソル・G-TC-109/110。共有 `ActivityFeed` を SC-12（ランキング下）/SC-01（チームアクティビティ）に配線＝アイデア公開→両フィードに反映をブラウザ実測（人間可読は reason→文言・ref リンクは D/E 依存） |
| クエスト（C） | `tenant/quests` | ✅ 一覧/詳細/CRUD |
| アイデア（D） | `tenant/ideas` | ✅ **15 EP**（一覧/詳細/作成/編集/公開/削除＋投票 POST/DELETE・フォロー POST/DELETE＋添付 POST/DELETE・DL＋**版タイムライン GET・差分 GET**〔D.4〕）。公開処理で初版 revision=1 記録・`idea_revisions.created_at` 追加（migration 0011）。**XP 結線済み＝公開で投稿 XP+50（idea_post・冪等）／投票で XP+5（各アイデア初回のみ・日次上限5/日・vote 冪等）＝G 台帳（§8-⑥）** |
| 評価（F） | `tenant/evaluations` | ✅ **5 EP**（`GET evaluation/me`・`GET evaluation`〔集計・limited 非表示〕・`PUT evaluation`〔draft/submitted＋XP+30〕・`POST/DELETE select`〔XP+200・剥奪なし〕）。投稿者コイン確定 (a) 全員提出／(b) completed 遷移（C フック）＝`evaluation_coin` 冪等。migration 0012・G ledger 連動 |
| チャット（E） | `tenant/chat` | ✅ **8 EP**（`GET chat`〔一覧＋未読〕・`GET chat-activity`・`POST/PATCH/DELETE chat-messages`・`POST chat/read`＋**`POST/DELETE chat-messages/{id}/reactions`**〔通常/魔法・E.4〕）＝投稿/編集/削除・既読・活発度・添付・メンション・投稿XP+5・リアクション（マスタ絵文字）・魔法（1メッセージ1魔法/1チャット1回）。公開で chat_group 自動作成。migration 0013。**通知(H)結線済み（mention/idea_comment/follow_comment/magic_reaction）／リアルタイム(L)結線済み＝post-commit で `chat.*` を `chat:{cg}` へ publish（created/updated/deleted/reaction added/removed）** |
| ゲーム(G) | `gamification`・`shop`・`achievements` | ✅ ledger＋魔法（`/spells`・unlock）＋ショップ/装備（migration 0015）＋ランキング（`/rankings`）＋実績 2 EP（`/achievements`・`/me/achievements`・migration 0016）。**付与は `ledger.grant` の後フック（engine）で一元自動判定**（condition＝count/streak/level/all_*・tier コイン報酬・冪等）。SC-30/31/32/40/41 フロント接続済み |
| 通知（H） | `tenant/notifications` | ✅ **5 EP**（`GET notifications`〔カーソル §1.8・state/type 絞り込み・unread_count〕・`GET notifications/unread-count`・`POST notifications/{id}/read`・`/unread`・`/read-all`）＝自分宛スコープ（IDOR 404）。**生成は各発火ドメインが `notify()` を呼ぶ**（テナント発火系フル＝mention/idea_comment/follow_comment/magic_reaction/idea_updated/follow_evaluation/follow_selection/achievement/quest_party_invited）＋**`security_*` cross-plane**（`security_new_device`＝login/mfa verify・`security_password_changed`＝password-setup complete/自己PW変更〔me〕・`notify_account` で account→user 解決）。宛先重複排除（最具体1件）＋取得時レンダリング（§8-⑳）。migration 0017。**新端末認識＝有効 iq_trust**（MFA-ON=毎回 OTP／MFA-OFF=iq_trust を認識に流用・初回発行）。メール＝password_changed 常時／new_device は MFA-OFF 前倒し（`mail_outbox.params` 列＝0012）＋監査（auth.login.new_device/auth.password_changed）。**Redis publish(L)結線済み＝`notify()` の post-commit で `notification.created`＋`notification.unread_count` を `notifications:{user_id}` へ発行（既読操作も未読数を発行）**。SC-02 フロント接続済み |
| 全文検索（J） | `tenant/search` | ✅ **`GET /api/v1/quests/{id}/search`**（SC-12 全文検索タブ・PGroonga）＝ideas(title/body/value/note)/chat_messages(body)/attachments(original_name) を `&@~`＋`pgroonga_score`＋`pgroonga_snippet_html` で UNION スコア順。門番＝パーティー∩グループ AND（404・存在秘匿）。可視 WHERE（published・非削除・非トゥームストーン・**下書き除外**）を索引ではなくクエリで強制（J.0）。types 絞り込み・オフセットページング（total）・`q` バインド変数（§2.2③）。**db＝PGroonga 同梱カスタムイメージ（`impl/db/Dockerfile`）＋会社DB migration 0018（extension＋3索引）**。グローバル `GET /search` は予約。フロント＝`features/search/api.ts`＋SC-12 タブ（スニペット許可リストサニタイズ・§2.2④） |
| ダッシュボード集約（I） | `tenant/dashboard` | ✅ **`GET /api/v1/dashboard`**（読取合成の殻・新業務ロジックなし）＝hero/drafts(quest/idea/eval)/unvoted_ideas/quests/followed_ideas/weekly_ranking/notifications/roles/login_bonus を1レスポンスに合成。横断 read は D/F repo に追加（`list_draft_ideas_by_author`/`list_unvoted_published_ideas`/`list_followed_ideas`/`list_draft_evaluations_by_evaluator`＋C `list_member_quest_ids`・別 EP 新設せず・I.3）。リッチパネルは C/G/H の application 再利用。部分失敗 best-effort（パネル単位 null）。login_bonus＝Redis ワンショット（A の login で mark・I が GETDEL consume）。上限＝通知5/未投票・参加・フォロー各6/下書き全件 |
| リアルタイム（L） | `tenant/realtime` | ✅ **WS `GET /api/v1/realtime`**（Cookie セッション認証＋Origin 検証）＝プロセス毎ハブ（`redis.asyncio` PSUBSCRIBE `notifications:*`/`chat:*`＋`realtime:revoke`・購読テーブル topic→接続・`company_id` フィルタで cross-tenant 遮断）。`notifications:{user_id}` 自動購読／`chat:{cg}` は動的購読（門番＝REST と同一・gate.py）。**発行＝H（notify post-commit）・E（chat post-commit）・C（除去で `publish_revoke`＝L.4 購読ドロップ）**。配信専用（書き込みは REST）。lifespan でハブ起動/停止。フロント＝`lib/realtime.ts`（単一 WS・再接続）＋`RealtimeProvider`（ベル）／SC-02・SC-24 は WS で再取得 |

**メール確認フロー（ADR-0009）実装済み**＝送信 EP（B.2/B.2.1）・公開 confirm（`/auth/email-verify/confirm`）・`accounts.email_verified_at`・SC-92/93 バッジ＋アクション。

**複製プリフィル 全項目化（デザイン標準 §複製・2026-09-06 改定）**＝入力項目は一意キー/重複禁止項目も含めて全部プリフィル（例外＝サーバー自動採番/システム生成列のみ）。関連＝アカウント一覧応答 `AccountListItem.memberships`（有効所属 `[{group_id, role}]`・会社DB バッチ読取・API設計 B.2 既定分の実装・B-TC-171）を追加し、複製の所属引き継ぎ／編集画面の現所属表示に使用。コントロールは style-guide 準拠に統一（`.checkbox`/`.select`）＝フロント実装フロー規約 §2.1（コントロール実装前に style-guide.html のモック有無を確認）。

**ダイアログ内コンテンツ標準（デザイン標準 §4.1・2026-09-18）**＝参照系＋入力系で本文を「囲まない＋項目ごとの薄い仕切り線」に統一（共通 `.dialog-*`＝`design-system.css`／mock `style-guide.html`「10b」）。装飾枠は撤去（評価 `.eval-idea`／評価フォーム外周 `.card`〔モーダル時〕／アイデア文脈 `.card`）・機能枠は維持（`.vis-opt`/`.eval-summary`）。`Field` に任意 `className`（項目先頭に `.dialog-section`）。横並び `.field-row` は廃止して1行ずつ。アイデア「任意項目」（`.optional`）は開閉とも枠線で囲う。フッター文言＝フォーム「キャンセル」／参照・その場アクション・エラー「閉じる」。適用＝JoinRequestDialog／QuestCatalogView（参加前詳細）／QuestForm／IdeaForm／EvaluationView／AccountFormPanel／CompanyCreateForm／QuestGroupSection／MemberAddPanel／QuestResultTab。**管理系/評価/振り返り編集の実機受入は管理者アカウントで要確認（seed は非管理者）**。

**情報インプット機能＝設計完了・frontend 移植済／backend Phase A（一覧）結線済（2026-09-20・FR-41）**＝外部WEB情報を手動貼付→属性→アイデア/コンセプト/クエストへ動的リンク（差別化の核）。設計4点は実体化済み＝要件[FR-41](../doc/要件定義/README.md#6-機能要件)／データモデル[§5.33-5.37](../doc/データモデル.md)（`info_items`/`info_item_categories`/`info_links`/`info_tokens`/`info_curators`＋`info_*` enum）／API [ドメイン N](../doc/API設計/N_情報インプット.md)／テスト[N_情報インプット](../doc/テスト/N_情報インプット.md)（N-TC-001〜009・101〜107・pytest 16 green）／画面[SC-50/51/52](../doc/画面設計/screens/SC-50_情報インプット.md)。**進捗＝モック→Next.js `features/info-input` 移植完了→backend `app/tenant/info`（4層＝schemas/repository/application/router・janome/PGroonga）＋migration 0028＋一覧サーバー委譲結線（`GET /info-items`・`/word-cloud`）＝一覧タブ/状態タブ(facets)/続報束ね(roots_only)/ワードクラウド/全文検索タブが実データで動作**。**残＝Phase B 詳細（`GET /info-items/{id}`）→ Phase C 登録/編集/続報（`POST`/`PATCH`・nh3・要約・自動リンク）＝この着手前に「編集/属性制御の画面・認可仕様」を整理（curator 認可・URL 付きモーダルの出し分け）→ Phase D 仕上げ**。`info_link_target=concepts/assumptions` はコンセプト段で実体化。

## 既知の課題（詳細は [`../handoff.md`](../handoff.md) §5 / §7）

- **締切(時刻)後の投票 事前無効化**＝`completed`（凍結）は事前 disabled 済みだが、締切日時超過は DTO に deadline 判定を組まず現状サーバー 409 で理由提示（deadline ベースの事前 disabled は follow-up）。
- **`IdeaDetailDTO` に `quest_id`/カテゴリー無し**＝SC-22 の「クエストへ戻る」が暫定。
- tsc 既知エラー＝なし（`Snackbar.tsx:122` の React19 `useRef` 型を `useRef<...|undefined>(undefined)` に修正済み）。※ShopView の csvVal 型は G 接続時に修正済み。

## 起動・テスト

```bash
# フルスタック起動（e2e は --profile workers 必須）
docker compose -f impl/compose.yaml --profile workers up -d --build
# ポート: frontend :3000 / backend :8000(/healthz) / db :5432 / redis :6379 / minio :9000,:9001 / mailhog :8025

# frontend tsc / vitest 単体（cwd=impl/frontend）
cd impl/frontend && npx tsc --noEmit
cd impl/frontend && npx vitest run   # node 環境の純ロジック単体（DOM 非依存）

# backend pytest（cwd=impl 厳守）
cd impl && docker compose -f "$PWD/compose.yaml" run --rm -T -v "$PWD/backend:/app" backend pytest tests/ideas -q

# TC-ID トレーサビリティ（コミット前ゲート・リポジトリ直下）
python3 scripts/check_tc_traceability.py
```

dev ログイン（PW 全て `Passw0rd!`）＝system_admin `OPS`/`admin@ops.example`／一般 `ACME-01`/`user@acme.example`（MFA OFF）・`ACME-02`/`mfa@acme2.example`（MFA ON）。詳細な e2e/openapi 再生成手順は [`../handoff.md`](../handoff.md) §8。
