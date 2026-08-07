# ドメイン G. ゲーミフィケーション（ショップ／装備／魔法／実績／ランキング／XP・コイン・SP）（テナントプレーン）＝詳細確定（2026-08-07）

> API 全体規約は [`README.md`](./README.md) 第1章（特に §1.5 会社DB動的ルーティング・§1.8 一覧〔カーソル〕・§1.9 冪等〔購入/解放〕・§1.14 Redis〔残高キャッシュ〕）を参照。認証系（ログイン XP の発火元）は [`A_認証・セッション.md`](./A_認証・セッション.md)、投票/投稿 XP は [`D_アイデア・添付・版・投票・フォロー.md`](./D_アイデア・添付・版・投票・フォロー.md)、チャット XP は [`E_チャット・リアクション・魔法発動.md`](./E_チャット・リアクション・魔法発動.md)、評価/選定 XP・評価連動コインは [`F_評価.md`](./F_評価.md)。本ファイルはドメイン G の分割レビュー成果。

対象画面＝**SC-30 ショップ／SC-31 アバター着せ替え／SC-32 魔法スキル／SC-40 実績バッジ／SC-41 ランキング**（＋全画面共通ヘッダーの Lv/コイン/SP）。すべて**テナントAPI**（会社DB＝`items`/`user_items`/`spells`/`user_spells`/`achievements`/`user_achievements`/`activities`/`users`〔残高〕）。データモデル §5.3・§5.19/§5.20・§5.25〜§5.29・§5.27・§3（`equipment_slot`/`rarity`/`spell_line`/`spell_effect`/`achievement_tier`/`activity_kind`/`activity_ref_type`）・§7（XP/コイン/SP・ランキング）・§8-③/⑥/⑩/⑲。コーディング規約 §1・§2.2・§3.1/§3.4 準拠。

**この分割レビューでユーザー選択により確定（2026-08-07）**:
- **実績付与＝台帳（`activities`）書き込みの post-commit フックで即時判定**（G が一元化・スケジューラ不要・冪等・データモデル §8-⑲）。

## G.0 アクター・スコープ／台帳（activities）の canonical 原則

- **アクセス＝認証済みユーザー全員**（自分の残高/所有/解放/実績/履歴を操作。他人の書き換え不可）。**テナント内**（会社DB分離・`company_id` はセッション由来・§1.5）。マスタ（`items`/`spells`/`achievements`）は**全社同一シード**（§8-③・`code` upsert）。
- **台帳 canonical は G が保有**（データモデル §7）: **`activities` が真実・`users.xp/level/coin_balance/skill_point_balance` はキャッシュ**。**付与/消費は必ず `activities` 追記＋残高更新を同一トランザクション（UoW）**で行う（元帳と残高の乖離を防ぐ・残高は `CHECK(>=0)`）。付与規則の**全一覧は G.6**（他ドメインはそこを参照）。
- **冪等**: 各付与は `activities` の存在（`kind`+`reason`+`ref_type`+`ref_id`）で二重付与を防ぐ（投票 XP と同方式・§7）。コイン/SP を動かす **`POST /items/{id}/purchase`・`POST /spells/{id}/unlock` は `Idempotency-Key` 必須**（§1.9・二重支払い防止）。
- **レベル**: `Lv n→n+1` 必要 XP=`100+(n-1)×50`・`users.level` は `xp` 従属キャッシュ・**レベルアップで SP+1**（`reason=levelup_sp`）・**上限なし**（§7/§8-⑥）。
- **残高の参照**: 共通ヘッダーの Lv/コイン/SP は `GET /me`（ドメイン K）またはダッシュボード集約（ドメイン I）が返す。本ドメインは**変更 EP の応答に更新後残高を含める**（ヘッダー即時更新用）＋履歴 `GET /me/activities`。
- 認可失敗＝**403 `forbidden`**／未認証＝**401 `unauthenticated`**／対象なし＝**404 `not_found`**。業務前提違反（残高不足・前提未達・重複）＝**409 `conflict`**（サブコードは各節）。

---

## G.1 ショップ（アイテム・購入）

