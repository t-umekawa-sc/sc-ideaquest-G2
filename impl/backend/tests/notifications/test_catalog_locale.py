"""H-TC-170: 通知カタログの locale 出し分け（§2.1 i18n・H.2）。

`catalog.render(session, n, locale)` の locale 分岐を純関数として検証する（ref 解決を要さない
種別＝security_*・mention（idea 参照なし）・未知種別を対象。session は参照されないので None で可）。
受信者 locale の実結線（GET＝`user.locale`／push＝受信者 `User.locale`）は呼び出し側の 1 行委譲。
"""
from __future__ import annotations

from app.tenant.notifications import catalog
from app.tenant.notifications.orm import Notification


def _n(type_: str, params: dict | None = None) -> Notification:
    # 未永続の transient ORM オブジェクト（session に add しない）。ref_* は未設定＝None。
    return Notification(type=type_, params=params or {}, body=None)


def test_h_tc_170_catalog_render_locale_ja_en():
    # security_password_changed（ref 不要・固定文＋context＋tag）
    ja = catalog.render(None, _n("security_password_changed"), None)
    assert "パスワードが変更されました" in ja["body"] and ja["tag"] == "セキュリティ"
    assert ja["context"] == "メールでもお知らせしています"
    en = catalog.render(None, _n("security_password_changed"), "en")
    assert en["body"].startswith("Your password was changed") and en["tag"] == "Security"
    assert en["context"] == "We also notified you by email"
    # icon は locale 非依存
    assert ja["icon"] == en["icon"] == "🔑"

    # 不明ロケールは ja にフォールバック
    fr = catalog.render(None, _n("security_password_changed"), "fr")
    assert "パスワードが変更されました" in fr["body"]

    # security_new_device（context は params 由来・tag のみ locale 連動）
    nd_en = catalog.render(None, _n("security_new_device", {"ip": "1.2.3.4"}), "en")
    assert nd_en["body"] == "A sign-in from a new device was detected" and nd_en["tag"] == "Security"
    assert "IP 1.2.3.4" in nd_en["context"]

    # mention（idea 参照なし＝session 未使用・actor は params）
    m_ja = catalog.render(None, _n("mention", {"actor_name": "花子"}), None)
    assert m_ja["body"] == "花子 さんがチャットであなたをメンションしました" and m_ja["context"] is None
    m_en = catalog.render(None, _n("mention", {"actor_name": "Hanako"}), "en")
    assert m_en["body"] == "Hanako mentioned you in chat"
    # actor 欠落時のフォールバックも locale 連動
    assert catalog.render(None, _n("mention"), "en")["body"].startswith("Someone ")
    assert catalog.render(None, _n("mention"), None)["body"].startswith("誰か ")

    # 未知種別は body フォールバックのみ（type→icon 無し）
    unk = catalog.render(None, _n("__unknown__"), "en")
    assert unk["body"] == "Notification" and unk["icon"] is None
