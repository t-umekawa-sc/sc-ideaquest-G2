# ドメイン H. 通知（テナントプレーン）＝詳細確定（2026-08-07）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.8 一覧〔カーソル〕・§1.12 リアルタイム配信〔WebSocket `notifications:{user_id}`〕）を参照。多言語方針はデータモデル §8-⑬。通知の**発火元**は各ドメイン＝[`D_アイデア・添付・版・投票・フォロー.md`](./D_アイデア・添付・版・投票・フォロー.md)（D.126）・[`E_チャット・リアクション・魔法発動.md`](./E_チャット・リアクション・魔法発動.md)（E.6）・[`F_評価.md`](./F_評価.md)（F.5）・[`G_ゲーミフィケーション.md`](./G_ゲーミフィケーション.md)（G.4）・[`A_認証・セッション.md`](./A_認証・セッション.md)（A.9・`security_*`）・**K（プロフィール〔確定済み〕・`security_password_changed` の自己PW変更経路＝A.9-⑧(b)/K.3）**。本ファイルはドメイン H の分割レビュー成果。

対象画面＝**SC-02 通知一覧**（＋全認証画面共通ヘッダーの 🔔 ベル・未読バッジ）。すべて**テナントAPI**（会社DB＝`notifications`）。データモデル §5.24・§3（`notification_type`）・§8-⑬（i18n）・§8-⑳（取得時レンダリング）。コーディング規約 §1・§2.2・§3.4・**§3.5-(3)（副作用は post-commit＋冪等）**準拠。

**この分割レビューでユーザー選択により確定（2026-08-07）**:
- **本文は取得時レンダリングで完全多言語化**＝`notifications.params jsonb` を追加・`body` を NULL 可のフォールバックに緩和（データモデル §5.24・§8-⑳）。受信者のロケール切替に既存通知も追従。
- **1 イベント×1 宛先は最も具体的な種別で1件に集約**（重複排除・E.6 が H へ先送りした規則）。

## H.0 責務境界・アクター

- **責務の分担**:
  - **生成（誰に・どの種別を・いつ）＝各発火ドメイン**が担う（下表）。書込側 application が**本処理コミット後の post-commit で** H の**通知サービス `notify()` を呼ぶ**（§3.5-(3)・投稿/評価等の本体成功を優先し、通知生成は副作用の殻で・冪等）。
  - **H が担う**＝(1) 通知サービス `notify()`（宛先解決・**重複排除**・`notifications` 行 INSERT・`params` 保存・**`notifications:{user_id}` への Redis publish**）、(2) **取得/未読/既読の API**、(3) **本文テンプレ（メッセージカタログ・多言語）と取得時レンダリング**、(4) 将来の外部配信（メール等）。
  - **Redis publish（`notifications:{user_id}`）＝H の `notify()` が post-commit で発行**／**WS トランスポート（購読管理・クライアントへの転送）＝ドメイン L**（§1.12）。すなわち H が「行 INSERT＋Redis 発行」まで担い、L はその channel を購読して WS へ転送する（H は「真実（REST）」・WS は「速報」）。
- **アクター＝認証済みユーザー全員**（**自分宛のみ**＝`notifications.recipient_id`＝セッションユーザー・テナント内）。他人宛の通知は 404 相当で一切返さない。
- 認可失敗＝**403**／未認証＝**401**／対象なし＝**404**。

### 通知種別と参照先（`notification_type`・§3／発火ドメイン）

| 種別 | 発火ドメイン | 宛先 | 参照先（`ref_*`） | 主な `params` |
| --- | --- | --- | --- | --- |
| `mention` | E（投稿） | メンションされた各ユーザー | `ref_idea_id`＋`ref_chat_message_id` | `actor_name` |
| `idea_comment` | E（投稿） | アイデア投稿者（自分除く） | `ref_idea_id`＋`ref_chat_message_id` | `actor_name` |
| `follow_comment` | E（投稿） | フォロワー | `ref_idea_id`＋`ref_chat_message_id` | `actor_name` |
| `follow_evaluation` | F（submit） | フォロワー | `ref_idea_id` | — |
| `follow_selection` | F（select） | フォロワー | `ref_idea_id` | — |
| `idea_updated` | D（版追加） | 投票者＋フォロワー（FR-34） | `ref_idea_id`＋`ref_idea_revision_id` | `revision` |
| `magic_reaction` | E（魔法付与） | 対象メッセージの投稿者 | `ref_idea_id`＋`ref_chat_message_id` | `actor_name`,`spell`〔`spell_id`/`code`〕 |
| `achievement` | G（実績フック） | 本人 | `ref_achievement_id` | `tier`,`coin` |
| `security_new_device` | A（ログイン成功） | 本人 | —（本文のみ） | `device`,`ip`,`at` |
| `security_password_changed` | A/K（PW変更完了） | 本人 | —（本文のみ・メールも） | `at` |