| メソッド/パス | 概要 | リクエスト（パス/クエリ/ボディ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /items` | 装備マスタ＋自分の所有/装備状況（SC-30／SC-31 共用） | クエリ（任意フィルタ）: `slot?`・`rarity?`・`owned?`（bool）・`affordable?`（bool＝価格≤残高）・`sort?`（`rarity`〔既定〕/`price`/`-price`/`slot`）・`limit`/`cursor`（§1.8） | `data`=アイテム行（`id`/`code`/`name`〔locale〕/`slot`/`rarity`/`price_coin`/`owned`〔bool〕/`is_equipped`〔bool〕）＋`coin_balance`（自分）。`page_info` |
| `POST /items/{item_id}/purchase` | 装備を購入（コイン消費・恒久） | パス: `item_id`／`Idempotency-Key` 必須 | 200（`{item_id, owned:true, coin_balance}`〔更新後残高〕） |

- **購入のサーバー検証**（§2.2・不正入手防止）: (1) 残高 ≥ `price_coin`、(2) 未所有（`user_items` に無い）。満たさなければ **409**＝`insufficient_balance`／`already_owned`。
- **副作用（同一 UoW）**: `coin_balance` 減算＋`user_items` 作成（`slot` は `items.slot` を購入時に非正規化コピー・§5.26）＋`activities`（`kind=coin_spend`,`reason=shop_purchase`,`ref_type=items`,`ref_id=item_id`）。購入直後は未装備（`is_equipped=false`）＝着せ替えは G.2。
- **入手はコイン購入のみ**（レベル解放・実績での装備直接付与はしない＝実績報酬はコインに統一・§5.25/SC-40）。

---

## G.2 装備（着せ替え）

| メソッド/パス | 概要 | リクエスト（パス/ボディ） | レスポンス |
| --- | --- | --- | --- |
| `GET /me/items` | 自分の所有装備（スロット別・装備状況） | — | `slots`=`{head:[...], face:[...], body:[...], hand:[...], background:[...]}`（各 `{item_id, name, rarity, is_equipped}`）＋`equipped`〔スロット→item_id or null〕 |
| `PUT /me/equipment` | 装備スロットを更新（着せ替え） | ボディ（**部分マップ**）: `{head?:item_id\|null, face?:..., body?:..., hand?:..., background?:...}`（キー有=そのスロットを設定／`null`=外す／キー無=不変） | 200＋更新後の `equipped` |

- **サーバー検証**: 指定 `item_id` が**自分の所有**（`user_items`）かつ**そのスロットに一致**（`items.slot`）。未所有/スロット不一致は **409 `not_owned`**／422（スロット不整合）。
- **各スロット1点**を `UNIQUE(user_id, slot) WHERE is_equipped`（§8-⑩）で DB 保証＝更新は「同スロットの旧装備を `is_equipped=false`→新装備を `true`」を同一 UoW で。冪等（同じ状態への PUT は no-op）。
- 3D 反映（VRM パーツ差し替え）はフロント（SC-31）。API は装備状態のみを権威として返す。

---

## G.3 魔法（スキルツリー・解放）

| メソッド/パス | 概要 | リクエスト（パス） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /spells` | 魔法マスタ＋自分の解放状況（SC-32） | — | `data`=魔法行（`id`/`code`/`name`〔locale〕/`icon`/`effect`/`rarity`/`line`/`sp_cost`/`requires_spell_id`/`description`/`unlocked`〔bool〕/`can_unlock`〔前提達成かつSP十分〕）＋`skill_point_balance`。系統（`line`）順・段階順 |
| `GET /me/spells` | 自分の解放済み魔法（SC-24 の魔法ピッカー用） | — | `data`=解放済み `{spell_id, code, effect, icon, name}` の配列 |
| `POST /spells/{spell_id}/unlock` | 魔法を解放（SP 消費・恒久） | パス: `spell_id`／`Idempotency-Key` 必須 | 200（`{spell_id, unlocked:true, skill_point_balance}`〔更新後残高〕） |

- **解放のサーバー検証**（SC-32 §2・§7）: (1) **前提**＝`requires_spell_id` が NULL（起点）または既に `user_spells` にある、(2) `skill_point_balance` ≥ `sp_cost`、(3) 未解放。満たさなければ **409**＝`prerequisite_not_met`／`insufficient_sp`／`already_unlocked`。
- **副作用（同一 UoW）**: `skill_point_balance` 減算＋`user_spells` 作成（`UNIQUE(user_id, spell_id)`）＋`activities`（`kind=sp_spend`,`reason=spell_unlock`,`ref_type=spells`,`ref_id=spell_id`）。**恒久・取消/SP返還なし**（SC-32 §9）。
- 発動（魔法リアクション）は**ドメイン E**（`user_spells` の解放済みチェックは E.4 が参照）。魔法は装飾のみ（XP/評価/投票に非影響）。

