# テストパターン H. 通知（取得・未読・既読・発火・重複排除）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/H_通知.md`](../API設計/H_通知.md)（H.0〜H.4）・[`../データモデル.md`](../データモデル.md) §5.24・§3（`notification_type`）・§8-⑬/§8-⑳（取得時レンダリング）。エラー code は OpenAPI が SoT（API設計 README §1.7）。
> 対象＝ドメイン H（通知）の縦スライス＝`app/tenant/notifications/`（orm/migration 0017/repository/catalog/service/application/router）。**生成は各発火ドメインが H の `notify()`（内部サービス）を呼ぶ**（in-session or post-commit dispatch・H.1）。本スライスは**テナント発火系フル**（mention/idea_comment/follow_comment/magic_reaction/idea_updated/follow_evaluation/follow_selection/achievement/quest_party_invited）＋**`security_*`（cross-plane・§4）**。Redis publish（L=WS）は follow-up。
> 前提フィクスチャ＝seed 会社 ACME-01。api テストは throwaway アカウント（factory）でログインし、`notify()` を tenant セッションで直接呼んで宛先に通知を作る（発火経路の縦スライスは achievement をレジャーフック経由で end-to-end 検証）。変更系は Origin/CSRF。すべて自分宛スコープ（IDOR 対策・H.4）。

## 1. 取得・未読数・既読/未読 API（H.2/H.3・SC-02＋ヘッダーベル）

> 対象＝`app/tenant/notifications/application.py`・`router.py`（`GET /notifications`・`GET /notifications/unread-count`・`POST /notifications/{id}/read`・`/unread`・`/read-all`）。本文は取得時レンダリング（catalog・§8-⑳）。一覧はカーソル（§1.8・新着降順）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| H-TC-101 | api | 空一覧（新規ユーザー） | 通知なし | `GET /notifications` | 200・`data=[]`・`unread_count=0`・`page_info.has_next=false` | H.2 |
| H-TC-102 | api | 一覧＋未読数＋取得時レンダリング | `notify()` で mention 1件（actor_name 凍結） | `GET /notifications` | 1件・`type=mention`・`body` に actor 名が差し込まれる・`is_read=false`・`unread_count=1` | H.2／§8-⑳ |
| H-TC-103 | api | 未読数のみ（軽量） | 未読2件 | `GET /notifications/unread-count` | `{unread_count:2}` | H.2 |
| H-TC-104 | api | 個別既読化（冪等・未読数減） | 未読1件 | `POST /{id}/read` ×2 | 200・`is_read=true`・`unread_count=0`・2回目も 200（no-op） | H.3 |
| H-TC-105 | api | 未読へ戻す | 既読1件 | `POST /{id}/unread` | 200・`is_read=false`・`unread_count=1` | H.3 |
| H-TC-106 | api | すべて既読化（type 絞り込み可） | 未読3件（うち mention 2・achievement 1） | `POST /read-all`（`{type:"mention"}`） | `updated=2`・残 `unread_count=1`。type 無しなら全既読 | H.3 |
| H-TC-107 | api | 絞り込み（state=unread / type） | 既読1・未読1（mention）・未読1（achievement） | `GET /notifications?state=unread&type=mention` | 未読 mention のみ1件 | H.2 |
| H-TC-108 | api | カーソル（新着降順・ページング） | 通知3件 | `GET ?limit=2` → `?cursor=next` | 1ページ目2件（新しい順）・`has_next=true`・2ページ目に残り1件 | H.2／§1.8 |
| H-TC-109 | api | 種別不正は 422 | — | `GET ?type=bogus` | 422（`field=type`） | H.2 |

## 1e. 画面 e2e（SC-02 通知一覧・H）

> 対象＝フロント接続済み SC-02（`features/notifications/components/NotificationsView.tsx`・`/(app)/notifications`）。e2e は契約の最終確認（画面↔API）。前提＝dev seed ACME-01。一覧/未読数は `GET /notifications` の実データを画面と照合（デモ固定 13 行でないこと）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| H-TC-208 | e2e | 通知一覧が実データ（未読数・行数・デモ排除） | ログイン | `/notifications` を表示 | `GET /notifications` と照合＝「{unread_count} 件の未読」＝実 unread_count・`.n` 行数＝実 `data.length`・デモ固定文字列（`IP 203.0.113.42`）が出ない | H.2／SC-02 |

## 2. セキュリティ（IDOR・認可・§2.2）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| H-TC-121 | api | 他人宛は一覧に出ない | 別ユーザー宛に通知1件 | 自分で `GET /notifications` | 自分宛のみ（他人宛は含まない） | H.4 |
| H-TC-122 | api | 他人宛の既読操作は 404（存在秘匿） | 別ユーザー宛の通知 id | `POST /{other_id}/read` | 404 not_found・当該行は不変 | H.4 IDOR |
| H-TC-123 | api | 変更系の CSRF/未認証 | CSRF なし／セッションなし | `POST /{id}/read`・`/read-all` | 403 csrf_failed／401 | A.0 |

