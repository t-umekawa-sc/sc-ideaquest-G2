# red 確認台帳（既存テストの retro red-green 証跡）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md) §5.1（red-green は全レベル必須）。
> 本ファイルは、**実装が先に在る既存テスト**（自然な red が出ない後追いテスト）について、
> テスト規約 §5.1 の手技「アサーションを一時反転→red を目視→戻す」を retro で実施した**証跡**。
> 証跡の使い分け（テスト規約 §5.1）＝**test-first はコミットメッセージに1行／後追い（反転手技）は本台帳に TC-ID 行を追記**。
> 以下は初回 retro（既存 55 件）の記録。以降の後追い確認は本台帳の末尾に追記していく。

## 実施概要

- 実施日＝**2026-08-09 JST**。対象＝**backend 51（pytest）＋ e2e 4（Playwright）＝計 55**（すべてドメイン A・認証）。
- 手技＝各テストの**主アサーションを1つだけ「起こり得ない期待値」に反転**し、そのテストが red になることと、
  pytest/Playwright が示す**実際の観測値**（＝テストが対象へ確かに到達している証拠）を確認 → 反転を戻して green 復帰を確認。
- 共有ヘルパ（`_login_mfa`・`_token_from_mail`・login 用 `login()` 等）は**反転しない**＝各テストが**自身のアサーション**で red になるようにした。
- 実行環境の注意（handoff §5 と同じ）:
  - backend＝イメージにソースが焼かれているため、ホストの反転を反映するには**ホスト `backend/` を `/app` にマウント**して実行（`docker compose run --rm --no-deps -v "$PWD/backend:/app" backend pytest ...`）。
  - e2e＝ソースが焼かれているため、反転した spec を **`docker compose cp` でコンテナへ流し込んで**実行。復元も cp で戻す。
- 結果＝**全 55 件が反転で red**（各自のアサーション行で失敗・観測値は期待どおり）→ **反転を戻して backend 51 passed / e2e 4 passed に復帰**。空振り（反転しても green のまま）は**0 件**。

反転の実体はコミットには含めない（`git checkout` で復元済み）。再現手順は本台帳の「実施概要」と各表の「反転」列で辿れる。

## backend（pytest 51）

反転はいずれも「期待ステータス→ `599`」等、起こり得ない値への差し替え。観測値＝反転前の正しい期待値が actual として表示された。

### tests/auth/test_auth_login.py（12）

| TC-ID | 反転した主アサーション | 観測 red（actual） |
| --- | --- | --- |
| A-TC-001 | `status_code == 200` → `599` | 200 |
| A-TC-002 | `status_code == 401` → `599` | 401 |
| A-TC-003 | `status_code == 401` → `599` | 401 |
| A-TC-004 | `status_code == 401` → `599` | 401 |
| A-TC-005 | `status_code == 401` → `599` | 401 |
| A-TC-006 | `status_code == 503` → `599` | 503 |
| A-TC-007 | `status_code == 401` → `599` | 401 |
| A-TC-008 | `status_code == 422` → `599` | 422 |
| A-TC-009 | `status_code == 200` → `599` | 200 |
| A-TC-010 | `status_code == 403` → `599` | 403 |
| A-TC-016 | `"httponly" in sess` → `not in` | iq_session に httponly 有り |
| A-TC-017 | `token1 != token2` → `==` | 2セッションで異なる token |

### tests/auth/test_auth_logout.py（3）

| TC-ID | 反転した主アサーション | 観測 red（actual） |
| --- | --- | --- |
| A-TC-013 | `status_code == 204` → `599` | 204 |
| A-TC-014 | `status_code == 403` → `599` | 403 |
| A-TC-015 | `status_code == 401` → `599` | 401 |

### tests/auth/test_auth_session.py（2）

| TC-ID | 反転した主アサーション | 観測 red（actual） |
| --- | --- | --- |
| A-TC-011 | `status_code == 200` → `599` | 200 |
| A-TC-012 | `status_code == 401` → `599` | 401 |

### tests/auth/test_session_repo.py（2・int/unit）

| TC-ID | 反転した主アサーション | 観測 red（actual） |
| --- | --- | --- |
| A-TC-018 | `read_session(...)["account_id"] == "acc_x"` → `"WRONG-VALUE"` | acc_x |
| A-TC-019 | `verify_password("Correct1!", h) is True` → `is False` | True |

### tests/auth/test_auth_mfa.py（11）

| TC-ID | 反転した主アサーション | 観測 red（actual） |
| --- | --- | --- |
| A-TC-060 | `status_code == 200` → `599` | 200 |
| A-TC-061 | `status_code == 401` → `599` | 401 |
| A-TC-062 | `last.status_code == 401` → `599` | 401 |
| A-TC-063 | `status_code == 200` → `599` | 200 |
| A-TC-064 | `status_code == 200` → `599` | 200 |
| A-TC-065 | `status_code == 401` → `599` | 401 |
| A-TC-066 | `status_code == 403` → `599` | 403 |
| A-TC-067 | `status_code == 429` → `599` | 429 |
| A-TC-068 | `status_code == 200` → `599` | 200 |
| A-TC-069 | `status_code == 401` → `599` | 401 |
| A-TC-070 | `status_code == 204` → `599` | 204 |

### tests/auth/test_auth_password_setup.py（21）

