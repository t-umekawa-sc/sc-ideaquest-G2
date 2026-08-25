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

## 追記: アカウント発行 API（B-TC-020〜024）— 2026-08-11

- 新規 EP（`POST /admin/companies/{id}/accounts`）。変更系の CSRF ガードが効いていることを一時無効化で目視（`verify_csrf` をコメントアウト→復元済み）。他（201/409/422）は Pydantic/DB＋app 検証で担保。

| TC-ID | 反転/無効化した箇所 | 観測 red（actual） |
| --- | --- | --- |
| B-TC-023 | router の `verify_csrf(request)` を無効化 | CSRF トークン無しでも 201（本来 403 csrf_failed）＝CSRF ガードが効いている |

## 追記: アカウント状態管理（B-TC-025/028）— 2026-08-11

- disable/enable/password-reset。強い red は非破壊的に確認（seed system_admin を壊さないよう B-TC-028 は反転手技）。

| TC-ID | 反転/無効化した箇所 | 観測 red（actual） |
| --- | --- | --- |
| B-TC-025 | `disable_account` の `delete_account_sessions(...)` を無効化 | 無効化後も対象の `GET /session` が 200（本来 401）＝セッション破棄が load-bearing |
| B-TC-028 | 期待 `status_code == 422` → `== 599`（ガードは発火させたまま＝admin は無効化されない） | 422（`last_system_admin` ガードが発火している証拠） |

## 追記: アカウント編集（B-TC-033）— 2026-08-11

| TC-ID | 反転した箇所 | 観測 red（actual） |
| --- | --- | --- |
| B-TC-033 | 期待 `status_code == 422` → `== 599`（ガードは発火させたまま＝admin は降格されない） | 422（自己降格 `last_system_admin` ガードが発火している証拠） |

## 追記: 会社アカウント管理者（B-TC-042）— 2026-08-11

| TC-ID | 無効化した箇所 | 観測 red（actual） |
| --- | --- | --- |
| B-TC-042 | `disable_account` の `forbid_system_admin_target` ガードを無効化 | 会社アカ管理者が system_admin を disable できて 200（本来 403）＝SoD ガードが load-bearing |

## 追記: 会社 CRUD（B-TC-054）— 2026-08-11

| TC-ID | 無効化した箇所 | 観測 red（actual） |
| --- | --- | --- |
| B-TC-054 | `update_company_settings` の「記名時に hide_voters_from_managers を無効化」行を無効化 | `vote_anonymized=false` でも `hide_voters_from_managers=true` のまま（本来 false）＝サーバー整合が load-bearing |

## 追記: users ミラー列補完（B-TC-007）— 2026-08-11

| TC-ID | 撤回した箇所 | 観測 red（actual） |
| --- | --- | --- |
| B-TC-007 | `_MIRROR_FIELDS` から `login_id`/`email`/`system_role` を一時撤回 | ミラー後も `users.login_id` が None（本来 'mir@acme.example'）＝mirror 列拡張が load-bearing |

## 追記: quest_group スキーマ（B-TC-061）— 2026-08-11

| TC-ID | 無効化した箇所 | 観測 red（actual） |
| --- | --- | --- |
| B-TC-061 | company 0005 の部分ユニーク `uq_quest_group_members_active` を ACME-01 会社DB で一時 DROP | 同一 `(quest_group_id, user_id)` の有効所属を2行 INSERT できて `DID NOT RAISE IntegrityError`（本来は IntegrityError）＝部分ユニーク index が重複所属禁止の load-bearing。復元して green（4 passed）。 |

## 追記: QG管理者 mutation API（B-TC-084/085）— 2026-08-11

| TC-ID | 無効化した箇所 | 観測 red（actual） |
| --- | --- | --- |
| B-TC-084 | `quest_group_application.add_member` を早期 return の stub 化（会社DB へ upsert しない） | POST は 201 を返すが `quest_group_members` に有効所属が作られず、members に target が現れない＝upsert 呼び出しが load-bearing。復元して green。 |
| B-TC-085 | `quest_group_application.remove_member` を早期 return の stub 化（トゥームストーンしない） | DELETE は 204 を返すが `removed_at` が設定されず有効所属に残る（`assert not True`）＝remove_membership が load-bearing。復元して green。 |

## 追記: プロフィール編集 writer（K-TC-001）— 2026-08-11

| TC-ID | 無効化した箇所 | 観測 red（actual） |
| --- | --- | --- |
| K-TC-001 | `me/application.update_me` を早期 return の stub 化（accounts 更新も outbox enqueue もしない） | `PATCH /me` は 200 だが `display_name` が更新されず旧値 `Seed Test` が返る（本来 `新しい名前`）＝accounts 更新＋outbox enqueue が load-bearing。復元して green（3 passed）。 |