## 3. 生成・重複排除（`notify()`・H.1）

> 対象＝`app/tenant/notifications/service.py`（`notify`＝宛先単位で最具体1件に畳む・`TYPE_PRIORITY`）。発火の縦スライスは achievement をレジャーフック経由で end-to-end 検証（他種別は `notify()` を直接呼んで畳み込みを検証）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| H-TC-141 | int | 1イベント×1宛先＝最具体1件 | 同一宛先に mention＋follow_comment 候補 | `notify()` | 生成は1件・`type=mention`（より具体）・follow_comment は畳まれる | H.1 |
| H-TC-142 | int | 別宛先は各1件 | A に mention・B に follow_comment | `notify()` | A/B にそれぞれ1件・混ざらない | H.1 |
| H-TC-143 | api | 実績獲得の自動通知（レジャーフック end-to-end） | 評価3件付与（reason=evaluation×3・ledger→engine） | `GET /notifications` | `type=achievement` 1件・`body` に実績名＋ティア・`meta.coin` にティア連動コイン | H.0／§8-⑲ |

## 4. セキュリティ通知の発火（cross-plane・A.9-⑧）

> 対象＝認証フロー（`app/control_plane/auth/application.py`＝`login`/`verify_mfa`/`complete_password_setup`）＋プロフィール（`app/control_plane/me/application.py`＝`change_password`）が、**ログインで確定した `company_id`** でテナントDBへ `notify()`（post-commit dispatch・H.0）。in-app 発火は `notifications.service.notify_account`（account→user 解決）、メール＋監査は control-plane（`auth/security_events.py`）。`security_*` はオプトアウト不可（A.9-⑧）。**new_device の端末認識＝有効な `iq_trust`（`trusted_devices`）を持たない端末**（MFA-ON=毎回 OTP 経由＝`verify_mfa` 成功／MFA-OFF=`iq_trust` を端末認識に拡張・初回は発行）。メール＝password_changed は常時／new_device は `mfa_required=false` 会社のみ前倒し（A.9-⑧(a)）。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| H-TC-151 | api | MFA-OFF 未登録端末ログイン→新端末通知＋メール＋iq_trust 発行 | MFA-OFF 会社の実アカウント・`iq_trust` 無し | `POST /auth/login` 成功 | `security_new_device` 1件（`body` に IP/UA/日時）・`mail_outbox` に new_device メール1通・`Set-Cookie: iq_trust`・`trusted_devices` 1行 | A.9-⑧(a)／H.0 |
| H-TC-152 | api | MFA-OFF 既知端末（有効 iq_trust）再ログイン→通知しない（ノイズ回避） | H-TC-151 後の `iq_trust` を保持 | 同端末で再 `login` 成功 | `security_new_device` 増えない・new_device メール増えない・`last_used_at` 更新 | A.9-⑧(a) ノイズ回避 |
| H-TC-153 | api | MFA-ON verify 成功（未登録端末）→新端末通知・メール無し | MFA-ON 会社の実アカウント | `login`→`mfa/verify` 成功 | `security_new_device` 1件・new_device メールは送らない（MFA-ON） | A.9-⑧(a) |
| H-TC-154 | api | MFA-ON 信頼端末で MFA スキップ→通知しない | 有効 `iq_trust` を持つ MFA-ON 実アカウント | `login`（trust で MFA スキップ）成功 | `security_new_device` を生成しない（既知端末） | A.9-⑧(a) ノイズ回避 |
| H-TC-161 | api | PW 設定完了（A 経路）→変更完了通知＋メール | 実アカウント・有効な password_setup トークン | `POST /auth/password-setup/complete` 成功 | `security_password_changed` 1件・`mail_outbox` に password_changed メール1通 | A.9-⑧(b)／A.7 |
| H-TC-162 | api | 自己 PW 変更（K 経路）→変更完了通知＋メール | ログイン中の実アカウント | `POST /me/password`（自己PW変更）成功 | `security_password_changed` 1件・password_changed メール1通・全セッション破棄 | A.9-⑧(b)／K.3 |
| H-TC-170 | unit | 通知カタログの locale 出し分けの担保（i18n 結線） | `render()` に locale=None/`en`/`fr` を与える（security_password_changed・security_new_device・mention・未知種別） | body/context/tag/icon を検査 | 既定/不明（None/`fr`）は日本語・`en` は英語（body/tag/context とも）。icon は locale 非依存。受信者 locale の源泉＝`users.locale`（§4.6 ミラー） | コーディング規約 §2.1／H.2 |