| TC-ID | 反転した主アサーション | 観測 red（actual） |
| --- | --- | --- |
| A-TC-030 | `status_code == 202` → `599` | 202 |
| A-TC-031 | `status_code == 202` → `599` | 202 |
| A-TC-032 | `status_code == 202` → `599` | 202 |
| A-TC-033 | `status_code == 202` → `599` | 202 |
| A-TC-034 | `status_code == 202` → `599` | 202 |
| A-TC-035 | `status_code == 202` → `599` | 202 |
| A-TC-036 | `status_code == 202` → `599` | 202 |
| A-TC-037 | `status_code == 403` → `599` | 403 |
| A-TC-038 | `len(mail.sent) == 5` → `999` | 5 |
| A-TC-039 | `status_code == 422` → `599` | 422 |
| A-TC-040 | 旧トークン `status_code == 410` → `599` | 410 |
| A-TC-041 | `status_code == 200` → `599` | 200 |
| A-TC-042 | `status_code == 410` → `599` | 410 |
| A-TC-043 | `status_code == 410` → `599` | 410 |
| A-TC-044 | `status_code == 410` → `599` | 410 |
| A-TC-045 | `status_code == 200` → `599` | 200 |
| A-TC-046 | `status_code == 422` → `599` | 422 |
| A-TC-047 | `status_code == 410` → `599` | 410 |
| A-TC-048 | complete `status_code == 200` → `599` | 200 |
| A-TC-049 | complete 後 `GET /session == 401` → `599` | 401（セッション破棄済み） |
| A-TC-051 | `password_policy_errors("NewPassw0rd") == []` → `== ["RED-AUDIT"]` | []（適合＝空） |

## e2e（Playwright 4）

反転＝到達を確認する可視要素/URL を実在しない値へ。red は当該アサーションのタイムアウト（要素/URL 不到達）で確認。
login spec は `login()` を共有するため2状態に分けて実施（A-TC-020 はヘルパの `ようこそ` を反転／A-TC-021 は自身の URL 判定を反転しヘルパは温存）。

| テスト（spec） | 反転した主アサーション | 観測 red |
| --- | --- | --- |
| A-TC-020（sc-00-login） | `getByText("ようこそ")` → `"ようこそ_REDAUDIT"` | 保護ページ文言に到達せずタイムアウト |
| A-TC-021（sc-00-login） | `toHaveURL(/\/login$/)` → `/\/login-REDAUDIT$/` | 実 URL は `/login`・パターン不一致でタイムアウト |
| SC-00 状態C（sc-00-mfa） | `getByText("ようこそ")` → `"ようこそ_REDAUDIT"` | ダッシュボード文言に到達せずタイムアウト |
| SC-00 状態D→B（sc-00-password-setup） | `getByText("パスワードを設定しました")` → `+"_REDAUDIT"` | 完了文言に到達せずタイムアウト |

## 追記: アカウント一時ロック（ADR-0005・A-TC-071〜079）— 2026-08-10

- これらは **test-first**（実装前にテスト作成）で導入。実装前の実行で **6件（A-TC-071/073/074/075/076/077）は対象の振る舞いで自然に red**（ロック未実装＝正PWでも 200 になる／streak・lock キーが立たない／通知メール 0 通）＝証跡はコミットメッセージに記載。
- 残る **3件（A-TC-072/078/079）は「悪い挙動の不在」を確認するガードテスト**で、実装前も green のため自然 red が出ない。§5.1 の反転手技（主アサーションを起こり得ない値へ）で red を目視した証跡を以下に残す（反転は復元済み）。

| TC-ID | 反転した主アサーション | 観測 red（actual） |
| --- | --- | --- |
| A-TC-072 | 別 IP の `status_code == 200` → `599` | 200（別 IP は非影響で成功） |
| A-TC-078 | `len(mail.sent) == 0` → `999` | 0（実在しない login_id は通知なし） |
| A-TC-079 | 再 login の `status_code == 200` → `599` | 200（OTP 失敗は非連動＝再び mfa_required） |

## 追記: 失敗計数の固定窓 TTL 経過リセット（ADR-0005・A-TC-082）— 2026-08-11

- 後追いテスト（固定窓の挙動は実装済み＝自然 red が出ない）。§5.1 の反転手技で red を目視（反転は復元済み）。

| TC-ID | 反転した主アサーション | 観測 red（actual） |
| --- | --- | --- |
| A-TC-082 | 窓経過後の `r.get(streak_key) == "1"` → `== "999"` | '1'（窓 TTL 経過後の失敗は 1 から数え直し） |

## 追記: logout-all の frontend 導線（A-TC-022・e2e）— 2026-08-11

- 後追い e2e（backend EP は既存・frontend 導線を追加）。反転手技で red を目視（反転は container 内 spec を `docker compose cp` で復元済み）。
- 初回実行で既存 A-TC-021 が `getByRole('menuitem',{name:'ログアウト'})` の**部分一致で「全端末からログアウト」にも一致**して strict 違反 red になったのを検知＝A-TC-021 を `exact: true` に修正（導線追加が既存導線を壊さないことを担保）。

| TC-ID | 反転した主アサーション | 観測 red |
| --- | --- | --- |
| A-TC-022（sc-00-login） | menuitem `全端末からログアウト` → `全端末からログアウト_REDAUDIT` | 当該 menuitem に到達せずタイムアウト（導線に確かに到達している証拠） |

## 追記: アカウント管理 API 認可基盤（B-TC-010〜014）— 2026-08-11

- 新規 EP（`GET /admin/companies/{id}/accounts`）。認可ガードが効いていることを、**ガードの一時無効化**で目視（`Depends(require_system_admin)` をコメントアウト→復元済み）。

| TC-ID | 反転/無効化した箇所 | 観測 red（actual） |
| --- | --- | --- |
| B-TC-011 | router の `Depends(require_system_admin)` を無効化 | セッション無しでも 200（本来 401）＝ガードが P1 を担っている |
| B-TC-012 | 同上 | general でも 200（本来 403）＝ガードが P6 を担っている |