## 追記: SoD 境界（B-TC-094/095）— 2026-08-11

| TC-ID | 無効化した箇所 | 観測 red（actual） |
| --- | --- | --- |
| B-TC-094/095 | `admin/deps.require_system_admin` の許可集合を `{system_admin}`→`{system_admin, company_account_admin, general}` に一時拡大 | system_admin 専用 EP 群が general/company_account_admin でも通過し 200 等を返す（本来 403）＝`require_system_admin` の role ガードが SoD の load-bearing。復元して green（148 passed）。 |

## 追記: ワーカ memberships は加算専用（B-TC-096/097）— 2026-08-11

| TC-ID | 無効化した箇所 | 観測 red（actual） |
| --- | --- | --- |
| B-TC-096/097 | `account_sync/application._apply_memberships` を一時的にフルセット差分（payload に無い有効所属を remove）へ書き換え | 096＝memberships 無し payload で既存所属が削除される（本来は保持）／097＝payload に含めない G2 が削除される（本来は加算専用で保持）＝「加算専用・修正は編集経路」という不変条件が load-bearing。復元して green（150 passed）。 |

## 追記: システム監査ログ（B-TC-100/103）— 2026-08-11

| TC-ID | 無効化した箇所 | 観測 red（actual） |
| --- | --- | --- |
| B-TC-100/103 | `audit/repository.record` を早期 return の no-op に一時変更（監査行を書かない） | 特権操作（disable/settings 更新・membership add/remove）後に `system_audit_logs` に行が無く、`len(rows)==1` の assert が落ちる＝各 application からの `audit.record` 呼び出しが load-bearing。復元して green（154 passed）。 |

## 追記: 会社一覧クエリ写像 unit（B-TC-136・frontend vitest）— 2026-08-19

- **retro の理由**＝test-first で導入したが、当初コミット（`1945ce2`）が記録した red は「vitest 赤(9 failed＝**関数未定義**)」＝関数が未 export ゆえの失敗（`ImportError` 相当）で、テスト規約 §5.1 が「無関係な失敗で満足しない」と名指しする**アサーション未到達の red**だった。behavior-red を目視していなかったため、実装済みの現状に対して反転手技で retro 確認する。
- 対象＝`impl/frontend/src/features/companies/api.test.ts`（`companiesQueryParams`/`companiesCsvUrl` の純関数写像・9 it・正＝API設計 README §1.8.1）。
- 手技＝各関数の**写像の主アサーション**を「起こり得ない値 `"RED-AUDIT"`」へ反転→当該 it が red（観測 actual＝反転前の正しい写像値＝関数へ確かに到達）→反転を戻して green（9 passed）を確認。反転は編集で復元済み（diff クリーン）。空振り 0。

| TC-ID | 反転した主アサーション | 観測 red（actual） |
| --- | --- | --- |
| B-TC-136（複数ソート写像） | `companiesQueryParams(...).get("sort") == "name,-account_count"` → `== "RED-AUDIT"` | `name,-account_count`（左優先・desc 前置の写像に到達） |
| B-TC-136（CSV 列ホワイトリスト） | `companiesCsvUrl(...) の columns == "name,status,account_count"` → `== "RED-AUDIT"` | `name,status,account_count`（表示列→CSV 許可列の絞り込みに到達） |

## 追記: クエストグループ API の未定義/404 red を behavior-red で貼り直し（B-TC-080〜083/086〜093・backend）— 2026-08-19

- **retro の理由**＝いずれも test-first で導入したが、当初コミットが記録した red が**アサーション未到達**の型だった＝テスト規約 §5.1 が名指しで不可とする「ルート未定義の 404／405」で満足していた。behavior-red を目視していなかったため、実装済みの現状に対して反転手技で retro 確認する。
  - 該当コミット＝`3420317`（B-TC-080〜083「endpoints 未実装のルーティング 404 で red」）／`9aa22ba`（B-TC-086/087「ルーティング 404」）／`22e85f0`（B-TC-088/089「POST 未実装の 405」）／`355c2d9`（B-TC-090〜093「endpoints 未実装の 404/405」）。※B-TC-084/085/103 は当初から反転手技で目視済み（上掲の各節）。
