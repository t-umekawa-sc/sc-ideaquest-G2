# impl — ideaquest 実装

社内向けアイデア創出ゲーミフィケーション型マルチテナント SaaS「ideaquest」の実装コード。
設計の正本は [`../doc/`](../doc/)（要件・API・画面・データモデル）、開発の引き継ぎは [`../handoff.md`](../handoff.md)。

- **frontend/** — Next.js（App Router・dev モード起動）。`shared.css` を単一デザインシステムに段階移行中。
- **backend/** — FastAPI 4層（router / application / repository / infra）。
- **compose.yaml** — フルスタック（PostgreSQL / Redis / MinIO / MailHog / workers / Docker）。

> 進捗の最終確認: **2026-08-27**。**tsc クリーン（Snackbar.tsx:122 の React19 useRef 型エラー修正済み）・frontend vitest 単体 19/19（`companies/api.test.ts` 9＋`search/snippet.test.ts` 6＋`avatar/avatar.test.ts` 4＝ベース正規化/WebGL・motion の SSR ガード）**・**backend `pytest tests/` 全体 468 passed（フラキー根治済み＝pytest 実行時はワーカ停止・8/8 green 実測）**（評価 F ＝23＋**SC-12 評価集計 D-TC-150／コメント数 D-TC-151／XP 結線 D-TC-160-162（投稿+50・投票+5）**＋**セキュリティ横断 SEC-TC-001-040＋J-TC-141（応答ヘッダ§10・マジックバイト§8・cross-tenant・機密ログ非出力・Mass Assignment・検索インジェクション）**／チャット E ＝22／魔法解放 G ＝6／ショップ/装備 G ＝8／ランキング G ＝5／実績 G ＝6／**通知 H ＝15＋security 6**／**リアルタイム L ＝8**／**ダッシュボード I ＝6**／**全文検索 J ＝8（PGroonga）**／**K アバターベース 4（K-TC-011-014＝`PUT /me/avatar-base`）**）・e2e sc-24（3）＋sc-32（1）＋sc-30（2）＋sc-41（1）＋sc-40（1）＋**sc-02（1＝通知実データ H-TC-208）**＋sc-25（3）＋sc-22（10）＋sc-21（6）＋sc-92d（1）＋**sc-31（1＝K-TC-015 ベース体切替の永続）**passed・TC-ID トレーサビリティ ✅（code 393）。**db は PGroonga 同梱のカスタムイメージ（`impl/db/Dockerfile`）**。**セキュリティ応答ヘッダ（nosniff/X-Frame/Referrer-Policy/CSP frame-ancestors・HSTS は TLS 時）を全応答に付与（main.py middleware・§10）／アップロードはマジックバイト検証（§8）**。
> 開発方針＝**1画面単位で backend 接続ループ**（各画面でユーザー受入ゲート）。実装順の正本＝[`../doc/実装計画.md`](../doc/実装計画.md)＝アカウント→クエスト(C)→アイデア(D)→評価→その他。

## 画面実装進捗（SC-xx）

凡例: ✅ backend 接続済み ／ 🟡 部分接続（一部が表示のみ/デモ）／ ⬜ モック（画面のみ・backend 未接続）

| 画面 | 名称 | 状態 | ルート | 備考 |
|---|---|---|---|---|
| SC-00 | ログイン | ✅ | `(auth)/login` | 401→`/login?reason=…` セッション終了通知（デザイン標準 §14）。password-reset/-setup・email-change・**email-verify/confirm**（ADR-0009）も配置 |
| SC-01 | ダッシュボード | ✅ | `(app)/` | **実接続（`GET /dashboard`＝I 集約1本）**＝ヒーロー（残高＋level）・週間ランキング・下書き（quest/idea/eval 進捗）・未投票・参加中クエスト・フォロー中・最近の通知・roles・login_bonus。クイック投票（POST /ideas/{id}/vote）・フォロー解除（D follow EP）実接続・login_bonus トースト。空パネル非表示 |
| SC-02 | 通知一覧 | ✅ | `(app)/notifications` | 実接続（`getNotifications`＝一覧＋未読数・取得時レンダリング済み body・`markRead`/`markUnread`/`markAllRead`）。状態/種別（9カテゴリー）絞り込み・日付グループ・クリックで既読化＋ref 遷移。生成はサーバー（発火ドメイン）。**security_* も実データ**。**リアルタイム(L) 接続済み＝WS で新着/未読数を即時反映（ヘッダーベル＋一覧）** |
| SC-03 | プロフィール | ✅ | `(app)/profile` | K.1（`/me`）接続済み |
| SC-10 | クエスト一覧 | ✅ | `(app)/quests` | 複製対応済み。💡件数列は `idea_count`（公開アイデア数）に連動 |
| SC-11 | クエスト作成/編集 | ✅ | `(app)/quests/new`・`[questId]/edit` | URL 付きモーダル（Parallel＋Intercept） |
| SC-12 | クエスト詳細 | ✅ | `(app)/quests/[questId]` | 本体＋**アイデアタブ（D.1・評価列 F 実接続＝`evaluation` 集計 n/5・評価待ち/評価済・可視のみ）**＋**全文検索タブ（J・PGroonga・種別/スニペット/ページング/遷移）**＋**クエスト内週間ランキング（G 実接続＝`GET /rankings?scope=quest:{id}&period=this_week`）**。ヘッダー💡件数は `idea_count` 連動。**💬 コメント数も実接続（E 非削除チャット件数）**。残 demo なし |
| SC-21 | アイデア登録/編集 | ✅ | `(app)/quests/[questId]/ideas/new`（＋モーダル） | §4.7 入力検証（**サーバエラー経由の 3 チャネル e2e D-TC-216**＝完了クエスト編集 409）・登録モーダル初期誤検証 fix 済み・**添付アップロード**（D.3・保存後に送信）・**編集での既存添付の一覧＋削除**（D-TC-218・確認ダイアログ→即時削除・版を生まない） |
| SC-22 | アイデア詳細 | ✅ | `(app)/ideas/[ideaId]` | 本体＋投票/フォロー（D.5/D.6）＋添付（D.3）＋quest 参照（D.1）＋更新履歴（D.4）＋評価結果/選定（F.1/F.3）＋**チャット活発度/プレビュー（E.1・`getChatActivity`/`getChat`）**。全セクション実接続 |
| SC-24 | アイデアチャット | ✅ | `(app)/ideas/[ideaId]/chat` | **実接続**（`getChat`/`postMessage`/`editMessage`/`deleteMessage`/`markRead`/`addReaction`/`removeReaction`/`getSpells`）＝投稿/編集/削除・リアクション/魔法・メンション（実メンバー）・添付（署名DL）・**複数引用**（`chat_message_quotes`・§5.16b）・既読・comment 権限/completed 凍結。**リアルタイム(L) 接続済み＝chat:{cg} 購読で新着/編集/削除/リアクションを即時反映（WS 受信で再取得）** |
| SC-25 | 評価画面 | ✅ | `(app)/ideas/[ideaId]/eval`＋`@modal/(.)ideas/[ideaId]/eval` | 5観点採点＋観点別コメント＋総評＋公開範囲＋集計プレビュー（F.2）。`getMyEvaluation` プリフィル・確定/下書き＝`putEvaluation`・422/403/409 はサーバー権威。**URL 付きモーダル化済み**＝SC-22 ソフト遷移＝Intercept モーダル（`EvaluationModal`）／URL直・リロード＝フルページ（`EvaluationView` が `onClose` で chrome 出し分け） |
| SC-30 | ショップ | ✅ | `(app)/shop` | 実接続（`getItems`＝カタログ＋所有＋コイン残高・`purchaseItem`＝コイン消費・残高不足/所有済みはサーバー権威）。購入は確認ダイアログ→報酬スナックバー。アイコンはクライアント presentation |
| SC-31 | アバター着せ替え | ✅ | `(app)/avatar` | 実接続（`getItems`＝所有/装備・`updateEquipment`＝各スロット1点・楽観更新＋サーバー権威）。未所有はショップ導線。**3D＝R3F(three)骨組み導入**＝WebGL 対応時は 3D ビューア（プレースホルダ humanoid＋ドラッグ回転・`prefers-reduced-motion` 尊重）／非対応は 2D マスコットへ自動フォールバック（progressive enhancement・§9.3）。**ベース切替（男/女）→`PUT /me/avatar-base`**（SSR 初期値＝`GET /me`）。**実VRMアセット（男女2体＋装備パーツ）は未整備＝差し替え seam**（`AvatarViewer3D.tsx` TODO・§9.2） |
| SC-32 | 魔法スキル | ✅ | `(app)/spells` | 実接続（`getSpells`＝カタログ＋SP残高＋unlocked/can_unlock・`unlockSpell`＝SP消費・前提/二重解放はサーバー権威）。解放は確認ダイアログ→報酬スナックバー。演出コピーはクライアント（G シードに説明文なし） |
| SC-40 | 実績バッジ | ✅ | `(app)/achievements` | 実接続（`getAchievements`＝カタログ＋自分の獲得/進捗＋summary・シークレット未獲得は伏せる）。付与はサーバー（台帳フック）が自動判定＝表示のみ。DataTable（カテゴリー/ティア/状態） |
| SC-41 | ランキング | ✅ | `(app)/ranking` | 実接続（`getRankings`＝期間×会社スコープ・獲得XP＋獲得コイン集計・me 常時同梱）。期間タブ（今週/先週/今月/通算）で再取得・表彰台/一覧/自分順位 |
| SC-90 | クエストグループ管理 | ✅ | `(app)/admin/quest-groups` | メンバー管理含む |
| SC-91 | システム管理 | ✅ | `(app)/admin/companies` | 会社一覧・手動プロビジョニング |
| SC-92 | 会社詳細 | ✅ | `(app)/admin/companies/[id]` | 会社プロビジョニングは MVP 手動。**メール確認バッジ（未確認/確認済み）＋⋯「確認メールを送信」**（ADR-0009） |
| SC-93 | 会社アカウント管理 | ✅ | `(app)/admin/companies/[id]/accounts`・`admin/accounts` | 複製対応済み。**メール確認バッジ＋送信アクション**（ADR-0009） |

**接続済み画面のフロント feature**＝`auth`・`profile`・`quests`・`ideas`・`evaluations`・`chat`・`spells`・`shop`・`avatar`・`ranking`・`achievements`・`notifications`・`accounts`・`companies`・`questgroups`・`qgadmin`（各 `api.ts` が backend を叩く）。
**モック feature**（`api.ts` 無し）＝`dashboard`(一部)。

## ブラウザ受入状況（バッチ・後日まとめて）

> 上表の ✅/🟡＝**backend 接続＋e2e green** の状態。**ユーザーによるブラウザ受入は別軸**で、後日まとめて実施する（e2e green でクローズ扱い・次画面へ進む・[受入ゲート](../doc/規約/フロントエンド実装フロー規約.md) §1.1）。ここに受入待ちを集約し、受入完了までチェックを残す（受入用デモデータも受入完了まで削除しない）。**dev ログイン**＝`ACME-01`/`user@acme.example`/`Passw0rd!`・**MailHog**＝`http://localhost:8025`。

- [ ] **SC-22 更新履歴 D.4（D-TC-217）**＝デモデータ用意済み＝`http://localhost:3000/ideas/f183174b-b090-4151-972e-832b2f824a9a`（クエスト「【受入】更新履歴デモ」内「夜間配送の集約」）。「版 2（履歴）」→版2/初版・文字差分（価値 1̶0̶→5・本文語句差分・タイムリミット `（なし）→2027-01-31`）の見え方。
- [ ] **SC-21 §4.7 サーバエラー3チャネル（D-TC-216）**＝完了クエストのアイデアを「編集」→件名変更→「変更を保存」で 409→①上部サマリ ②足元ヒント ③持続エラースナックバー（自動消滅しない）。要 seed（完了クエスト＋公開アイデア）。
- [ ] **SC-22 投票/フォロー（D-TC-209〜212）**＝賛成/反対/切替/同ボタン再クリック取消・★フォロートグルの楽観更新＋サーバー権威。
- [ ] **SC-10/12 idea_count 連動**＝クエストカード/詳細の公開アイデア数が実データに連動。
- [ ] **SC-22 quest参照/completed 事前無効化（D-TC-213/214）**＝「クエストへ戻る」導線・カテゴリーバッジ・完了時の投票/新規フォロー disabled＋⏸凍結バッジ。
- [ ] **SC-21/22 添付 D.3（D-TC-215）**＝登録/編集で添付アップロード→SC-22 に実添付表示＋DL（署名URL）。
- [ ] **SC-21 編集モードの既存添付 削除（D-TC-218）**＝編集フォームに保存済み添付が出る→× →確認ダイアログ「削除する」で即時削除・トースト・SC-22 から消える（版は増えない）。
- [ ] **SC-24 チャット E（E-TC-201/203）**＝メッセージ投稿/編集/削除・**複数引用**・添付DL・@メンション候補・通常リアクション・魔法（SC-32 で解放した魔法）・既読セパレータ・comment 権限/completed 凍結。
- [ ] **SC-32 魔法スキル G（G-TC-201）**＝カタログ/SP残高/解放数が実データ・SP を使って解放（確認→報酬スナックバー）→ SC-24 の魔法ピッカーで使えるようになる通し。
- [ ] **SC-30/SC-31 ショップ/アバター G（G-TC-202/203）**＝ショップでコイン購入（確認→報酬・残高減）→アバターで着せ替え（各スロット1点・即反映）→SC-30 で「所有済み」。要コイン（評価等で獲得）。
- [x] **SC-31 3Dビューア/ベース体切替（K-TC-015・e2e green）**＝`/avatar` で 3D Canvas 描画（WebGL 時・非対応は 2D マスコットへ自動フォールバック§9.3）＋ベース切替（男/女）が `PUT /me/avatar-base` で永続（リロード反映）。**実VRMアセット未整備のためプレースホルダ humanoid**（実描画・回転・永続は e2e/スクショで確認済み）。実 VRM 差し替えは `AvatarViewer3D.tsx` seam。
- [ ] **SC-41 ランキング G（G-TC-206）**＝期間タブ（今週/先週/今月/通算）でスコア（獲得XP＋コイン）順位・自分順位/総人数が実データ・表彰台。
- [ ] **SC-40 実績 G（G-TC-207）**＝収集サマリー「{unlocked} / 12」が実データ・シークレット未獲得は「？？？」で伏せ・DataTable（カテゴリー/ティア/状態フィルタ）。付与は活動連動で自動（例＝評価3件で evaluator_3）。
- [ ] **SC-25/SC-22 評価 F（F-TC-201〜203）**＝SC-25 で5観点採点＋総評→確定→SC-22 §4.6 に平均/観点/総評/コインが反映・下書き復元・owner の選定トグル（★選定済み＋「選定候補」バッジ）。評価者/選定は my_permissions 出し分け。
- [ ] **SC-02 通知 H（H-TC-208）**＝別ユーザーの発火（メンション/フォロー中アイデアのコメント/評価/選定/更新・実績獲得・魔法・クエスト招集）で通知が出る→状態/種別絞り込み・行クリックで既読化＋参照先遷移・「すべて既読」で未読0。2ユーザー必要（発火者と受信者）。※要 seed（フォロー/パーティー関係）。
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
