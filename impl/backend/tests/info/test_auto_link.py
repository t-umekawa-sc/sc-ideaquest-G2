"""情報インプットの自動関連付け（TF-IDF/類似度 auto-link・N.6）＝N-TC-149〜152。

情報保存（create/update）時に本文トークンと候補成果物のキーワード重なり（cosine）で類似度を計算し、
閾値＋上位 N の新規 (info,target) 組に auto リンク（origin=auto/kind=related/score）を生成する。
既存行は score のみ更新し kind/rejected_at/disposition は保持（人の決定を尊重）。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.ideas.orm import Idea
from app.tenant.info import application as app_info
from app.tenant.info import derive
from app.tenant.info import repository as repo
from app.tenant.info.orm import InfoItem, InfoItemRevision, InfoLink
from app.tenant.tokens import repository as tokens_repo
from app.tenant.tokens.orm import EntityToken
from app.tenant.info.schemas import InfoCreateRequest, InfoUpdateRequest
from app.tenant.profile.orm import User
from app.tenant.quests.orm import Quest
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN

# 他 seed と重ならない distinctive な本文＝候補が本テストの seed アイデアだけに絞られる（フレーク防止）。
_UNIQUE_TEXT = "菌根共生プラントのテラフォーミング試験を灌漑ドローンで実施する"
_UNRELATED_TEXT = "決算説明会の配布資料と株主総会の運営手順"


def _ctx():
    with control_session() as s:
        company = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one()
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
        return company.id, company.db_identifier, account.id


def _seed_ideas(db_identifier, specs: list[tuple[uuid.UUID, str]], *, status: str = "published"):
    """(idea_id, text) を status（既定 published）アイデアとして seed。owner/quest は使い捨てで用意。"""
    owner = uuid.uuid4()
    qid = uuid.uuid4()
    with get_tenant_session(db_identifier) as ts:
        ts.add(User(id=owner, account_id=uuid.uuid4(), display_name="自動リンクtest所有者", locale="ja", status="active"))
        ts.flush()
        ts.add(Quest(id=qid, owner_id=owner, title="自動リンクtestクエスト", color="#0D9488", status="recruiting"))
        ts.flush()
        for iid, text in specs:
            ts.add(Idea(id=iid, quest_id=qid, author_id=owner, title=text[:40], body=text, value="v", status=status))
        ts.commit()
    return owner, qid


def _cleanup(db_identifier, *, info_ids, idea_ids, quest_id, owner_id):
    with get_tenant_session(db_identifier) as ts:
        if info_ids:
            ts.execute(InfoItemRevision.__table__.delete().where(InfoItemRevision.info_item_id.in_(info_ids)))
            ts.execute(EntityToken.__table__.delete().where(EntityToken.owner_type == "info", EntityToken.owner_id.in_(info_ids)))
            ts.execute(InfoLink.__table__.delete().where(InfoLink.info_item_id.in_(info_ids)))
            ts.execute(InfoItem.__table__.delete().where(InfoItem.id.in_(info_ids)))
        if idea_ids:
            # 前向き auto-link の自己修復で idea 側 entity_tokens も生成されうる（§5.36b・Phase B）＝併せて掃除。
            ts.execute(EntityToken.__table__.delete().where(EntityToken.owner_type == "idea", EntityToken.owner_id.in_(idea_ids)))
            ts.execute(Idea.__table__.delete().where(Idea.id.in_(idea_ids)))
        ts.execute(Quest.__table__.delete().where(Quest.id == quest_id))
        ts.execute(User.__table__.delete().where(User.id == owner_id))
        ts.commit()


def test_n_tc_149_token_cosine():
    """N-TC-149: トークン重なりの cosine＝無関係0・一部(0,1)・同一≈1・対称。"""
    a = derive.extract_tokens("生成AIの業務利用が拡大し、自動化が進む。")
    b = derive.extract_tokens("生成AIの活用で業務が自動化される。")
    c = derive.extract_tokens("旅行の予約と天気予報の話題。")
    assert derive.token_cosine(a, c) == 0.0                    # 重なりなし＝0
    assert 0.0 < derive.token_cosine(a, b) <= 1.0             # 一部重なり＝(0,1]
    assert derive.token_cosine(a, b) == derive.token_cosine(b, a)  # 対称
    assert derive.token_cosine(a, a) == pytest.approx(1.0)    # 同一集合≈1
    assert derive.token_cosine([], a) == 0.0                  # 片方空＝0


def test_n_tc_150_auto_link_created_for_similar_idea():
    """N-TC-150: 情報保存で類似アイデアに auto リンク生成（無関係には作らない）。"""
    company_id, db_identifier, account_id = _ctx()
    hit, miss = uuid.uuid4(), uuid.uuid4()
    owner, qid = _seed_ideas(db_identifier, [(hit, _UNIQUE_TEXT), (miss, _UNRELATED_TEXT)])
    info_ids: list[uuid.UUID] = []
    try:
        created = app_info.create_info_item(
            account_id, company_id,
            body=InfoCreateRequest(title="自動リンク検証", body_html=f"<p>{_UNIQUE_TEXT}</p>"))
        info_ids.append(uuid.UUID(created["id"]))
        with get_tenant_session(db_identifier) as ts:
            links = {(l.target_type, l.target_id): l for l in repo.links_for_item(ts, info_ids[0])}
        hit_link = links.get(("ideas", hit))
        assert hit_link is not None, "類似アイデアに auto リンクが張られる"
        assert hit_link.origin == "auto" and hit_link.kind == "related"
        assert hit_link.score is not None and hit_link.created_by_id is None
        assert hit_link.disposition == "pending"
        assert ("ideas", miss) not in links, "無関係アイデアには張らない"
    finally:
        _cleanup(db_identifier, info_ids=info_ids, idea_ids=[hit, miss], quest_id=qid, owner_id=owner)


def test_n_tc_151_recompute_preserves_human_decisions():
    """N-TC-151: 再計算は score のみ更新・手動 kind/棄却は保持（復活させない・重複行なし）。"""
    company_id, db_identifier, account_id = _ctx()
    keep, human, rejected = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    owner, qid = _seed_ideas(db_identifier, [(keep, _UNIQUE_TEXT), (human, _UNIQUE_TEXT), (rejected, _UNIQUE_TEXT)])
    info_ids: list[uuid.UUID] = []
    try:
        created = app_info.create_info_item(
            account_id, company_id,
            body=InfoCreateRequest(title="再計算検証", body_html=f"<p>{_UNIQUE_TEXT}</p>"))
        iid = uuid.UUID(created["id"]); info_ids.append(iid)
        # 人の操作を模す＝human 組の kind を supporting に・rejected 組を棄却。
        from datetime import datetime, timezone
        with get_tenant_session(db_identifier) as ts:
            links = {(l.target_type, l.target_id): l for l in repo.links_for_item(ts, iid)}
            assert ("ideas", human) in links and ("ideas", rejected) in links
            links[("ideas", human)].kind = "supporting"
            links[("ideas", rejected)].rejected_at = datetime.now(timezone.utc)
            ts.commit()
        # 本文を変えて再計算（distinctive トークンは維持）。
        app_info.update_info_item(account_id, company_id, str(iid),
                                  body=InfoUpdateRequest(body_html=f"<p>{_UNIQUE_TEXT}を再度検討する</p>"))
        with get_tenant_session(db_identifier) as ts:
            rows = repo.links_for_item(ts, iid)
            by = {(l.target_type, l.target_id): l for l in rows}
            # 重複行が増えていない（UNIQUE＝1組1行）。
            assert len(rows) == len({(l.target_type, l.target_id) for l in rows})
            assert by[("ideas", human)].kind == "supporting"          # 手動 kind は related に戻らない
            assert by[("ideas", rejected)].rejected_at is not None     # 棄却は復活しない
            assert by[("ideas", keep)].origin == "auto" and by[("ideas", keep)].score is not None  # score 更新
    finally:
        _cleanup(db_identifier, info_ids=info_ids, idea_ids=[keep, human, rejected], quest_id=qid, owner_id=owner)


def test_n_tc_152_threshold_and_top_n():
    """N-TC-152: 閾値未満は作らない＋新規 auto は上位 N で件数抑制。"""
    company_id, db_identifier, account_id = _ctx()
    hits = [uuid.uuid4() for _ in range(app_info._AUTO_LINK_TOP_N + 2)]  # 上限+2 の類似アイデア
    miss = uuid.uuid4()
    specs = [(i, _UNIQUE_TEXT) for i in hits] + [(miss, _UNRELATED_TEXT)]
    owner, qid = _seed_ideas(db_identifier, specs)
    info_ids: list[uuid.UUID] = []
    try:
        created = app_info.create_info_item(
            account_id, company_id,
            body=InfoCreateRequest(title="上限検証", body_html=f"<p>{_UNIQUE_TEXT}</p>"))
        info_ids.append(uuid.UUID(created["id"]))
        with get_tenant_session(db_identifier) as ts:
            links = repo.links_for_item(ts, info_ids[0])
        hit_links = [l for l in links if l.target_id in set(hits)]
        assert len(hit_links) == app_info._AUTO_LINK_TOP_N, "新規 auto は上位 N で頭打ち"
        assert all(l.target_id != miss for l in links), "閾値未満（無関係）は作らない"
    finally:
        _cleanup(db_identifier, info_ids=info_ids, idea_ids=hits + [miss], quest_id=qid, owner_id=owner)


def test_n_tc_153_reverse_trigger_creates_link():
    """N-TC-153: 成果物保存トリガ（逆方向）＝成果物側から既存情報へ auto リンク生成（無関係情報は除外）。"""
    company_id, db_identifier, account_id = _ctx()
    hit = app_info.create_info_item(account_id, company_id, body=InfoCreateRequest(title="逆方向hit", body_html=f"<p>{_UNIQUE_TEXT}</p>"))
    miss = app_info.create_info_item(account_id, company_id, body=InfoCreateRequest(title="逆方向miss", body_html=f"<p>{_UNRELATED_TEXT}</p>"))
    hit_id, miss_id = uuid.UUID(hit["id"]), uuid.UUID(miss["id"])
    idea = uuid.uuid4()
    owner, qid = _seed_ideas(db_identifier, [(idea, _UNIQUE_TEXT)])  # 情報作成後に seed＝forward では張られない
    try:
        with get_tenant_session(db_identifier) as ts:
            app_info.recompute_auto_links_for_target(ts, "ideas", idea)
            ts.commit()
        with get_tenant_session(db_identifier) as ts:
            links = {l.info_item_id: l for l in repo.links_for_target_all(ts, "ideas", idea)}
        assert hit_id in links and links[hit_id].origin == "auto" and links[hit_id].score is not None
        assert miss_id not in links, "無関係情報からは張らない"
    finally:
        _cleanup(db_identifier, info_ids=[hit_id, miss_id], idea_ids=[idea], quest_id=qid, owner_id=owner)


def test_n_tc_154_reverse_preserves_human_decisions():
    """N-TC-154: 逆方向の再計算も score のみ更新・手動 kind/棄却は保持（重複行なし）。"""
    from datetime import datetime, timezone
    company_id, db_identifier, account_id = _ctx()
    keep = app_info.create_info_item(account_id, company_id, body=InfoCreateRequest(title="逆keep", body_html=f"<p>{_UNIQUE_TEXT}</p>"))
    human = app_info.create_info_item(account_id, company_id, body=InfoCreateRequest(title="逆human", body_html=f"<p>{_UNIQUE_TEXT}</p>"))
    rej = app_info.create_info_item(account_id, company_id, body=InfoCreateRequest(title="逆rej", body_html=f"<p>{_UNIQUE_TEXT}</p>"))
    ids = {k: uuid.UUID(v["id"]) for k, v in {"keep": keep, "human": human, "rej": rej}.items()}
    idea = uuid.uuid4()
    owner, qid = _seed_ideas(db_identifier, [(idea, _UNIQUE_TEXT)])
    try:
        with get_tenant_session(db_identifier) as ts:
            app_info.recompute_auto_links_for_target(ts, "ideas", idea)
            ts.commit()
        with get_tenant_session(db_identifier) as ts:
            links = {l.info_item_id: l for l in repo.links_for_target_all(ts, "ideas", idea)}
            assert ids["human"] in links and ids["rej"] in links
            links[ids["human"]].kind = "supporting"
            links[ids["rej"]].rejected_at = datetime.now(timezone.utc)
            ts.commit()
        with get_tenant_session(db_identifier) as ts:
            app_info.recompute_auto_links_for_target(ts, "ideas", idea)
            ts.commit()
        with get_tenant_session(db_identifier) as ts:
            rows = repo.links_for_target_all(ts, "ideas", idea)
            by = {l.info_item_id: l for l in rows}
            assert len(rows) == len({l.info_item_id for l in rows})  # 重複なし
            assert by[ids["human"]].kind == "supporting"
            assert by[ids["rej"]].rejected_at is not None
            assert by[ids["keep"]].origin == "auto" and by[ids["keep"]].score is not None
    finally:
        _cleanup(db_identifier, info_ids=list(ids.values()), idea_ids=[idea], quest_id=qid, owner_id=owner)


def test_n_tc_155_reverse_noop_for_non_candidate():
    """N-TC-155: 候補外（下書きアイデア）は get_target_text=None＝リンクを作らない。"""
    company_id, db_identifier, account_id = _ctx()
    info = app_info.create_info_item(account_id, company_id, body=InfoCreateRequest(title="下書き対象", body_html=f"<p>{_UNIQUE_TEXT}</p>"))
    info_id = uuid.UUID(info["id"])
    draft = uuid.uuid4()
    owner, qid = _seed_ideas(db_identifier, [(draft, _UNIQUE_TEXT)], status="draft")
    try:
        with get_tenant_session(db_identifier) as ts:
            app_info.recompute_auto_links_for_target(ts, "ideas", draft)
            ts.commit()
        with get_tenant_session(db_identifier) as ts:
            links = repo.links_for_target_all(ts, "ideas", draft)
        assert links == [], "下書き（候補外）には自動リンクを作らない"
    finally:
        _cleanup(db_identifier, info_ids=[info_id], idea_ids=[draft], quest_id=qid, owner_id=owner)


def _set_company_threshold(company_id, value) -> None:
    """会社の一致率しきい値を直接設定（API 検証を経ず＝境界検証のため 1 超も可・テスト専用）。"""
    from decimal import Decimal
    with control_session() as s:
        s.get(Company, company_id).auto_link_threshold = Decimal(str(value))
        s.commit()


def test_n_tc_156_company_threshold_controls_auto_link():
    """N-TC-156: 会社別の一致率しきい値で auto-link の生成有無が変わる（§5.36b・Phase C・会社設定）。

    しきい値 1.5（cosine 上限 1.0 超＝全遮断）では類似アイデアでもリンクせず、0.0（全許容）ではリンクする。
    """
    company_id, db_identifier, account_id = _ctx()
    hit = uuid.uuid4()
    owner, qid = _seed_ideas(db_identifier, [(hit, _UNIQUE_TEXT)])
    info_ids: list[uuid.UUID] = []
    try:
        _set_company_threshold(company_id, "1.500")  # 全遮断
        c1 = app_info.create_info_item(account_id, company_id,
                                       body=InfoCreateRequest(title="厳しめ", body_html=f"<p>{_UNIQUE_TEXT}</p>"))
        info_ids.append(uuid.UUID(c1["id"]))
        with get_tenant_session(db_identifier) as ts:
            keys = {(l.target_type, l.target_id) for l in repo.links_for_item(ts, info_ids[0])}
        assert ("ideas", hit) not in keys, "しきい値 1.5＝どんな類似でも自動リンクしない"

        _set_company_threshold(company_id, "0.000")  # 全許容
        c2 = app_info.create_info_item(account_id, company_id,
                                       body=InfoCreateRequest(title="緩め", body_html=f"<p>{_UNIQUE_TEXT}</p>"))
        info_ids.append(uuid.UUID(c2["id"]))
        with get_tenant_session(db_identifier) as ts:
            keys = {(l.target_type, l.target_id) for l in repo.links_for_item(ts, info_ids[1])}
        assert ("ideas", hit) in keys, "しきい値 0.0＝わずかでも一致すれば自動リンクする"
    finally:
        _set_company_threshold(company_id, "0.120")  # 既定へ戻す（共有DB汚染防止）
        _cleanup(db_identifier, info_ids=info_ids, idea_ids=[hit], quest_id=qid, owner_id=owner)


def test_n_tc_157_forward_self_heal_persists_candidate_tokens():
    """N-TC-157: 前向き auto-link は未永続候補のトークンを自己修復で永続化する（§5.36b・都度抽出の撤廃）。"""
    company_id, db_identifier, account_id = _ctx()
    hit = uuid.uuid4()
    owner, qid = _seed_ideas(db_identifier, [(hit, _UNIQUE_TEXT)])  # 直接 insert＝entity_tokens 未永続
    info_ids: list[uuid.UUID] = []
    try:
        with get_tenant_session(db_identifier) as ts:
            assert tokens_repo.tokens_for(ts, "idea", hit) == [], "初期は候補アイデアのトークン未永続"
        created = app_info.create_info_item(account_id, company_id,
                                            body=InfoCreateRequest(title="自己修復", body_html=f"<p>{_UNIQUE_TEXT}</p>"))
        info_ids.append(uuid.UUID(created["id"]))
        with get_tenant_session(db_identifier) as ts:
            assert tokens_repo.tokens_for(ts, "idea", hit), "前向きが候補アイデアのトークンを自己修復で永続化する"
    finally:
        _cleanup(db_identifier, info_ids=info_ids, idea_ids=[hit], quest_id=qid, owner_id=owner)