---

## G.4 実績（バッジ）

| メソッド/パス | 概要 | リクエスト（パス/クエリ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /achievements` | 実績マスタ＋自分の獲得/進捗（SC-40） | クエリ（任意）: `category?`・`state?`（`all`〔既定〕/`unlocked`/`locked`） | `data`=実績行（下記「実績表現」）＋`summary`〔`{unlocked, total, coin_earned}`〕 |
| `GET /me/achievements` | 自分の獲得実績（獲得日・進捗） | — | `data`=`{achievement_id, code, tier, unlocked_at, progress_current, progress_target}` の配列 |

### 実績表現（`GET /achievements` の各行）
- 通常＝`{id, code, category, tier, icon, name, description, condition_label, coin_reward, unlocked, unlocked_at?, progress:{current, target?}}`。
- **シークレット（`is_secret=true`）で未獲得**＝`{id, is_secret:true, unlocked:false, tier:null}` のみ（**名称/説明/条件/報酬/ティア/アイコンをサーバーで伏せる**＝`？？？`・SC-40 §2/§6）。獲得後は通常表現＋`is_secret` バッジ。

- **付与＝台帳（`activities`）書き込みの post-commit フックで即時判定（G が一元化・§8-⑲）**:
  - **全付与行動（投稿/選定/評価/投票/チャット/ログイン/レベルアップ/魔法解放/装備購入）は既に `activities` を書く**ため、その追記後フックで**当該ユーザーの関連実績のみ**（`reason`/種別でルーティング）を再判定する。各ドメインが実績 API を個別に呼ぶ必要はない。
  - 達成なら **`user_achievements` 作成＋ティア連動コイン報酬＋通知を同一/直後 UoW で**: コイン＝`activities`（`kind=coin_gain`,`reason=achievement_reward`,`ref_type=achievements`,`ref_id=achievement_id`・**ブロンズ20/シルバー50/ゴールド150**）＋`coin_balance` 加算／通知＝`notification_type=achievement`（ドメイン H 配信）。
  - **冪等（一度きり）**＝`UNIQUE(user_id, achievement_id)`＋コインは `activities` 存在チェック（多重付与なし）。
  - 判定条件は `achievements.condition`（jsonb）で表現（表示文言ではなくロジック定義）。**数値系**は `user_achievements.progress_current/target` を更新（`GET` で `cur/max` 表示）。**連続ログイン**は `activities(reason=login)` の日付連続で導出（新テーブル不要）。**「全◯種」系**（魔法全解放/全装備購入）は該当マスタ件数と所有/解放件数の一致で判定。

---

## G.5 ランキング

| メソッド/パス | 概要 | リクエスト（クエリ） | レスポンス（主なデータ） |
| --- | --- | --- | --- |
| `GET /rankings` | 期間スコア（XP＋コイン）ランキング（SC-41 全社／SC-12 クエスト内） | `period`（`this_week`〔既定〕/`last_week`/`this_month`/`all`）・`scope`（`company`〔既定〕/`quest:{quest_id}`）・`limit`/`cursor`（§1.8） | `data`=順位行（`rank`/`user`〔id/氏名/アバター/level〕/`score`/`xp`/`coin`）＋`me`〔`{rank, score, xp, coin, total_users}`＝圏外でも自分の順位を常に同梱〕。`page_info` |

- **スコア＝期間内の 獲得 XP＋獲得コイン**（`activities` の `kind∈{xp_gain, coin_gain}` を期間集計・**SP は対象外**・§7）。消費（`*_spend`）はスコアに影響しない（獲得のみ）。
- **期間境界**＝**週起点 月曜 00:00（JST/Asia-Tokyo 固定）**・`created_at`（UTC）を JST 換算して判定。`this_month`=当月1日〜・`all`=作成来（§7）。
- **タイブレーク**＝獲得 XP → 獲得コイン → 当該スコアへ先に到達した順（§7）。
- **`scope=quest:{id}`** は `activities.quest_id` で絞る（クエスト内ランキング・SC-12 右カラム。門番＝当該クエストのパーティー所属＝C.0）。`company` はテナント全ユーザー（会社DB分離で自然に自社のみ）。
- 大人数時は**カーソルページングで順位付き一覧を返しつつ `me` を常に同梱**（TOP3 表彰台はフロントが先頭3件から描画）。集計方式（都度 or 定期集計テーブル/キャッシュ）は実装最適化（SC-41 §9・下記 TBD）。

---

## G.6 XP／コイン／SP 付与規則（canonical 一覧・§7 の API 視点まとめ）

**正はデータモデル §7**。他ドメインが呼ぶ付与を1表に集約（drift 回避のため金額の正は §7・ここは対応表）。

| 付与/消費 | 発火ドメイン（EP） | `kind` | 量 | `reason` | `ref_type`/`ref_id` | 上限・冪等 |
| --- | --- | --- | --- | --- | --- | --- |
| ログイン XP | A（ログイン成功） | xp_gain | 10 | `login` | —（NULL） | 1回/日 |
| アイデア投稿 XP | D（publish） | xp_gain | 50 | `idea_post` | ideas/idea_id | アイデアにつき1回 |
| 投票 XP | D（vote 初回） | xp_gain | 5 | `vote` | ideas/idea_id | 5回/日・各アイデア初回のみ |
| チャット XP | E（投稿） | xp_gain | 5 | `chat` | chat_messages/msg_id | 10回/日 |
| 評価実施 XP | F（submit） | xp_gain | 30 | `evaluation` | evaluations/eval_id | 評価につき1回 |
| 選定 XP | F（select） | xp_gain | 200 | `selection` | ideas/idea_id | アイデアにつき1回・取消でも剥奪なし |
| 評価連動コイン | F（確定 F.4） | coin_gain | round(avg×10)≤50 | `evaluation_coin` | ideas/idea_id | アイデアにつき1回・不可逆 |
| 実績報酬コイン | G（実績フック G.4） | coin_gain | 20/50/150 | `achievement_reward` | achievements/ach_id | 実績につき1回 |
| レベルアップ SP | G（XP 付与でレベル上昇時） | sp_gain | +1/Lv | `levelup_sp` | —（NULL） | レベルごと1回 |
| 魔法解放 SP消費 | G（unlock G.3） | sp_spend | sp_cost | `spell_unlock` | spells/spell_id | 解放につき1回（Idempotency-Key） |
| ショップ購入 コイン消費 | G（purchase G.1） | coin_spend | price_coin | `shop_purchase` | items/item_id | 購入につき1回（Idempotency-Key） |

- **レベルアップ判定**は XP 付与のたびにサーバーが `level` を再計算し、上昇分だけ `levelup_sp` を発行（`users.level`/`skill_point_balance` 更新）。
- `GET /me/activities`（履歴・SC-01/プロフィール）＝`kind?`/`period?` で絞り込み・カーソル（§1.8）。SP はランキング非対象だが履歴には出る。

---

## G.7 他ドメイン境界・残 TBD

- **委譲/連携**: 通知の配信・テンプレ・多言語・一覧＝**ドメイン H**（実績 `achievement` 通知の実配信）／残高/プロフィール取得＝**K**（`GET /me`）・**I**（ダッシュボード集約）／魔法の**発動**＝**E**（`user_spells` 参照）／各 XP の**発火**は A/D/E/F（G.6 の発火ドメイン列）。
- **確定済み（本レビュー）**: 実績は台帳フックで即時付与（G 一元化）／`reason` に `spell_unlock`・`achievement_reward` を追加／装備は部分マップ PUT／シークレット伏せ／ランキングは `me` 常時同梱。
- **残 TBD（軽微・実装 or 運用で確定）**: 各マスタ（items/spells/achievements）の**最終ラインナップ/金額/条件**（本設計は §7・各画面の初期値）＝シードで確定／ランキングの**集計方式（都度 or 定期集計テーブル）・キャッシュ・大人数ページング**／ランキングの**プライバシー（オプトアウト/会社設定）**（SC-41 §9）／VRM パーツ制作ガイド・3D 非対応環境の代替（SC-31 §9）／実績カタログの**進捗集計方式**（都度計算 or カウンタ保持）／代表バッジのプロフィール表示（SC-40 §9）。
- **画面 md の旧記法（軽微・実装時に追随）**: SC-31 §6 `PUT /me/avatar`（確定形 `PUT /me/equipment`）・SC-41 §6 `?period=week|last|month|total`（確定形 `this_week|last_week|this_month|all`）・各画面の `Transaction/Activity` 表記（確定形＝`activities`）。
