"""A-TC-108/109: リクエスト locale 解決＋エラー応答 title の locale 出し分け（§2.1・README §1.7）。

解決順＝ユーザー設定（session.locale）→ Accept-Language → 既定 ja。バックエンドの自己ローカライズ出力の
うち entity 非依存なのはエラー応答のみ（メール/通知/マスタ名は entity-bound）。
"""
from __future__ import annotations

from types import SimpleNamespace

from app.core.locale import DEFAULT, normalize, parse_accept_language, resolve_request_locale
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

_MISSING = object()


def _req(accept=None, user_locale=_MISSING):
    state = SimpleNamespace()
    if user_locale is not _MISSING:
        state.user_locale = user_locale
    headers = {"accept-language": accept} if accept is not None else {}
    return SimpleNamespace(state=state, headers=headers)


def test_a_tc_108_locale_resolution():
    # normalize: 一次サブタグへ・未対応は None
    assert normalize("en-US") == "en" and normalize("JA") == "ja"
    assert normalize("de") is None and normalize("") is None and normalize(None) is None

    # parse_accept_language: q 値順で最上位対応言語
    assert parse_accept_language("en-US,en;q=0.9,ja;q=0.8") == "en"
    assert parse_accept_language("ja,en;q=0.5") == "ja"
    assert parse_accept_language("ja;q=0.3, en;q=0.9") == "en"  # q 優先（記載順ではない）
    assert parse_accept_language("fr,de") is None               # 未対応のみ
    assert parse_accept_language("en;q=0") is None              # q=0 は除外
    assert parse_accept_language("") is None and parse_accept_language(None) is None

    # resolve_request_locale: ユーザー設定→Accept-Language→ja
    assert resolve_request_locale(_req(accept="en", user_locale="ja")) == "ja"   # 設定が最優先
    assert resolve_request_locale(_req(accept="en")) == "en"                     # 設定なし→AL
    assert resolve_request_locale(_req(accept="ja")) == "ja"
    assert resolve_request_locale(_req()) == DEFAULT == "ja"                     # どちらも無し→既定
    assert resolve_request_locale(_req(accept="en", user_locale="fr")) == "en"   # 未対応設定は AL へ


NOTIF = "/api/v1/notifications"


def test_a_tc_109_error_title_locale(client, factory):
    # 未認証（ユーザー設定なし）＝Accept-Language が効く
    r_en = client.get(NOTIF, headers={"Accept-Language": "en-US,en;q=0.9"})
    assert r_en.status_code == 401
    assert r_en.json()["title"] == "Unauthenticated" and r_en.json()["code"] == "unauthenticated"
    r_ja = client.get(NOTIF)  # ヘッダ無し＝既定 ja
    assert r_ja.status_code == 401 and r_ja.json()["title"] == "未認証"

    # ログイン済み＝ユーザー設定(ja)が Accept-Language(en) より優先
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    r = client.get(f"{NOTIF}?state=bogus", headers={"Accept-Language": "en"})
    assert r.status_code == 422
    assert r.json()["title"] == "入力値が不正です" and r.json()["code"] == "validation_error"