- **`security_*` はオプトアウト不可**（A.9-⑧・将来の種別 ON/OFF 対象外）。`security_password_changed` のメール実送信は認証/セキュリティ基盤（A 経路＝初回設定/再設定・K 経路＝プロフィールでの自己PW変更のいずれも／H は会社DBの通知行を担当）。**`security_password_changed` は A（初回設定/再設定）に加え K（プロフィールでの自己PW変更・A.9-⑧(b)）も発火元**＝どちらの application も post-commit で `notify()` を呼ぶ（K は確定済み・K.3 と整合）。

## H.1 通知サービス `notify()`（生成・内部）

各発火ドメインの application が post-commit で呼ぶ**内部サービス**（外部 HTTP エンドポイントではない）。シグネチャ（概念）＝`notify(recipient_ids, type, refs, params)`。

- **重複排除（1 イベント×1 宛先＝1件・最も具体的な種別優先）**: 同一イベントで 1 ユーザーが複数種別に該当する場合（例＝チャット投稿で mention 対象かつフォロワー）、**最も具体的な種別1件のみ**生成する。優先順位＝`mention` > `idea_comment` > `follow_comment`（コメント系）／評価・選定系も同様に本人性の高い方を優先。発火ドメインは候補宛先を種別ごとに渡し、H が宛先単位で最優先1件に畳む。
- **`params` の保存**＝ref から辿れない/後で変わりうる値（`actor_name`〔発火時点の表示名〕・付与額・`tier`・security の端末情報）を**イベント時点でスナップショット**して `notifications.params`（jsonb）に格納（§8-⑳）。ref から解決できる値（idea 件名・実績名）は保存せず取得時に解決。
  - **魔法名は識別子を凍結**＝`magic_reaction` の `params.spell` には**spell の識別子（`spell_id`/`code`）**を入れ、表示名は取得時に `spells.name_{locale}` を解決する（表示名そのものを凍結しない＝ロケール切替への追従を保つ）。
  - **`idea_updated` の `revision`（表示最適化の例外）**＝版番号は本来 `ref_idea_revision_id`→`idea_revisions.revision` で解決できるが、一覧描画の join を避けるため `params.revision` にも保持する（「ref から解決できる値は保存しない」原則の**意図的な例外**として明示）。
- **`body`（フォールバック）**＝既定ロケール（`ja`）でレンダリングした文字列を任意で保存（レンダリング不可時の保険・§5.24）。正は取得時レンダリング（H.2）。
- **Redis publish もこのサービスが担う**＝行 INSERT に続けて `notifications:{user_id}` へ新着＋未読数イベントを **post-commit で publish**する（L が購読して WS 転送・§1.12）。行作成と配信発行を1ステップに閉じ、通知の関心を H に集約する（発火ドメイン側は宛先候補・`type`・`refs`・`params` を渡すだけ）。
- **冪等/信頼性の意味論＝at-most-once**＝post-commit は best-effort（§3.5-(3)）で**自動リトライしない**ため、commit 後にプロセス断があると**取りこぼしうる（未生成）**が、**二重生成は起きない**（post-commit を再実行しない＋クライアント再送は `Idempotency-Key` キャッシュが本体ごと弾く）。種別固有の追加 backstop は実績のみ（`UNIQUE(user_id, achievement_id)`）で、chat 系/`idea_updated` は専用の dedup キーを**置かない**（at-most-once で十分・重複防止の一意制約は不要）。**「取りこぼしゼロ」が要件化されたら outbox 化**（§3.5-(3) の再検討目安）。

## H.2 通知の取得・未読数（読み取り）