- 対象＝`impl/backend/tests/admin/test_admin_quest_groups.py`（B.4・SC-90）＋`test_admin_company_quest_groups.py`（B.3・§4.6）。正＝API設計 B.3/B.4。
- 手技＝各 TC の**主アサーション（status）を「起こり得ない値 `599`」へ反転**→当該 test が red（観測 actual＝反転前の正しい status＝ルート/ガード/検証に確かに到達）→反転を `git checkout` で戻して green（対象2ファイル **15 passed**）を確認。反転はコミットに含めない（復元済み・diff クリーン）。空振り 0。実行環境＝ledger「実施概要」と同じ（`docker compose run --rm --no-deps -v "$PWD/backend:/app" backend pytest`）。

| TC-ID | 反転した主アサーション | 観測 red（actual・到達点） |
| --- | --- | --- |
| B-TC-080 | 一覧 `status_code == 200` → `599` | 200（general でも per-group admin＝一覧＋member_count に到達） |
| B-TC-081 | admin 所属ゼロの `status_code == 403` → `599` | 403（QG管理者でない＝per-group 認可ガードが発火） |
| B-TC-082 | members `status_code == 200` → `599` | 200（admin の members 一覧に到達） |
| B-TC-083 | directory `status_code == 200` → `599` | 200（最小射影ディレクトリに到達） |
| B-TC-086 | 候補一覧 `status_code == 200` → `599` | 200（system_admin のクロステナント候補一覧に到達） |
| B-TC-087 | general の `status_code == 403` → `599` | 403（system_admin 専用ガードが発火） |
| B-TC-088 | 作成 `status_code == 201` → `599` | 201（グループ作成＋code 大文字正規化に到達） |
| B-TC-089 | 不正形式 `status_code == 422` → `599` | 422（`quest_group_code` 形式バリデーションに到達） |
| B-TC-090 | リネーム `status_code == 200` → `599` | 200（name 更新・code 不変に到達） |
| B-TC-091 | 空削除 `status_code == 204` → `599` | 204（tombstone 削除に到達） |
| B-TC-092 | 使用中削除 `status_code == 409` → `599` | 409（`in_use` conflict ガードが発火） |
| B-TC-093 | 未認証 PATCH `status_code == 401` → `599` | 401（認証ガードに到達） |

## C. クエスト（SC-10/11/12・2026-08-22）

> 手技＝**対象のサーバー強制ガードを一時無効化（`if False:` 等）→ 該当 TC が red になることを目視 → 復元して green**（実装先行の後追い確認・テスト規約 §5.1）。無効化差分はコミットに含めない。全実行は full 269 passed（緑）。

| TC-ID | 一時無効化したガード | 観測 red（actual） |
| --- | --- | --- |
| C-TC-116 | publish の `draft` 前提（`status != draft` の 409） | 409 期待→ 200（無効化で公開が通る） |
| C-TC-118 | 完了後の書き込み凍結（PATCH の 409） | 409 期待→ 200 |
| C-TC-121 | パーティー候補制限（グループ外 422） | 422 期待→ 200/他 |
| C-TC-122 | owner 付与の作成者限定（403） | 403 期待→ 200 |
| C-TC-128 | 詳細の可視性ガード（パーティー外 404） | 404 期待→ 200 |
| C-TC-134 | 作成者のパーティー除外禁止（422） | 422 期待→ 204 |
| C-TC-138 | 状態遷移の飛び越え禁止（409） | 409 期待→ 200 |

> 上記以外の C-TC（repository・一覧・作成/編集など）は test-first 相当で実装時に緑を確認（証跡＝コミットメッセージ）。

## D. アイデア（データ基盤・2026-08-22）

> 手技＝repository のガード/分岐を一時破壊 → 該当 D-TC が red → 復元して green（tests/ideas 12 passed）。

| TC-ID | 一時無効化したガード | 観測 red（actual） |
| --- | --- | --- |
| D-TC-002 | 一覧の下書き author 門番（`author_id == viewer_id`） | 他人の下書きが混入して AssertionError |
| D-TC-006 | 投票 upsert の既存判定（常に新規 insert） | 切替が created=True＋行が増え AssertionError／一意制約 |
| D-TC-011 | フォロー冪等（既存再利用） | 重複行で UNIQUE 制約違反（sqlalchemy IntegrityError） |

## D. アイデア API（2026-08-22）

> 手技＝サーバー強制ガードを一時無効化（`if False:` 等）→ 該当 TC red 目視 → 復元して green（tests/ideas api 18＋repo 12）。

| TC-ID | 一時無効化したガード | 観測 red（actual） |
| --- | --- | --- |
| D-TC-103 | 作成の idea_create 権限チェック（403） | 403 期待→ 201 |
| D-TC-106 | 一覧のパーティー門番（非メンバー 404） | 404 期待→ 200 |
| D-TC-113 | publish の状態機械（draft 以外 409） | 409 期待→ 200 |

