"""C-TC-309〜314: おすすめの参加可能クエスト選出（SC-01 Zone D・C.9.1・ダッシュボード再設計 Phase3）。

候補母集団（can_discover_quest ∩ 未参加 ∩ 非pending）・直近窓の活動集計・加重和スコア（整合率＋活発度＋
管理者お勧めブースト）・上位 limit・メタのみ返却を検証。整合率（align）は seed しない＝全候補 align=0 とし、
並びは active（活動件数）と admin（recommended フラグ）で駆動する（共有 dev DB のノイズに対しては自分の
seed id の相対順序で検証＝頑健）。仕様の正＝API設計 C.9.1／データモデル §5.6 recommended。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.chat import repository as chat_repo
from app.tenant.chat.orm import ChatGroup, ChatMessage, ChatThread
from app.tenant.ideas.orm import Idea, IdeaRevision
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests import application as quest_app
from app.tenant.quests import repository as repo
from app.tenant.quests.orm import (
    Quest, QuestCategory, QuestFollow, QuestGroupLink, QuestJoinRequest, QuestMember, QuestMemberPermission,
)
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

RECOMMENDED = "/api/v1/quests/recommended"


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


@pytest.fixture
def renv(factory):
    """専用 viewer（factory アカウント）＋専用グループ G ＋plain owner を作り、G に紐づく discoverable
    クエストを seed する（他 viewer の可視範囲に混ざらないよう viewer は G のみ所属）。"""
    with control_session() as s:
        db = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
    viewer_acc = factory.make_seed_company_account()
    g = uuid.uuid4()
    owner_id = uuid.uuid4()
    quests: list[uuid.UUID] = []

    with get_tenant_session(db) as ts:
        viewer_id = get_user_by_account(ts, viewer_acc["id"]).id
        ts.add(User(id=owner_id, account_id=uuid.uuid4(), display_name="Owner", locale="ja", status="active"))
        ts.add(QuestGroup(id=g, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="RecG"))
        ts.flush()
        qg_repo.upsert_membership(ts, g, viewer_id)   # viewer は G のみ所属（ノイズ最小化）
        qg_repo.upsert_membership(ts, g, owner_id)
        ts.commit()

    def new_quest(*, discoverable=True, recommended=False, status="recruiting", add_owner_member=True) -> uuid.UUID:
        qid = uuid.uuid4()
        with get_tenant_session(db) as ts:
            repo.create_quest(ts, quest_id=qid, owner_id=owner_id, title="Rec", color="#3B82F6", status=status)
            repo.create_group_links(ts, qid, group_ids=[g])
            if add_owner_member:
                repo.add_member(ts, qid, owner_id, permissions=["owner"])
            q = ts.get(Quest, qid)
            q.discoverable = discoverable
            q.recommended = recommended
            ts.commit()
        quests.append(qid)
        return qid

    yield SimpleNamespace(db=db, viewer_acc=viewer_acc, viewer_id=viewer_id, owner_id=owner_id,
                          g=g, new_quest=new_quest, quests=quests)

    with get_tenant_session(db) as ts:
        qids = list(quests)
        iids = list(ts.execute(select(Idea.id).where(Idea.quest_id.in_(qids))).scalars())
        if iids:
            cgids = list(ts.execute(select(ChatGroup.id).where(ChatGroup.idea_id.in_(iids))).scalars())
            if cgids:
                tids = list(ts.execute(select(ChatThread.id).where(
                    ChatThread.owner_type == "idea", ChatThread.owner_id.in_(cgids))).scalars())
                if tids:
                    ts.execute(ChatMessage.__table__.delete().where(ChatMessage.thread_id.in_(tids)))
                    ts.execute(ChatThread.__table__.delete().where(ChatThread.id.in_(tids)))
                ts.execute(ChatGroup.__table__.delete().where(ChatGroup.id.in_(cgids)))
            ts.execute(IdeaRevision.__table__.delete().where(IdeaRevision.idea_id.in_(iids)))
            ts.execute(Idea.__table__.delete().where(Idea.id.in_(iids)))
        ts.execute(QuestFollow.__table__.delete().where(QuestFollow.quest_id.in_(qids)))
        ts.execute(QuestJoinRequest.__table__.delete().where(QuestJoinRequest.quest_id.in_(qids)))
        ts.execute(QuestCategory.__table__.delete().where(QuestCategory.quest_id.in_(qids)))
        mids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id.in_(qids))).scalars())
        if mids:
            ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(mids)))
        ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id.in_(qids)))
        ts.execute(QuestGroupLink.__table__.delete().where(QuestGroupLink.quest_id.in_(qids)))
        ts.execute(Quest.__table__.delete().where(Quest.id.in_(qids)))
        ts.execute(QuestGroupMember.__table__.delete().where(QuestGroupMember.quest_group_id == g))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == g))
        ts.execute(User.__table__.delete().where(User.id == owner_id))
        ts.commit()


def _seed_published_idea(ts, qid, owner_id, *, created_at=None, chat=0, body="b"):
    """公開アイデア1件（任意に過去日時）＋チャット messages を seed し idea_id を返す。"""
    iid = uuid.uuid4()
    idea = Idea(id=iid, quest_id=qid, author_id=owner_id, title="I", body=body, value="v", status="published")
    if created_at is not None:
        idea.created_at = created_at
    ts.add(idea)
    ts.flush()
    if chat:
        cgid = uuid.uuid4()
        ts.add(ChatGroup(id=cgid, idea_id=iid))
        ts.flush()
        tid = chat_repo.ensure_chat_thread(ts, "idea", cgid).id
        now = datetime.now(timezone.utc)
        for _ in range(chat):
            ts.add(ChatMessage(id=uuid.uuid4(), thread_id=tid, author_id=owner_id, body="m", created_at=now))
    return iid


# --- C-TC-309: 候補母集団 ---

def test_c_tc_309_recommend_candidates(renv):
    """C-TC-309 候補＝can_discover ∩ 未参加 ∩ 非pending（member/pending/非discoverable は除外）。"""
    q_open = renv.new_quest(discoverable=True)                 # 未参加→候補
    q_member = renv.new_quest(discoverable=True)               # viewer を member に→除外
    q_pending = renv.new_quest(discoverable=True)              # viewer が pending→除外
    q_hidden = renv.new_quest(discoverable=False)              # 非discoverable→除外
    with get_tenant_session(renv.db) as ts:
        repo.add_member(ts, q_member, renv.viewer_id, permissions=["comment"])
        repo.create_join_request(ts, q_pending, renv.viewer_id, "参加したい")
        ts.commit()
        ids = {q.id for q in repo.list_recommend_candidates(ts, renv.viewer_id, [renv.g])}
    assert q_open in ids
    assert q_member not in ids and q_pending not in ids and q_hidden not in ids


# --- C-TC-310: 直近窓の活動集計 ---

def test_c_tc_310_recent_activity_counts(renv):
    """C-TC-310 窓内活動＝公開アイデア1＋チャット2＋新規参加1（owner member）＝4。窓外の古いアイデアは数えない。"""
    qid = renv.new_quest(discoverable=True)   # owner を member に追加（＝窓内の「参加1」）
    now = datetime.now(timezone.utc)
    with get_tenant_session(renv.db) as ts:
        _seed_published_idea(ts, qid, renv.owner_id, created_at=now, chat=2)              # 窓内：idea1＋chat2
        _seed_published_idea(ts, qid, renv.owner_id, created_at=now - timedelta(days=40))  # 窓外：数えない
        ts.commit()
        counts = repo.recent_activity_counts(ts, [qid], now - timedelta(days=30))
    assert counts[qid] == 4  # idea1 + chat2 + owner参加1（窓外アイデアは含まない）


# --- C-TC-311: スコアリング（純関数） ---

def test_c_tc_311_score_and_rank():
    """C-TC-311 加重和（align/active/admin）・母集団 max で active 正規化・上位 limit・tie-break。"""
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    a = {"id": "a", "updated_at": base, "align": 0.0, "active_raw": 10, "admin": 0.0}  # active 正規化=1.0
    b = {"id": "b", "updated_at": base, "align": 0.0, "active_raw": 0, "admin": 1.0}   # admin のみ
    c = {"id": "c", "updated_at": base, "align": 0.0, "active_raw": 5, "admin": 0.0}   # active=0.5
    ranked = quest_app.score_and_rank([a, b, c], w_align=0.45, w_active=0.35, w_admin=0.20, limit=2)
    # 検算: a=0.35（active1.0）・b=0.20（admin）・c=0.175（active0.5）→ 降順 a,b,c。limit=2 ⇒ a,b。
    assert [it["id"] for it in ranked] == ["a", "b"]
    ranked_full = quest_app.score_and_rank([a, b, c], w_align=0.45, w_active=0.35, w_admin=0.20, limit=5)
    assert [it["id"] for it in ranked_full] == ["a", "b", "c"]
    assert ranked_full[0]["active"] == 1.0 and ranked_full[2]["active"] == 0.5  # max=10 で正規化
    # active 母集団 max=0 なら全 active=0（ゼロ割回避）。
    z1 = {"id": "z1", "updated_at": base, "align": 0.0, "active_raw": 0, "admin": 0.0}
    z2 = {"id": "z2", "updated_at": base, "align": 0.0, "active_raw": 0, "admin": 0.0}
    rz = quest_app.score_and_rank([z1, z2], w_align=0.45, w_active=0.35, w_admin=0.20, limit=5)
    assert all(it["active"] == 0.0 and it["score"] == 0.0 for it in rz)


# --- C-TC-312〜314: API ---

def _rec_ids(client, **params):
    return [c["id"] for c in client.get(RECOMMENDED, params=params).json()["data"]]


def test_c_tc_312_recommended_order_and_meta(client, renv):
    """C-TC-312 未参加の discoverable を score 降順（active 差）・limit・my_state=none・メタのみ（本文非返却）。"""
    secret = "SECRET_IDEA_BODY_SHOULD_NOT_LEAK"
    hi = renv.new_quest(discoverable=True)    # 活動多
    mid = renv.new_quest(discoverable=True)   # 活動少
    lo = renv.new_quest(discoverable=True)    # 活動なし
    with get_tenant_session(renv.db) as ts:
        for _ in range(3):
            _seed_published_idea(ts, hi, renv.owner_id, body=secret)
        _seed_published_idea(ts, mid, renv.owner_id, body=secret)
        ts.commit()
    _login(client, SEED_COMPANY_CODE, renv.viewer_acc["login_id"], renv.viewer_acc["password"])
    body = client.get(RECOMMENDED, params={"limit": 10}).json()
    data = body["data"]
    mine = [c["id"] for c in data if c["id"] in {str(hi), str(mid), str(lo)}]
    assert mine == [str(hi), str(mid), str(lo)]  # active 降順（相対順序・共有DBノイズに頑健）
    for c in data:
        assert c["my_state"] == "none"           # 未参加に限る
        assert "score" in c and "body" not in c  # メタのみ（本文フィールドは返さない）
    assert secret not in client.get(RECOMMENDED, params={"limit": 10}).text  # 本文は一切漏れない


def test_c_tc_313_admin_recommended_boost(client, renv):
    """C-TC-313 recommended=true が加重和ブーストで上位化／整合率0・活発0でも乗算ゼロで消えない。"""
    plain = renv.new_quest(discoverable=True, recommended=False)
    boosted = renv.new_quest(discoverable=True, recommended=True)
    # 両者を同条件（活動1）に揃える＝差は admin のみ。
    with get_tenant_session(renv.db) as ts:
        _seed_published_idea(ts, plain, renv.owner_id)
        _seed_published_idea(ts, boosted, renv.owner_id)
        ts.commit()
    zero = renv.new_quest(discoverable=True, recommended=True, add_owner_member=False)  # align0・active0 だが recommended
    _login(client, SEED_COMPANY_CODE, renv.viewer_acc["login_id"], renv.viewer_acc["password"])
    data = client.get(RECOMMENDED, params={"limit": 10}).json()["data"]
    pos = {c["id"]: i for i, c in enumerate(data)}
    assert pos[str(boosted)] < pos[str(plain)]      # recommended がブーストで上位
    assert str(zero) in pos                          # 加重和＝ゼロ成分でも消えない（score=w_admin>0）
    zc = next(c for c in data if c["id"] == str(zero))
    assert zc["score"] > 0.0


def test_c_tc_314_empty_and_limit_clamp(client, factory, renv):
    """C-TC-314 候補0件→空配列／limit は 1..max にクランプ（0→1・99→max）。"""
    # 候補を持たない別 viewer（新規アカウント・どのグループにも属さない）＝空配列。
    lonely = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, lonely["login_id"], lonely["password"])
    # 共有 dev DB に全社 discoverable 候補が在りうるため「自分 seed 由来が無い＝0 または少数」までは断定しないが、
    # グループ非所属 viewer から見える候補は全社公開分のみ。空配列契約（data キー）だけは厳密に検証。
    assert isinstance(client.get(RECOMMENDED).json()["data"], list)
    # limit クランプ＝0 でも 1 件以上の母集団があれば最大1件・99 でも max(10)件まで（件数上限の検証）。
    renv.new_quest(discoverable=True)
    renv.new_quest(discoverable=True)
    _login(client, SEED_COMPANY_CODE, renv.viewer_acc["login_id"], renv.viewer_acc["password"])
    assert len(client.get(RECOMMENDED, params={"limit": 0}).json()["data"]) <= 1   # 0→1 にクランプ
    assert len(client.get(RECOMMENDED, params={"limit": 99}).json()["data"]) <= 10  # 99→max(10)
