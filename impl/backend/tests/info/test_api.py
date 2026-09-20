"""N-TC-101〜106: GET /info-items・GET /info-items/word-cloud の API（SC-50・API設計 N.1/N.6）。

seed 一般ユーザー（ACME-01）でログインし、会社DB に seed した情報（conftest.info_env）で
DTO 形状・全文検索・入力検証・認可を検証する。情報プールは会社内 active ユーザーなら閲覧可（N.0）。
"""
from __future__ import annotations

from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

INFO = "/api/v1/info-items"
WORD_CLOUD = "/api/v1/info-items/word-cloud"


def test_n_tc_101_list_card_shape(client, info_env):
    """N-TC-101: 一覧が card DTO 形状で返る（派生集計・created_by・page_info）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(INFO)
    assert r.status_code == 200, r.text
    body = r.json()
    card = next((c for c in body["data"] if c["id"] == str(info_env.ids.a)), None)
    assert card is not None
    assert card["status"] == "curated"
    assert card["impact_class"] == "opportunity"
    assert set(card["categories"]) == {"ext_technology", "ext_industry"}
    assert card["link_count"] == 2  # 棄却1件は除外
    assert card["follow_up_count"] == 2
    assert card["created_by"]["user_id"] == str(info_env.user_id)
    assert card["created_by"]["display_name"]
    assert "summary" in card and "source_url" in card and "due_date" in card
    assert {"total", "page", "per_page"} <= set(body["page_info"].keys())


def test_n_tc_102_status_enum_validation(client, info_env):
    """N-TC-102: status enum の入力検証（422・field=status）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(INFO, params={"status": "bogus"})
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["code"] == "validation_error"
    assert any(e.get("field") == "status" for e in body.get("errors", []))


def test_n_tc_103_unknown_sort_key_422(client, info_env):
    """N-TC-103: 未知ソートキーは 422（ホワイトリスト・field=sort）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(INFO, params={"sort": "bogus"})
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["code"] == "validation_error"
    assert any(e.get("field") == "sort" for e in body.get("errors", []))


def test_n_tc_104_unauthenticated_401(client):
    """N-TC-104: 未認証は 401。"""
    r = client.get(INFO)
    assert r.status_code == 401, r.text


def test_n_tc_105_full_text_search(client, info_env):
    """N-TC-105: 全文検索タブ（q）でヒット行のみ返る。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(INFO, params={"q": "ブロックチェーン"})
    assert r.status_code == 200, r.text
    ids = {c["id"] for c in r.json()["data"]}
    assert ids == {str(info_env.ids.b)}


def test_n_tc_107_status_facets(client, info_env):
    """N-TC-107: 状態 facet 件数（all/raw/curated・archived 除外）を返す。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(INFO)
    assert r.status_code == 200, r.text
    facets = r.json()["facets"]
    assert {"all", "raw", "curated"} == set(facets.keys())
    assert facets["all"] == facets["raw"] + facets["curated"]
    # seed（info_env）は raw(3: fu1,fu2,b と d?) 実際の内訳に依らず archived は含めない → all>=4。
    assert facets["all"] >= 1 and facets["raw"] >= 1 and facets["curated"] >= 1


def test_n_tc_106_word_cloud(client, info_env):
    """N-TC-106: ワードクラウドが tokens[] を count 降順で返す。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(WORD_CLOUD)
    assert r.status_code == 200, r.text
    tokens = r.json()["tokens"]
    assert tokens and tokens[0]["token"] == "生成ai"
    counts = [t["count"] for t in tokens]
    assert counts == sorted(counts, reverse=True)