## D. アイデア 画面 e2e（SC-21・2026-08-23）

> 手技＝実装が先に在る後追い e2e（`sc-21-idea-form.spec.ts`）につき、各 TC の**主アサーションを1つだけ一時反転**した
> 使い捨て spec を流して behavior-red を目視 → 破棄（本 spec は不変）→ 反転前で green（sc-21 e2e 4 passed）。
> 反転は使い捨てファイルのためコミット差分に痕跡が残らない＝本台帳に記録（テスト規約 §5.1 line 84・91）。

| TC-ID | 反転した主アサーション | 観測 red（actual） |
| --- | --- | --- |
| D-TC-201 | 一覧に投稿が出る `expect(found).toBeTruthy()` → `toBeFalsy()` | 一覧に当該 idea が出現（`status:"published"`・`title:"公開アイデア_…"`）＝投稿→公開→一覧反映に到達 |
| D-TC-202 | 下書きが本人一覧に出る `toBeTruthy()` → `toBeFalsy()` | 一覧に当該 idea が出現（`status:"draft"`・`my_state:"draft"`）＝下書き保存→本人可視に到達 |
| D-TC-203 | 編集後 title `.toBe(after)` → `.toBe(before)` | `Expected "編集前_…" / Received "編集後_…"`＝PATCH で title 更新に到達 |
| D-TC-204 | 送信ボタン初期 `toBeDisabled()` → `toBeEnabled()` | `Expected enabled / Received disabled`＝3必須未充足で活性ガードが効いている |

## D. アイデア SC-12 タブ e2e（2026-08-23）

> 手技＝後追い e2e（`sc-12-ideas.spec.ts`）。D-TC-205 は naive 反転（`.not.toBeVisible`）が読み込み中の一瞬で真になり behavior-red 不成立のため、**`listIdeas` の GET を `page.route(...).abort()` で遮断**して「接続が効いていれば idea が出ない」ことで behavior-red を目視。D-TC-206 は主アサーション反転。いずれも使い捨て spec で確認→破棄→green（sc-12 e2e 2 passed）。

| TC-ID | 手技 | 観測 red（actual） |
| --- | --- | --- |
| D-TC-205 | `**/quests/*/ideas`（GET）を abort → 実データ idea 可視を期待 | `Expected visible / Received element(s) not found`＝一覧描画が listIdeas に依存（デモ据置きなら出るはず） |
| D-TC-206 | 投稿後の一覧反映 `toBeVisible()` → `.not.toBeVisible()` | `Expected not visible / Received visible`＝IDEAS_CHANGED 購読で投稿がリロードなしに一覧へ反映 |

## D. アイデア 投票/フォロー API（2026-08-23）

> 手技＝application のサーバー強制ガードを一時無効化（`if False:`）→ 該当 api TC が red になることを目視 → 復元して green（tests/ideas 41 passed）。無効化差分はコミットに含めない。membership 門番（D-TC-125/129）は詳細と同一の C.0 門番＝既存 D-TC-106/108 の red 証跡で担保／1人1票 upsert（D-TC-120）は repository D-TC-006 の red で担保。

| TC-ID | 一時無効化したガード | 観測 red（actual） |
| --- | --- | --- |
| D-TC-123 | 投票の published 前提（`status != published` の 409） | 409 期待→ 200（下書きへの投票が通る・`{"my_vote":"approve",...}`） |
| D-TC-122 | 投票の vote 権限チェック（403） | 403 期待→ 200（無権限で投票が通る） |
| D-TC-124 | 完了クエストの投票凍結（`_guard_not_completed` の 409） | 409 期待→ 200 |
| D-TC-128 | 完了クエストの新規フォロー凍結（同上） | 409 期待→ 204（完了後もフォローが通る） |

## A. セッション終了通知 e2e（2026-08-23）

> 後追い e2e（`sc-00-session-expiry.spec.ts`）。主アサーション（スナックバー可視）を反転して behavior-red を目視→復元して green（3 passed）。A-TC-024 の反転はスナックバー自動消滅のタイミングで trivial pass になり得るため、redirect（サーバ layout の reason 付与）が主眼＝green の遷移で担保。

| TC-ID | 反転した主アサーション | 観測 red（actual） |
| --- | --- | --- |
| A-TC-023 | `/login?reason=session_expired` のトースト可視 `toBeVisible()` → `.not.toBeVisible()` | `Expected not visible / Received visible`＝reason enum→固定文言のトーストに到達 |
| A-TC-025 | ログアウト後の「ログアウトしました」可視 → `.not.toBeVisible()` | `Expected not visible / Received visible`＝logged_out トーストに到達 |

