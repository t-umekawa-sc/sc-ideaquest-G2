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
        # フィクスチャの item id に限定＝共有DBに他ユーザー/受入で増えた info でページ順が崩れないよう hermetic に。
        fx = [info_env.ids.a, info_env.ids.b, info_env.ids.c, info_env.ids.d, info_env.ids.fu1, info_env.ids.fu2]
        rows_stmt = rows_stmt.where(InfoItem.id.in_(fx))
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


def test_n_tc_013_create_info_item(info_env):
    """N-TC-013: create_info_item＝status=raw・created_by 正・info_tokens 保存。"""
    from app.tenant.info.orm import InfoItem, InfoToken
    with get_tenant_session(info_env.db_identifier) as ts:
        item = repo.create_info_item(ts, created_by_id=info_env.user_id, title="新規メモ",
                                     body_html="<p>本文</p>", body_text="本文", summary="本文")
        ts.flush()
        repo.replace_tokens(ts, item.id, [("本文", 2), ("テスト", 1)])
        ts.commit()
        iid = item.id
    try:
        with get_tenant_session(info_env.db_identifier) as ts:
            got = repo.get_info_item(ts, iid)
            assert got.status == "raw" and got.created_by_id == info_env.user_id and got.summary == "本文"
            assert {t["token"] for t in repo.tokens_top(ts, iid, limit=10)} == {"本文", "テスト"}
    finally:
        with get_tenant_session(info_env.db_identifier) as ts:
            ts.execute(InfoToken.__table__.delete().where(InfoToken.info_item_id == iid))
            ts.execute(InfoItem.__table__.delete().where(InfoItem.id == iid))
            ts.commit()


def test_n_tc_014_snapshot_parent_links(info_env):
    """N-TC-014: 続報登録＝親の未棄却リンクのみ origin=auto で複製（棄却は複製しない）。"""
    from app.tenant.info.orm import InfoItem, InfoLink
    with get_tenant_session(info_env.db_identifier) as ts:
        child = repo.create_info_item(ts, created_by_id=info_env.user_id, title="続報",
                                      parent_info_id=info_env.ids.a)
        ts.flush()
        n = repo.snapshot_parent_links(ts, info_env.ids.a, child.id)  # ids.a=未棄却2＋棄却1
        ts.commit()
        cid = child.id
    try:
        with get_tenant_session(info_env.db_identifier) as ts:
            links = repo.links_for_item(ts, cid)
            assert n == 2 and len(links) == 2  # 未棄却2のみ複製・棄却は除外
            assert all(l.origin == "auto" for l in links)
    finally:
        with get_tenant_session(info_env.db_identifier) as ts:
            ts.execute(InfoLink.__table__.delete().where(InfoLink.info_item_id == cid))
            ts.execute(InfoItem.__table__.delete().where(InfoItem.id == cid))
            ts.commit()


def test_n_tc_015_revisions_and_categories(info_env):
    """N-TC-015: add_revision の版連番／replace_categories の全置換。"""
    with get_tenant_session(info_env.db_identifier) as ts:
        r1 = repo.add_revision(ts, info_env.ids.a, info_env.user_id, {"title": "v1"})
        r2 = repo.add_revision(ts, info_env.ids.a, info_env.user_id, {"title": "v2"})
        assert (r1, r2) == (1, 2)
        assert repo.revision_count(ts, info_env.ids.a) == 2
        repo.replace_categories(ts, info_env.ids.a, ["ext_economy", "ext_economy", "ext_industry"])
        ts.flush()
        cats = repo.categories_for_items(ts, [info_env.ids.a]).get(info_env.ids.a, [])
        assert set(cats) == {"ext_economy", "ext_industry"}  # 重複除去・置換
        ts.commit()  # teardown（conftest）が revisions/categories/items を物理削除