| メソッド/パス | 概要 | リクエスト（クエリ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /notifications` | 自分宛の通知一覧（SC-02） | `state?`（`all`〔既定〕/`unread`）・`type?`（`notification_type`・複数可）・`limit`/`cursor`（§1.8） | `data`=通知行（下記「通知表現」）＋`page_info`＋`unread_count` |
| `GET /notifications/unread-count` | 未読数のみ（ヘッダーベル・軽量） | — | `{unread_count}` |

### 通知表現（各行）
- `{id, type, body〔取得時レンダリング済み〕, ref〔種別に応じた遷移先＝{idea_id?/chat_message_id?/idea_revision_id?/achievement_id?}〕, is_read, created_at, meta?〔獲得表示用＝{coin?}（`achievement` のティア連動コイン）〕}`。**meta は本人が獲得した値のみ**＝`achievement`（自分のコイン）に限る。**選定/評価の XP・コインは投稿者/評価者の台帳〔G〕**であり、`follow_selection`/`follow_evaluation` の宛先はフォロワーなので meta には載せない（F.5＝投稿者本人向け選定通知は現状無し）。
- **`body` は取得時レンダリング（§8-⑳）**＝サーバーが `type` のテンプレ（メッセージカタログ・受信者 `users.locale`〔未設定は Accept-Language→既定 `ja`〕）に `params` を差し込み、`ref_*` から件名等（`ideas.title`・`achievements.name_{locale}` 等）を解決して生成。ロケール切替で既存通知も追従。
- **未読数**＝`notifications(recipient_id, is_read=false)` の集計（インデックス `(recipient_id, is_read, created_at)`・§5.24）。
- **ページング**＝カーソル（§1.8・新着降順）。SC-02 の「今日/昨日/それ以前」グルーピングはフロントが `created_at` で行う。
- **リアルタイム**＝新着・未読数は WS `notifications:{user_id}` で push（§1.12・配信は L）。WS 未接続時やベル初期表示は本 API（`GET /notifications`・`/unread-count`）で取得（§1.12 フォールバック）。

## H.3 既読・未読（更新）

| メソッド/パス | 概要 | リクエスト（パス） | レスポンス |
| --- | --- | --- | --- |
| `POST /notifications/{id}/read` | 個別に既読化（SC-02・参照先クリック時もサーバーで既読化） | パス: `id` | 200（`{id, is_read:true, unread_count}`） |
| `POST /notifications/{id}/unread` | 個別に未読へ戻す（SC-02「未読に戻す」） | パス: `id` | 200（`{id, is_read:false, unread_count}`） |
| `POST /notifications/read-all` | すべて既読化（`type` フィルタ適用可） | ボディ（任意）: `{type?}` | 200（`{updated, unread_count:0 or 残数}`） |

- 対象は**自分宛のみ**（他人の通知 id は 404）。冪等（既に既読への read は no-op で 200）。
- 既読/未読の反転は表示状態のみ（遷移しない）。行クリックの遷移（参照先解決）はフロントが `ref` で行い、併せて `read` を呼ぶ。
- **`security_*` も既読操作は可**（オプトアウト不可なのは「受け取らない設定にできない」の意味で、既読化はできる）。

## H.4 他ドメイン境界・残 TBD

- **委譲/連携**: 通知の**発火（生成契機）**＝D/E/F/G/A（＋K＝自己PW変更・H.0 表）／**Redis publish（`notifications:{user_id}`）＝H の `notify()`（post-commit）**・**WS トランスポート＝L**（§1.12）／**多言語テンプレの元方針**＝§8-⑬（実カタログは H が保有）／`security_*` のメール送信＝A。
- **確定済み（本レビュー）**: 取得時レンダリング＋`params`/`body` NULL 可（§5.24・§8-⑳）／1 イベント×1 宛先＝最具体種別1件に集約／生成は H の `notify()` を post-commit 呼び出し。
- **セキュリティ突合（規約 §2.2）**: 主リスク＝**IDOR（他人宛通知の閲覧/既読操作）**。対策＝全 EP で `recipient_id = セッションユーザー` を強制し不一致は 404（列挙耐性・H.0/H.3）。本文に権限外情報を載せない（評価スコアは F.5 が除外・`follow_*` は「付きました」程度）。`security_*` の `params`（IP/UA/日時）は本人の自己情報のみ。書き込み系（read/unread/read-all）も自分宛限定。監査証跡は各発火ドメイン側（例＝A.9-⑥）。
- **残 TBD（軽微・実装 or 運用で確定）**: **グルーピング/集約**（「3件の新しいコメント」等の束ね方＝SC-02 §9・現状は 1 イベント1件で束ねない）／**保持期間・件数上限・自動既読**／**種別ごとの ON/OFF 設定**（`security_*` は対象外）／**参照先が論理削除/トゥームストーンのときの取得時レンダリング**（idea 論理削除・チャット tombstone＝`params` のみで描画し遷移を抑止/無効表示にするか）／**外部通知（メール/Slack）**の時期・方式（将来）／レベルアップ/SP 獲得を通知に含めるか（現状は SC-01 の演出）。
