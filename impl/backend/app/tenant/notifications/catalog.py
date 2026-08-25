"""通知メッセージカタログ＝取得時レンダリング（§8-⑳・H.2）。

`body` を発火時に確定せず、受信者ロケール（現状 ja のみ実装・en は将来）でテンプレ＋`params`＋`ref_*` 解決から
組み立てる。ref から辿れる値（idea 件名・実績名・魔法名）は都度解決、辿れない/変わりうる値は `params` に凍結。
`security_*`（本文のみ）は本スライス未結線（テナント系フル・cross-plane は follow-up）だが本文テンプレは用意する。
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.tenant.achievements.orm import Achievement
from app.tenant.chat.orm import Spell
from app.tenant.ideas.orm import Idea
from app.tenant.notifications.orm import Notification
from app.tenant.quests.orm import Quest

TIER_LABEL_JA = {"bronze": "ブロンズ", "silver": "シルバー", "gold": "ゴールド"}

# 種別→アイコン（画面の presentation ヒント。フロントは type から独自に引いてもよい）。
ICON = {
    "mention": "@", "idea_comment": "💬", "follow_comment": "💬",
    "follow_evaluation": "⭐", "follow_selection": "🏆", "idea_updated": "🔄",
    "magic_reaction": "✨", "achievement": "🎖️", "quest_party_invited": "🎯",
    "security_new_device": "🛡️", "security_password_changed": "🔑",
}


def _idea_title(session: Session, idea_id: uuid.UUID | None) -> str:
    if idea_id is None:
        return ""
    idea = session.get(Idea, idea_id)
    return idea.title if idea else "（削除されたアイデア）"


def _quest_context(session: Session, idea_id: uuid.UUID | None, quest_id: uuid.UUID | None = None) -> str | None:
    """文脈行（SC-02 の副題）＝「クエスト「x」/ アイデア「y」」。"""
    idea = session.get(Idea, idea_id) if idea_id else None
    qid = quest_id or (idea.quest_id if idea else None)
    quest = session.get(Quest, qid) if qid else None
    parts = []
    if quest:
        parts.append(f"クエスト「{quest.title}」")
    if idea:
        parts.append(f"アイデア「{idea.title}」")
    return " / ".join(parts) or None


def _spell_name(session: Session, params: dict) -> str:
    """魔法名は識別子（spell_id/code）から取得時に解決（H.1・表示名は凍結しない）。"""
    sid = params.get("spell_id")
    if sid:
        sp = session.get(Spell, uuid.UUID(sid) if isinstance(sid, str) else sid)
        if sp:
            return sp.name_ja
    code = params.get("spell")
    if code:
        sp = session.query(Spell).filter(Spell.code == code).first()
        if sp:
            return sp.name_ja
    return "魔法"


def render(session: Session, n: Notification) -> dict:
    """1通知の表示要素（body/context/tag/meta）を取得時レンダリング。ja 固定（en は将来）。"""
    p = n.params or {}
    actor = p.get("actor_name") or "誰か"
    t = n.type
    body: str
    context: str | None = None
    tag: str | None = None
    meta: dict | None = None

    if t == "mention":
        body = f"{actor} さんがチャットであなたをメンションしました"
        context = _quest_context(session, n.ref_idea_id)
    elif t == "idea_comment":
        body = f"あなたのアイデア「{_idea_title(session, n.ref_idea_id)}」に新しいコメントがつきました"
        context = _quest_context(session, n.ref_idea_id)
    elif t == "follow_comment":
        body = f"フォロー中のアイデア「{_idea_title(session, n.ref_idea_id)}」に新しいコメントがつきました"
        context = _quest_context(session, n.ref_idea_id)
    elif t == "follow_evaluation":
        body = f"フォロー中のアイデア「{_idea_title(session, n.ref_idea_id)}」に新しい評価がつきました"
        context = _quest_context(session, n.ref_idea_id)
    elif t == "follow_selection":
        body = f"フォロー中のアイデア「{_idea_title(session, n.ref_idea_id)}」が選定されました"
        context = _quest_context(session, n.ref_idea_id)
    elif t == "idea_updated":
        rev = p.get("revision")
        rev_s = f"（版{rev}）" if rev else ""
        body = f"投票/フォロー中のアイデア「{_idea_title(session, n.ref_idea_id)}」が更新されました{rev_s}。差分を確認して投票を見直せます"
        context = _quest_context(session, n.ref_idea_id)
        tag = "投票の見直し"
    elif t == "magic_reaction":
        body = f"{actor} さんがあなたのメッセージに {_spell_name(session, p)} の魔法を付けました"
        context = _quest_context(session, n.ref_idea_id)
    elif t == "achievement":
        ach = session.get(Achievement, n.ref_achievement_id) if n.ref_achievement_id else None
        name = ach.name_ja if ach else "実績"
        tier = (ach.tier if ach else p.get("tier")) or ""
        tier_s = f"（{TIER_LABEL_JA.get(tier, tier)}）" if tier else ""
        body = f"実績「{name}」{tier_s}を獲得しました"
        coin = p.get("coin", ach.coin_reward if ach else 0)
        if coin:
            meta = {"coin": coin}
    elif t == "quest_party_invited":
        quest = session.get(Quest, n.ref_quest_id) if n.ref_quest_id else None
        qt = quest.title if quest else "（削除されたクエスト）"
        body = f"{actor} さんがクエスト「{qt}」に招集しました"
        context = f"クエスト「{qt}」"
    elif t == "security_new_device":
        body = "新しい端末からログインがありました"
        at, ip, dev = p.get("at"), p.get("ip"), p.get("device")
        context = " ・ ".join([x for x in (at, f"IP {ip}" if ip else None, dev) if x]) or None
        tag = "セキュリティ"
    elif t == "security_password_changed":
        body = "パスワードが変更されました。心当たりがなければ管理者に連絡してください"
        context = "メールでもお知らせしています"
        tag = "セキュリティ"
    else:
        body = n.body or "通知"

    return {"body": body, "context": context, "tag": tag, "meta": meta, "icon": ICON.get(t)}
