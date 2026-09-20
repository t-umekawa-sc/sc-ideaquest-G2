"""N-TC-012: 情報インプットの保存時派生（サニタイズ／平文／トークン抽出・N.6/N.7）＝純関数の単体。"""
from __future__ import annotations

from app.tenant.info import derive


def test_n_tc_012_sanitize_plain_tokens():
    html = ('<p onclick="evil()">生成AIの<strong>導入</strong>が拡大</p>'
            '<script>alert(1)</script><a href="javascript:evil()">x</a>')
    s = derive.sanitize_html(html)
    assert "<script" not in s and "onclick" not in s and "javascript:" not in s  # 危険要素は除去
    assert "<strong>" in s  # 許可タグは残る

    plain = derive.to_plain_text(s)
    assert "生成" in plain and "導入" in plain and "<" not in plain  # 平文化

    tokens = dict(derive.extract_tokens("生成AIの導入が拡大。生成AIの活用が進む。"))
    assert tokens  # 内容語トークンが抽出される（頻度）
    assert all(isinstance(c, int) and c >= 1 for c in tokens.values())

    assert derive.is_valid_source_url("https://example.com") is True
    assert derive.is_valid_source_url("http://example.com") is True
    assert derive.is_valid_source_url("javascript:evil()") is False
    assert derive.is_valid_source_url("") is True  # 空は許可（任意）