## D. アイデア 登録モーダルの初期誤検証 fix（2026-08-23）

> バグ修正の retro-red＝**修正前に不具合を実機再現**（`/quests/{id}` で「＋ アイデアを追加」→ URL モーダルを開いた直後、無操作で「件名は必須です。」が表示され `#idea_subject` の `aria-invalid=true`）。原因＝Modal のフォーカス effect が dev の StrictMode 二重実行で先頭フィールドを一時 blur→復帰し、`onBlurField` が誤発火。修正＝blur 検証は**フォーム内へのフォーカス移動時のみ**（`relatedTarget` がフォーム内）に限定。修正後は D-TC-208 green（初期は誤表示なし・タブ移動 blur では従来どおり検証）。

| TC-ID | 観測 red（修正前 actual） |
| --- | --- |
| D-TC-208 | モーダルを開いた直後（無操作）で「件名は必須です。」表示＋`#idea_subject aria-invalid=true`（誤検証）→ 修正後は非表示・aria-invalid なし |

## D. アイデア SC-22 詳細 e2e（2026-08-23）

> 手技＝`GET /ideas/{id}`（getIdea）を `page.route(...).abort()` で遮断し、詳細が描画できない behavior-red を目視→復元して green（sc-22 e2e 1 passed）。

| TC-ID | 手技 | 観測 red（actual） |
| --- | --- | --- |
| D-TC-207 | `**/ideas/*`（GET）を abort → 件名見出し可視を期待 | `Expected visible / Received element(s) not found`＝詳細描画が getIdea に依存（デモ据置きなら出るはず） |

## D. アイデア SC-22 投票/フォロー フロント接続 e2e（2026-08-24）

> 手技＝behavior-red を**接続前バンドルで目視**（frontend はソース非マウント＝現行コンテナは変更前コード＝投票/フォローボタンが `disabled`）。新 spec `sc-22-vote-follow.spec.ts`（D-TC-209〜212）を再ビルド前に実行し、`disabled` ボタンへの click がタイムアウトして 4件 red を確認 → IdeaDetailView 接続＋frontend 再ビルド後に green（4 passed）。回帰＝D-TC-207 は「投票/フォロー活性」へ更新し green（1 passed）。

| TC-ID | 観測 red（接続前 actual） |
| --- | --- |
| D-TC-209 | 「▲ 賛成」ボタンが `disabled`＝`locator.click: Timeout`（Received: disabled）→ 接続後は賛成 1・`aria-pressed=true`・`my_vote=approve` |
| D-TC-210 | 同上（`disabled` で click 不可）→ 接続後は賛成→反対の切替で 反対 1/賛成 0（1人1票・`my_vote=oppose`） |
| D-TC-211 | 同上 → 接続後は同ボタン再クリックで取消（賛成 0・`my_vote=null`） |
| D-TC-212 | 「☆ フォロー」ボタンが `disabled` → 接続後はトグルで `★ フォロー中`（`following=true`）↔ 解除（false） |

## C. クエスト idea_count を D アイデア連動（2026-08-24）

> 後追い（既存 DTO の値を実装済み後に検証）。手技＝`_quest_card_dto`／詳細 DTO の `idea_count` を一時的に `0` 固定（実装前の挙動）へ戻して red を目視→復元して green（tests/quests+ideas 91 passed）。定義＝公開(`published`)・`deleted_at IS NULL` のみ（下書き/削除は除外・API設計 C.1・存在漏れ防止）。

| TC-ID | 観測 red（0固定に戻した actual） |
| --- | --- |
| C-TC-143 | `GET /quests/{id}` の idea_count＝`assert 0 == 2`（published 2件でも 0固定）→ 復元後 2 |
| C-TC-144 | `GET /quests` カードの idea_count＝`assert 0 == 2`（batch 集計未反映）→ 復元後 2 |

## D. アイデア IdeaDetailDTO に quest 参照追加＋SC-22 導線/凍結（2026-08-24）

> api＝`_build_detail` から `"quest": quest_ref` を一時除去して red 目視（`IdeaDetailDTO` の `quest` 必須欠落で pydantic ValidationError→500→`assert 200` 失敗）→復元で green（tests/ideas+quests 92 passed）。e2e＝frontend 非マウントを利用し、quest-ref 接続前バンドルで sc-22-quest-ref を実行して 2 red 目視→再ビルド後 green（2 passed・回帰 vote-follow/idea-detail 5 passed）。

