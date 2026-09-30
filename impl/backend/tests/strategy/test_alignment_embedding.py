"""意味的一致（embedding/hybrid・A-2・FR-44）＝会社別方式・埋め込み永続化・差分コイン付与（doc/テスト/R_経営資料.md §2）。

テストは FakeEmbeddings（conftest autouse・同義語クラスタで意味近接を決定的に再現・外部未接続）。
「語は重ならないが意味が近い」ペア＝idea=太陽光/パネル・doc=脱炭素/再エネ（いずれも FakeEmbeddings で
再生可能エネルギークラスタへ寄る）＝keyword cosine は 0、embedding は高い、を利用する。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.gamification.orm import Activity
from app.tenant.ideas.orm import Idea
from app.tenant.info import application as info_app
from app.tenant.profile.orm import User
from app.tenant.quests.orm import Quest
from app.tenant.strategy import alignment as strat_align
from app.tenant.strategy import application as strategy_app
from app.tenant.strategy import similarity
from app.tenant.strategy.orm import IdeaAlignment, QuestStrategyDocument, StrategyDocument
from app.tenant.tokens import repository as tokens_repo
from app.tenant.tokens.orm import EntityEmbedding, EntityToken
from tests.conftest import SEED_COMPANY_CODE

# FakeEmbeddings で同義クラスタに寄る「意味は近いが語は重ならない」ペア。
_IDEA_TEXT = "太陽光 パネル"
_DOC_TEXT = "脱炭素 再エネ"


def _seed_db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _seed_pair(ts, *, owner, qid, iid, did, link=True, idea_emb=True, doc_emb=True):
    """意味ペア（keyword 重なり0・embedding 高）を1組シード。entity_tokens＋（任意で）entity_embeddings。"""
    ts.add(User(id=owner, account_id=uuid.uuid4(), display_name="意味test作者", locale="ja", status="active"))
    ts.flush()
    ts.add(Quest(id=qid, owner_id=owner, title="意味testクエスト", color="#0D9488", status="recruiting"))
    ts.add(StrategyDocument(id=did, title="脱炭素方針", doc_kind="policy", created_by_id=owner,
                            body_text=_DOC_TEXT, status="active"))
    ts.flush()
    ts.add(Idea(id=iid, quest_id=qid, author_id=owner, title="太陽光アイデア", body="本文", value="v", status="published"))
    if link:
        ts.add(QuestStrategyDocument(id=uuid.uuid4(), quest_id=qid, strategy_document_id=did))
    # keyword トークン＝重なりゼロ（idea と doc で別語）。
    ts.add(EntityToken(owner_type="idea", owner_id=iid, token="太陽光", count=1))
    ts.add(EntityToken(owner_type="idea", owner_id=iid, token="パネル", count=1))
    ts.add(EntityToken(owner_type="strategy_doc", owner_id=did, token="脱炭素", count=1))
    ts.add(EntityToken(owner_type="strategy_doc", owner_id=did, token="再エネ", count=1))
    # 埋め込み（FakeEmbeddings 経由・意味近接）。
    if idea_emb:
        info_app.persist_entity_embedding(ts, "idea", iid, _IDEA_TEXT)
    if doc_emb:
        info_app.persist_entity_embedding(ts, "strategy_doc", did, _DOC_TEXT)


def _cleanup(db, *, owner, qid, iid, did):
    with get_tenant_session(db) as ts:
        ts.execute(IdeaAlignment.__table__.delete().where(IdeaAlignment.idea_id == iid))
        ts.execute(EntityToken.__table__.delete().where(EntityToken.owner_id.in_([iid, did])))
        ts.execute(EntityEmbedding.__table__.delete().where(EntityEmbedding.owner_id.in_([iid, did])))
        ts.execute(QuestStrategyDocument.__table__.delete().where(QuestStrategyDocument.quest_id == qid))
        ts.execute(Activity.__table__.delete().where(Activity.user_id == owner))
        ts.execute(Idea.__table__.delete().where(Idea.id == iid))
        ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id == did))
        ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(User.__table__.delete().where(User.id == owner))
        ts.commit()


def test_r_tc_202_embedding_beats_keyword_on_semantic_pair():
    """R-TC-202 意味方式は「語が重ならないが意味が近い」ペアで keyword より高い（embedding>hybrid>keyword）。"""
    db = _seed_db()
    owner, qid, iid, did = (uuid.uuid4() for _ in range(4))
    try:
        with get_tenant_session(db) as ts:
            _seed_pair(ts, owner=owner, qid=qid, iid=iid, did=did)
            ts.commit()
        with get_tenant_session(db) as ts:
            idea_toks = tokens_repo.tokens_for(ts, "idea", iid)
            doc_toks = tokens_repo.tokens_for(ts, "strategy_doc", did)
            kw = similarity.KeywordProvider().score(ts, idea_id=iid, idea_tokens=idea_toks, doc_id=did, doc_tokens=doc_toks)
            emb = similarity.EmbeddingProvider().score(ts, idea_id=iid, idea_tokens=idea_toks, doc_id=did, doc_tokens=doc_toks)
            hyb = similarity.HybridProvider().score(ts, idea_id=iid, idea_tokens=idea_toks, doc_id=did, doc_tokens=doc_toks)
            assert kw < 0.01, f"語が重ならない＝keyword≈0（{kw}）"
            assert emb > 0.5, f"意味が近い＝embedding 高（{emb}）"
            assert kw < hyb < emb, f"hybrid は両者の中間（kw={kw} hyb={hyb} emb={emb}）"
    finally:
        _cleanup(db, owner=owner, qid=qid, iid=iid, did=did)


def test_r_tc_203_method_switch_and_fallback():
    """R-TC-203 会社設定で provider が切替わる／埋め込み欠損はキーワードへフォールバック（例外なく算出）。"""
    db = _seed_db()
    owner, qid, iid, did = (uuid.uuid4() for _ in range(4))
    try:
        # doc 側の埋め込みを作らない＝欠損。
        with get_tenant_session(db) as ts:
            _seed_pair(ts, owner=owner, qid=qid, iid=iid, did=did, doc_emb=False)
            ts.commit()
        assert isinstance(similarity.provider_for("embedding"), similarity.EmbeddingProvider)
        assert isinstance(similarity.provider_for("hybrid"), similarity.HybridProvider)
        assert isinstance(similarity.provider_for(None), similarity.KeywordProvider)
        with get_tenant_session(db) as ts:
            idea = ts.get(Idea, iid)
            company = SimpleNamespace(alignment_method="embedding")
            best = strat_align.recompute_for_idea(ts, idea, company=company, award=False)
            ts.commit()
            # 埋め込み欠損＝keyword 相当（重なり0）＝best≈0。例外なく算出され method は選択方式を記録。
            assert best < 0.01, f"埋め込み欠損は keyword フォールバック（{best}）"
        with get_tenant_session(db) as ts:
            row = ts.execute(IdeaAlignment.__table__.select().where(IdeaAlignment.idea_id == iid)).first()
            assert row is not None and row.method == "embedding"
    finally:
        _cleanup(db, owner=owner, qid=qid, iid=iid, did=did)


def test_r_tc_204_persist_embedding_row():
    """R-TC-204 埋め込み永続化＝entity_embeddings が model/dim 付きで1行生成・再呼び出しで upsert（重複しない）。"""
    db = _seed_db()
    oid = uuid.uuid4()
    from app.infra.llm import embeddings as emb_mod
    try:
        with get_tenant_session(db) as ts:
            info_app.persist_entity_embedding(ts, "idea", oid, _IDEA_TEXT)
            info_app.persist_entity_embedding(ts, "idea", oid, _IDEA_TEXT)  # 2回目＝upsert
            ts.commit()
        with get_tenant_session(db) as ts:
            rows = ts.execute(EntityEmbedding.__table__.select().where(EntityEmbedding.owner_id == oid)).all()
            assert len(rows) == 1, "upsert＝1行"
            r = rows[0]
            assert r.model == emb_mod.FakeEmbeddings().model
            assert r.dim == len(r.vector) > 0
            vec = tokens_repo.embedding_for(ts, "idea", oid, model=r.model)
            assert vec is not None and len(vec) == r.dim
            # モデル不一致は None（差し替え検出＝再計算を促す）。
            assert tokens_repo.embedding_for(ts, "idea", oid, model="other-model") is None
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(EntityEmbedding.__table__.delete().where(EntityEmbedding.owner_id == oid))
            ts.commit()


def test_r_tc_207_rescale_maps_compressed_cosine_to_alignment_rate():
    """R-TC-207 埋め込み cosine→整合率の線形リスケール（bge-m3 校正）＝floor→0・ceil→1・中点→0.5・範囲外クランプ。

    既定 floor/ceil（config）では無関係域（≈far 中央 0.44）は 0 ティア・意味近域（≈near 上位 0.60）は最上位ティアへ。
    生 cosine のままだと bge-m3 は分布が圧縮して 0.70/0.90 ティアが死ぬ（実測 2026-09-30）ことへの回帰。
    """
    from app.core.config import get_settings
    from app.tenant.strategy import alignment as al
    from app.tenant.strategy import similarity as sim

    s = get_settings()
    lo, hi = s.alignment_embed_score_floor, s.alignment_embed_score_ceil
    assert sim._rescale(lo) == 0.0
    assert sim._rescale(hi) == 1.0
    assert abs(sim._rescale((lo + hi) / 2) - 0.5) < 1e-9
    assert sim._rescale(lo - 0.1) == 0.0  # クランプ下限
    assert sim._rescale(hi + 0.1) == 1.0  # クランプ上限
    # 既定校正では far 中央→コイン0・near 上位→+15（上位ティアが生き返る）。0.60 は +15 境界(0.90)ちょうど
    # なので、観測 near 上位域の 0.605 で判定（生 cosine では絶対に届かない上位ティアへ乗ることを示す）。
    assert al.coins_for(sim._rescale(0.44)) == 0
    assert al.coins_for(sim._rescale(0.605)) == 15


def test_r_tc_208_embedding_score_is_rescaled_into_alignment_rate():
    """R-TC-208 EmbeddingProvider は生 cosine でなくリスケール後(0..1)を返す＝圧縮分布でも上位ティアに届く。"""
    from app.tenant.strategy import alignment as al

    db = _seed_db()
    owner, qid, iid, did = (uuid.uuid4() for _ in range(4))
    try:
        with get_tenant_session(db) as ts:
            _seed_pair(ts, owner=owner, qid=qid, iid=iid, did=did, idea_emb=False, doc_emb=False)
            # cosine=0.60 になる 2 ベクトルを直接 upsert（conftest の FakeEmbeddings.model='fake-embed' で読める）。
            model = "fake-embed"
            tokens_repo.upsert_embedding(ts, "idea", iid, model=model, vector=[1.0, 0.0])
            tokens_repo.upsert_embedding(ts, "strategy_doc", did, model=model, vector=[0.6, 0.8])  # cos=0.6
            ts.commit()
        with get_tenant_session(db) as ts:
            raw = 0.6
            score = similarity.EmbeddingProvider().score(
                ts, idea_id=iid, idea_tokens=[], doc_id=did, doc_tokens=[])
            assert abs(score - similarity._rescale(raw)) < 1e-6, f"リスケール後を返す（{score}）"
            assert score > raw, f"圧縮分布を引き伸ばす（rescaled {score} > raw {raw}）"
            # 生値 0.60 は +3 止まり／リスケール後は上位ティアへ（校正の効果）。
            assert al.coins_for(raw) == 3 and al.coins_for(score) > 3
    finally:
        _cleanup(db, owner=owner, qid=qid, iid=iid, did=did)


def test_r_tc_205_method_change_recompute_and_differential_coin():
    """R-TC-205 会社の方式変更で全再計算＋差分コイン付与（keyword=0→embedding で付与・冪等・下げない）。"""
    db = _seed_db()
    owner, qid, iid, did = (uuid.uuid4() for _ in range(4))
    try:
        with get_tenant_session(db) as ts:
            _seed_pair(ts, owner=owner, qid=qid, iid=iid, did=did)
            ts.commit()
        # keyword＝重なり0＝コインなし。
        strategy_app.recompute_all_for_company(SimpleNamespace(db_identifier=db, alignment_method="keyword"))
        with get_tenant_session(db) as ts:
            payload = strat_align.alignment_payload(ts, ts.get(Idea, iid))
            assert payload is not None and payload["coins_awarded"] == 0, "keyword は best≈0＝コイン0"
        # embedding へ変更＝best 高＝差分付与。
        strategy_app.recompute_all_for_company(SimpleNamespace(db_identifier=db, alignment_method="embedding"))
        with get_tenant_session(db) as ts:
            payload = strat_align.alignment_payload(ts, ts.get(Idea, iid))
            assert payload["best_score"] > 0.5 and payload["coins_awarded"] > 0, "embedding で整合↑＝差分付与"
        # 再々実行しても増えない（初回超えのみ・冪等）。
        strategy_app.recompute_all_for_company(SimpleNamespace(db_identifier=db, alignment_method="embedding"))
        with get_tenant_session(db) as ts:
            coins = ts.execute(
                Activity.__table__.select().where(Activity.user_id == owner, Activity.reason == "idea_alignment")
            ).all()
            assert len(coins) == 1, "コインは初回超えのみ（冪等）"
    finally:
        _cleanup(db, owner=owner, qid=qid, iid=iid, did=did)