def test_n_tc_016_create_find_link(info_env):
    """N-TC-016: create_link（origin=manual・kind=related 既定）／find_link の重複検出。"""
    import uuid as _uuid
    tgt = _uuid.uuid4()
    with get_tenant_session(info_env.db_identifier) as ts:
        link = repo.create_link(ts, info_item_id=info_env.ids.d, target_type="ideas", target_id=tgt)
        ts.flush()
        assert link.origin == "manual" and link.kind == "related"
        found = repo.find_link(ts, info_env.ids.d, "ideas", tgt)
        assert found is not None and found.id == link.id
        assert repo.find_link(ts, info_env.ids.d, "ideas", _uuid.uuid4()) is None  # 別 target は不検出
        ts.commit()  # teardown（conftest）が created_items のリンクを物理削除


def test_n_tc_017_search_link_candidates(info_env):
    """N-TC-017: リンク候補のタイトル検索（quests）／未実装ドメインは空。"""
    import uuid as _uuid
    from app.tenant.quests.orm import Quest
    qid = _uuid.uuid4()
    with get_tenant_session(info_env.db_identifier) as ts:
        ts.add(Quest(id=qid, owner_id=info_env.user_id, title="候補クエストZZZ", color="#3B82F6", status="recruiting"))
        ts.commit()
    try:
        with get_tenant_session(info_env.db_identifier) as ts:
            cands, _more = repo.search_link_candidates(ts, types=["quests"], q="候補クエストZZZ", limit=10)
            assert any(c["target_id"] == str(qid) and c["title"] == "候補クエストZZZ" for c in cands)
            # 未実装ドメイン（concepts）は候補ゼロ。
            empty, _m2 = repo.search_link_candidates(ts, types=["concepts"], q="x", limit=10)
            assert empty == []
    finally:
        with get_tenant_session(info_env.db_identifier) as ts:
            ts.execute(Quest.__table__.delete().where(Quest.id == qid)); ts.commit()


def test_n_tc_010_detail_aggregates(info_env):
    """N-TC-010: 詳細集計＝links（target_title 解決・rejected 含む）/follow_ups（時系列）/tokens_top。"""
    with get_tenant_session(info_env.db_identifier) as ts:
        item = repo.get_info_item(ts, info_env.ids.a)
        assert item is not None
        links = repo.links_for_item(ts, info_env.ids.a)
        assert len(links) == 3  # 未棄却2＋棄却1
        assert sum(1 for l in links if l.rejected_at is not None) == 1
        titles = repo.resolve_link_titles(ts, links)
        # info_env は target_id をランダム UUID で seed（実 idea/quest 不在）＝解決は空でも落ちない。
        assert isinstance(titles, dict)
        fus = repo.follow_up_items(ts, info_env.ids.a)
        assert [f.id for f in fus] == [info_env.ids.fu1, info_env.ids.fu2]  # created_at 昇順
        tokens = repo.tokens_top(ts, info_env.ids.a, limit=10)
        assert tokens and tokens[0]["token"] == "生成ai" and tokens[0]["weight"] == 1.0
        assert repo.get_info_item(ts, __import__("uuid").uuid4()) is None  # 不在は None


def test_n_tc_011_is_curator(info_env):
    """N-TC-011: is_curator＝付与=true／未付与・剥奪(revoked)=false。"""
    from datetime import datetime, timezone

    from app.tenant.info.orm import InfoCurator
    with get_tenant_session(info_env.db_identifier) as ts:
        assert repo.is_curator(ts, info_env.user_id) is False  # 未付与
        grant = InfoCurator(user_id=info_env.user_id)
        ts.add(grant); ts.commit()
    try:
        with get_tenant_session(info_env.db_identifier) as ts:
            assert repo.is_curator(ts, info_env.user_id) is True  # 付与
            row = ts.get(InfoCurator, grant.id); row.revoked_at = datetime(2026, 9, 20, tzinfo=timezone.utc); ts.commit()
        with get_tenant_session(info_env.db_identifier) as ts:
            assert repo.is_curator(ts, info_env.user_id) is False  # 剥奪
    finally:
        with get_tenant_session(info_env.db_identifier) as ts:
            ts.execute(InfoCurator.__table__.delete().where(InfoCurator.user_id == info_env.user_id)); ts.commit()


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