| TC-ID | 観測 red（actual） |
| --- | --- |
| D-TC-130 | quest 除去時＝`ValidationError: IdeaDetailDTO.quest missing`（500）→ `assert r.status_code==200` 失敗。復元後は quest.id/title/status/categories/deadline を返す |
| D-TC-213 | 接続前＝「クエストへ戻る」href が `/quests`（一覧固定）でカテゴリーバッジ無し → 接続後は href=`/quests/{id}`・「業務改善」バッジ可視 |
| D-TC-214 | 接続前＝投票/フォローが活性（completed 未判定）→ 接続後は `⏸ 完了（凍結）`＋投票/新規フォロー `disabled` |

## D. アイデア 添付（D.3・MinIO/multipart）（2026-08-24）

> api＝新規 EP（POST/DELETE/download）は test-first（未実装時は 404/405＝自然 red・コミット参照）。サーバー強制ガードは retro-red を目視＝`validate_attachment_upload` を常に通す＋`too_many` チェックを一時無効化して 132/133 が red→復元で green（tests/ideas+quests 99 passed）。e2e＝frontend 非マウントで接続前バンドルに添付 UI が無く D-TC-215 red→再ビルド後 green（sc-22 系 8・sc-21 系 5 passed）。

| TC-ID | 観測 red（actual） |
| --- | --- |
| D-TC-132 | `too_many` 無効化時＝既存9＋2 でも 201（11件受理）→ `assert 422` 失敗。復元後 422（`code=too_many`） |
| D-TC-133 | mime 検証無効化時＝`evil.exe` を `application/pdf` として 201 受理 → `assert 422` 失敗。復元後 422（`code=mime_not_allowed`） |
| D-TC-215 | 接続前＝SC-21 投稿後も SC-22 にデモ添付のみ／`attachments=[]`（アップロード未送信）→ 実ファイル名が出ず失敗。接続後は SC-22 に実添付＋DL 署名URL |

## B. メールアドレス確認 フロント（SC-92 バッジ＋⋯送信・2026-08-24）

> e2e＝frontend 非マウントを利用し、接続前バンドル（未確認バッジ/「確認メールを送信」なし）で B-TC-169 を実行して red 目視→再ビルド後 green（1 passed・回帰 sc-92b/sc-93 計6 passed）。

| TC-ID | 観測 red（接続前 actual） |
| --- | --- |
| B-TC-169 | 接続前＝メール列に「未確認」バッジ無し・⋯に「確認メールを送信」menuitem 無し → 接続後はバッジ表示＋送信で成功トースト |

## B. last_system_admin 保護を OPS スコープに修正（2026-08-24）

> 既存の抜け修正＝`_active_system_admin_count` が全社横断で数えており、非 OPS 会社に system_admin が居ると OPS の「最後の1人」保護が誤って無効化された（ロックアウト保護の穴＋テスト汚染で b_tc_028 が OPS を無効化）。OPS 会社（予約コード）スコープに限定。retro-red＝count を全社横断へ戻して B-TC-170 が red（他社 admin 併存で OPS 無効化が 200 になる）→復元で green（full 332 passed・t-umekawa active のまま）。

| TC-ID | 観測 red（全社横断に戻した actual） |
| --- | --- |
| B-TC-170 | 非 OPS の system_admin 併存時、OPS 管理者 disable が `200`（本来 422）＝会社横断カウントで「最後の1人」と見なされず保護が外れる → OPS スコープ修正で 422 |

## D. SC-21 §4.7 サーバエラー経由の 3 チャネル（D-TC-216・2026-08-25）

> 後追いテスト（3 チャネル発火は `IdeaForm.persist()` の catch に既実装）＝反転手技で red 目視。`IdeaForm.tsx` の catch を一時反転（`setFieldErrors`/`setSummary`/`notify` を抑止＝サーバエラーを握り潰す）→ frontend 再ビルドで接続バンドルに反映 → D-TC-216 が red（`.form-summary` 不出現）→ 復元＋再ビルドで green。完了クエスト編集の PATCH は 409 invalid_state（api D-TC-111 と同経路）。回帰＝sc-21-idea-form 全 6 passed・tsc 既知2件のみ。

| TC-ID | 観測 red（catch 反転＝3チャネル抑止 actual） |
| --- | --- |
| D-TC-216 | 反転時＝完了クエスト編集で PATCH 409 を受けても `.form-summary`／`.form-footer-error`／`.snackbar--error` がいずれも出ず「押したのに無反応」→ `.form-summary` 不出現で red。復元後は 3 チャネル（上部サマリ「現在の状態では実行できません。」＋足元ヒント＋持続エラースナックバー〔`.snackbar__timer` 無し＝duration:0〕）が出て green |

