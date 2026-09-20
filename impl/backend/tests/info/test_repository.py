"""N-TC-001〜008: 情報インプット repository の一覧クエリ・派生集計・ワードクラウド（API設計 N.1/N.6・§5.33-5.36）。

会社DB に情報を直接 seed（conftest.info_env）し、`build_info_list_query`／集計／`word_cloud` を検証する。
呼び出し側 Tx 相乗（自身では commit しない）。
"""
from __future__ import annotations

from app.core.errors import AppError
from app.db.tenant import get_tenant_session
from app.tenant.info import repository as repo
from app.tenant.info.orm import InfoItem


def _ids(session, stmt):
    return [r.id for r in session.execute(stmt).scalars().all()]


def _own(stmt, user_id):
    """会社DB には bootstrap のデモ情報も常駐するため、フィクスチャ author に絞って検証を hermetic に保つ。"""
    return stmt.where(InfoItem.created_by_id == user_id)


def test_n_tc_001_default_excludes_archived_newest_first(info_env):
    """N-TC-001: 既定＝archived 除外・created_at DESC。"""
    with get_tenant_session(info_env.db_identifier) as ts:
        rows_stmt, count_stmt = repo.build_info_list_query()
        ids = _ids(ts, rows_stmt)
        # 続報（fu2>fu1>a）が最新・archived(c) は除外。
        assert info_env.ids.c not in ids
        # seed 集合内の並びが created_at DESC（fu2, fu1, a, d, b）で単調。
        seed_order = [i for i in ids if i in {info_env.ids.fu2, info_env.ids.fu1, info_env.ids.a,
                                              info_env.ids.d, info_env.ids.b}]
        assert seed_order == [info_env.ids.fu2, info_env.ids.fu1, info_env.ids.a,
                              info_env.ids.d, info_env.ids.b]


def test_n_tc_002_status_filter(info_env):
    """N-TC-002: status フィルタ（多値 OR・archived 明示時のみ含む）。"""
    with get_tenant_session(info_env.db_identifier) as ts:
        curated, _ = repo.build_info_list_query(statuses=["curated"])
        assert _ids(ts, _own(curated, info_env.user_id)) == [info_env.ids.a]
        archived, _ = repo.build_info_list_query(statuses=["archived"])
        assert _ids(ts, _own(archived, info_env.user_id)) == [info_env.ids.c]


def test_n_tc_003_impact_class_filter(info_env):
    """N-TC-003: impact_class 多値 OR フィルタ。"""
    with get_tenant_session(info_env.db_identifier) as ts:
        threat, _ = repo.build_info_list_query(impact_classes=["threat"])
        assert _ids(ts, _own(threat, info_env.user_id)) == [info_env.ids.b]


def test_n_tc_004_full_text_search(info_env):
    """N-TC-004: 全文検索 q（PGroonga &@~・title＋body_text）。"""
    with get_tenant_session(info_env.db_identifier) as ts:
        hit, _ = repo.build_info_list_query(q="ブロックチェーン")
        assert _ids(ts, hit) == [info_env.ids.b]


def test_n_tc_005_offset_paging_stable(info_env):
    """N-TC-005: 番号ページャ（offset/limit）で重複なく続きを返す（既定 -created_at）。"""
    with get_tenant_session(info_env.db_identifier) as ts:
        rows_stmt, _ = repo.build_info_list_query(statuses=["raw", "curated"])  # archived 除外
        rows_stmt = _own(rows_stmt, info_env.user_id)  # フィクスチャ author に限定（5件）
        page1 = _ids(ts, rows_stmt.offset(0).limit(2))
        page2 = _ids(ts, rows_stmt.offset(2).limit(2))
        assert page1 == [info_env.ids.fu2, info_env.ids.fu1]
        assert page2 == [info_env.ids.a, info_env.ids.d]
        assert not set(page1) & set(page2)  # 重複なし


def test_n_tc_006_derived_counts(info_env):
    """N-TC-006: link_count（未棄却のみ）・follow_up_count の集計。"""
    with get_tenant_session(info_env.db_identifier) as ts:
        link_counts = repo.link_counts_for_items(ts, [info_env.ids.a])
        follow_counts = repo.follow_up_counts_for_items(ts, [info_env.ids.a])
        assert link_counts.get(info_env.ids.a) == 2  # 棄却1件は除外
        assert follow_counts.get(info_env.ids.a) == 2


def test_n_tc_007_sort_whitelist(info_env):
    """N-TC-007: priority 昇順ソート（ホワイトリスト）／未知キーは 422。"""
    with get_tenant_session(info_env.db_identifier) as ts:
        rows_stmt, _ = repo.build_info_list_query(statuses=["raw", "curated"], sort="priority")
        ordered = [i for i in _ids(ts, rows_stmt)
                   if i in {info_env.ids.a, info_env.ids.d, info_env.ids.b}]
        # priority 文字列昇順: high(a) < low(b) < normal(d)。
        assert ordered == [info_env.ids.a, info_env.ids.b, info_env.ids.d]
    try:
        repo.build_info_list_query(sort="bogus")
        assert False, "未知 sort キーで AppError が出るべき"
    except AppError as e:
        assert e.status == 422


def test_n_tc_009_roots_only(info_env):
    """N-TC-009: 続報を束ねる（roots_only＝根のみ・parent_info_id IS NULL）。"""
    with get_tenant_session(info_env.db_identifier) as ts:
        rows_stmt, _ = repo.build_info_list_query(statuses=["raw", "curated"], roots_only=True)
        ids = _ids(ts, _own(rows_stmt, info_env.user_id))
        # 続報 fu1/fu2 は除外・根（a/d/b）は含む。
        assert info_env.ids.fu1 not in ids and info_env.ids.fu2 not in ids
        assert {info_env.ids.a, info_env.ids.d, info_env.ids.b} <= set(ids)


def test_n_tc_008_word_cloud(info_env):
    """N-TC-008: ワードクラウド集計（token GROUP BY・count 降順・limit・archived 除外）。"""
    # 会社全体集計のため bootstrap デモ token も混ざる＝構造（降順・正規化・archived 除外）で検証する。
    with get_tenant_session(info_env.db_identifier) as ts:
        tokens = repo.word_cloud(ts, limit=50)
    toks = [t["token"] for t in tokens]
    counts = [t["count"] for t in tokens]
    assert counts == sorted(counts, reverse=True)  # count 降順
    assert tokens[0]["weight"] == 1.0              # 最頻値を 1.0 に正規化
    assert "生成ai" in toks and "競合" in toks and "需要" in toks  # フィクスチャ token が集計に含まれる
    assert "アーカイブ語" not in toks               # archived の token は除外