## D. 版・変更履歴・差分 D.4（D-TC-138〜142/217・2026-08-25）

> 設計を正とし実装を追随＝(1) 初版 revision=1 が公開処理で未記録だったギャップを修正（`_publish_processing`→`_record_initial_revision`・D-TC-109 の版数期待も更新）、(2) `idea_revisions.created_at` がデータモデル §5.14 に無く API設計 D.4 が要求 → §5.14 に追記＋migration `0011_company_idea_revisions_created_at`＋ORM 追加。api＝新規 EP（revisions/diff）は test-first（未実装時は 404）。backend はソースマウントで retro-red を安価に実施（再ビルド不要）。e2e＝frontend 非マウントで接続前バンドル（デモモーダル）に対し D-TC-217 が red→再ビルド後 green（全体 backend 337 passed／sc-22 系＋sc-21 系 回帰 green・attachments はコールドコンパイル flake でウォーム再実行 green）。

| TC-ID | 観測 red（反転/接続前 actual） |
| --- | --- |
| D-TC-142 | `_record_initial_revision` を no-op に反転＝publish 後の `GET revisions` が空 → `assert [r.revision]==[1]` が `[]==[1]` で red。復元で初版 revision=1 記録（通知なし）→ green |
| D-TC-140/141 | `_diff_fields` を空返しに反転＝差分 `fields` が `{}` → `'body'/'title' in fields` が偽で red。復元で語句差分セグメント（テキスト系）＋`{old,new}`（scalar）→ green |
| D-TC-217 | 接続前バンドル（更新履歴モーダル＝デモ静的表示）では編集内容に対応する実データ（v2 の価値/アイデア本文バッジ・実 diff セグメント）が出ず red → RevisionHistory 実接続＋再ビルドで `getRevisions`/`getRevisionDiff` の実データ（初版バッジ・変更フィールド・`.diff-add`）→ green |

## D. SC-21 編集モードの既存添付 管理 UI（D-TC-218・2026-08-25）

> frontend 非マウント＝接続前バンドル（編集フォームは新規アップロードのみで保存済み添付を表示しない）に対し D-TC-218 を実行 → 編集モーダルに `.attach` 既存添付行が出ず red → IdeaForm に既存添付一覧＋× 即時削除（`getIdea.attachments`／`deleteAttachment`／確認ダイアログ）を実装＋再ビルドで green。回帰＝sc-22-attachments 2（215/218）・sc-21-idea-form 6 passed・tsc 既知2件のみ。

| TC-ID | 観測 red（接続前 actual） |
| --- | --- |
| D-TC-218 | 接続前＝編集モーダルに保存済み添付が一切出ない（`.attach` 0件）→ `attachRow` 不可視で red。接続後は `getIdea.attachments` を `.attach` 行で表示し、× →確認ダイアログ「削除する」で `deleteAttachment` 即時削除→一覧から消え `GET /ideas/{id}` の attachments 空・`current_revision` は 1 のまま（版を生まない） |

## F. 評価（新ドメイン・F-TC-101〜120・2026-08-25）

> 新規ドメイン F（evaluations/evaluation_scores・migration 0012）＝新規 EP は test-first（未登録時は 404）。backend はソースマウントで中核ロジックの retro-red を安価に実施（再ビルド不要）。全 backend 360 passed（337＋F 23）。XP/コインは G `ledger.grant`＋`exists_ref` 冪等。C の完了遷移フック `_finalize_completion` を F へ接続（同一 UoW・(b) 一括確定）。

| TC-ID | 観測 red（中核ロジック反転 actual） |
| --- | --- |
| F-TC-118/119 | `_finalize_idea_coin` を no-op に反転＝(a) 全員提出／(b) completed 遷移でも投稿者コインが確定されず → `coin.finalized`/`evaluation_coin` activity が 0 で red。復元で `round(avg×10)`（最大50）を1回だけ確定（冪等）→ green |
| F-TC-111 | `_can_view_evaluation` を常に True に反転＝limited 評価が範囲外にも漏れる → `evaluator_count`/`aspects` が limited を含み red（分母が2になる）。復元で limited を集計から除外（coin は visibility 無視で全 submitted 算定は維持）→ green |
| F-TC-104/106 | `_validate_evaluation` を no-op に反転＝submitted で全5観点/総評未充足・score 範囲外でも通過 → `assert 422` が失敗（200 になる）で red。復元で 422（errors[].field）→ green |

## F. 評価フロント接続（SC-25/SC-22 §4.6・F-TC-201〜203・2026-08-25）

> frontend 非マウント＝接続前バンドル（EvaluationView/SC-22 §4.6 がデモ）に対し sc-25-eval を実行 → 3件とも red（確定後に実データが出ない／選定ボタンが無い）→ EvaluationView を `getMyEvaluation`/`putEvaluation`、SC-22 を `getEvaluationAggregate`/`selectIdea` で実接続＋再ビルドで green。回帰＝sc-22 系（idea-detail/quest-ref/revisions/vote-follow/attachments）green・tsc 既知2件のみ・backend 360 passed。

| TC-ID | 観測 red（接続前 actual） |
| --- | --- |
| F-TC-201 | 接続前＝確定するとデモトースト（＋10XP）で戻るのみ・SC-22 は「デモ表示（F 未接続）」で評価者2名固定 → 実データ「評価者1名」/平均5.0/総評が出ず red。接続後は `getEvaluationAggregate` の実集計が描画 → green |
| F-TC-202 | 接続前＝下書きはデモ（サーバー保存なし）・再訪しても採点が復元しない → `aria-pressed` が false で red。接続後は `putEvaluation(draft)`→`getMyEvaluation` プリフィルで復元 → green |
| F-TC-203 | 接続前＝SC-22 に選定ボタンが無い（デモは評価導線のみ） → `このアイデアを選定` 不可視で red。接続後は `my_permissions.select` で表示・`selectIdea` で is_selected＋「選定候補」バッジ → green |

## E. チャット コア会話（新ドメイン・E-TC-101〜114・2026-08-25）

> 新規ドメイン E（chat_groups/chat_messages/chat_mentions/reactions/reaction_emojis/chat_reads/spells/user_spells・migration 0013＋マスタシード）＝新規 EP は test-first（未登録時 404/405）。backend はソースマウントで中核ロジックの retro-red を安価に実施。本コミットは**コア会話**（メッセージ CRUD・既読・活発度・添付・メンション）。リアクション/魔法（E.4）と魔法解放（G）は後続コミット。公開で chat_group を作成（D `_publish_processing`）・DL は D.3 共通 EP をチャット添付にも拡張。全 backend 374 passed（360＋14）。

| TC-ID | 観測 red（中核ロジック反転 actual） |
| --- | --- |
| E-TC-104 | `_require_comment` を no-op に反転＝comment 権限なしでも投稿できる → `assert 403` が失敗（201）で red。復元で 403 → green |
| E-TC-102 | `_award_chat_xp` の grant を抑止＝投稿しても XP が付かない → `activities`(reason=chat) が 0 で red。復元で XP+5（日次上限10/日）→ green |

## E/G. リアクション/魔法＋魔法解放（E-TC-115〜122・G-TC-101〜106・2026-08-25）

> コミット2＝リアクション（通常/魔法・E.4）＋魔法解放（G unlock・SP 消費）。新規 EP は test-first。retro-red は中核ガードの反転（解放済みチェック・SP チェック）で目視。backend 388 passed（374＋14）。

| TC-ID | 観測 red（中核ロジック反転 actual） |
| --- | --- |
| E-TC-118 | 魔法リアクションの `is_spell_unlocked` ガードを無効化＝未解放でも魔法を付けられる → `assert 403`（spell_not_unlocked）失敗で red。復元で 403 → green |
| G-TC-103 | unlock の SP 充足チェックを無効化＝SP 不足でも解放できてしまう → `assert 409`（insufficient_sp）失敗で red。復元で 409 → green |

## E. SC-24 チャット フロント接続（E-TC-201・2026-08-25）

> frontend 非マウント＝接続前バンドル（IdeaChatView がデモ fixtures＝OPS ログイン・初期5件固定）に対し E-TC-201 を実行 → 実データ文脈（アイデア件名）が出ず red → `features/chat/api.ts`＋IdeaChatView を実接続（getChat/getIdea/postMessage/addReaction/markRead 等）＋再ビルドで green。backend メッセージ表現に is_mine 追加。※複数引用は backend 単一 reply のため単一（follow-up）。

| TC-ID | 観測 red（接続前 actual） |
| --- | --- |
| E-TC-201 | 接続前＝デモ（固定メッセージ・「夜間配送…」）で作成したアイデアの文脈が出ず、投稿もサーバーに載らない → `チャットアイデア_stamp` 不可視で red。接続後は `postMessage`→`getChat` の実データ＋👍リアクション（`addReaction`）が描画 → green |
| E-TC-202 | 接続前＝SC-22 チャットカードがデモ（💬 8 固定・デモプレビュー）で、API 投稿した本文が `.chat-preview` に出ず red。接続後は `getChatActivity`（total_messages）＋`getChat`（直近3件）の実データが描画 → green |
