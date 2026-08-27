"""通知メッセージカタログ＝取得時レンダリング（§8-⑳・H.2）。

`body` を発火時に確定せず、受信者ロケール（`ja`/`en`・源泉＝`users.locale`＝accounts のミラー §4.6・§2.1 i18n）で
テンプレ＋`params`＋`ref_*` 解決から組み立てる。ref から辿れる値（実績名・魔法名）は都度解決＝locale 連動（`name_en`）、
辿れない/変わりうる値は `params` に凍結。**アイデア/クエストの題名は UGC のため非翻訳**（原文のまま・§2.1）。
未設定/不明ロケールは `ja` にフォールバック。
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
TIER_LABEL_EN = {"bronze": "Bronze", "silver": "Silver", "gold": "Gold"}

# 種別→アイコン（画面の presentation ヒント。フロントは type から独自に引いてもよい）。
ICON = {
    "mention": "@", "idea_comment": "💬", "follow_comment": "💬",
    "follow_evaluation": "⭐", "follow_selection": "🏆", "idea_updated": "🔄",
    "magic_reaction": "✨", "achievement": "🎖️", "quest_party_invited": "🎯",
    "security_new_device": "🛡️", "security_password_changed": "🔑",
}


def _idea_title(session: Session, idea_id: uuid.UUID | None, en: bool) -> str:
    if idea_id is None:
        return ""
    idea = session.get(Idea, idea_id)
    if idea:
        return idea.title  # UGC＝非翻訳（§2.1）
    return "(deleted idea)" if en else "（削除されたアイデア）"


def _quest_context(session: Session, idea_id: uuid.UUID | None, en: bool,
                   quest_id: uuid.UUID | None = None) -> str | None:
    """文脈行（SC-02 の副題）＝「クエスト「x」/ アイデア「y」」。題名は UGC で非翻訳・ラベルのみ locale 連動。"""
    idea = session.get(Idea, idea_id) if idea_id else None
    qid = quest_id or (idea.quest_id if idea else None)
    quest = session.get(Quest, qid) if qid else None
    parts = []
    if quest:
        parts.append(f'Quest "{quest.title}"' if en else f"クエスト「{quest.title}」")
    if idea:
        parts.append(f'Idea "{idea.title}"' if en else f"アイデア「{idea.title}」")
    return " / ".join(parts) or None


def _spell_name(session: Session, params: dict, en: bool) -> str:
    """魔法名は識別子（spell_id/code）から取得時に解決（H.1・表示名は凍結しない）＝locale 連動。"""
    sid = params.get("spell_id")
    if sid:
        sp = session.get(Spell, uuid.UUID(sid) if isinstance(sid, str) else sid)
        if sp:
            return sp.name_en if en else sp.name_ja
    code = params.get("spell")
    if code:
        sp = session.query(Spell).filter(Spell.code == code).first()
        if sp:
            return sp.name_en if en else sp.name_ja
    return "spell" if en else "魔法"


def render(session: Session, n: Notification, locale: str | None = None) -> dict:
    """1通知の表示要素（body/context/tag/meta）を取得時レンダリング（locale で JA/EN・既定 ja）。"""
    en = locale == "en"  # 既定 ja（未設定/不明は ja）
    p = n.params or {}
    actor = p.get("actor_name") or ("Someone" if en else "誰か")
    t = n.type
    body: str
    context: str | None = None
    tag: str | None = None
    meta: dict | None = None

    if t == "mention":
        body = f"{actor} mentioned you in chat" if en else f"{actor} さんがチャットであなたをメンションしました"
        context = _quest_context(session, n.ref_idea_id, en)
    elif t == "idea_comment":
        title = _idea_title(session, n.ref_idea_id, en)
        body = (f'A new comment was added to your idea "{title}"' if en
                else f"あなたのアイデア「{title}」に新しいコメントがつきました")
        context = _quest_context(session, n.ref_idea_id, en)
    elif t == "follow_comment":
        title = _idea_title(session, n.ref_idea_id, en)
        body = (f'A new comment was added to an idea you follow "{title}"' if en
                else f"フォロー中のアイデア「{title}」に新しいコメントがつきました")
        context = _quest_context(session, n.ref_idea_id, en)
    elif t == "follow_evaluation":
        title = _idea_title(session, n.ref_idea_id, en)
        body = (f'A new evaluation was added to an idea you follow "{title}"' if en
                else f"フォロー中のアイデア「{title}」に新しい評価がつきました")
        context = _quest_context(session, n.ref_idea_id, en)
    elif t == "follow_selection":
        title = _idea_title(session, n.ref_idea_id, en)
        body = (f'An idea you follow "{title}" was selected' if en
                else f"フォロー中のアイデア「{title}」が選定されました")
        context = _quest_context(session, n.ref_idea_id, en)
    elif t == "idea_updated":
        title = _idea_title(session, n.ref_idea_id, en)
        rev = p.get("revision")
        if en:
            rev_s = f" (rev {rev})" if rev else ""
            body = (f'An idea you voted on/follow "{title}" was updated{rev_s}. '
                    "Review the changes to reconsider your vote")
            tag = "Reconsider vote"
        else:
            rev_s = f"（版{rev}）" if rev else ""
            body = f"投票/フォロー中のアイデア「{title}」が更新されました{rev_s}。差分を確認して投票を見直せます"
            tag = "投票の見直し"
        context = _quest_context(session, n.ref_idea_id, en)
    elif t == "magic_reaction":
        spell = _spell_name(session, p, en)
        body = (f"{actor} cast the {spell} spell on your message" if en
                else f"{actor} さんがあなたのメッセージに {spell} の魔法を付けました")
        context = _quest_context(session, n.ref_idea_id, en)
    elif t == "achievement":
        ach = session.get(Achievement, n.ref_achievement_id) if n.ref_achievement_id else None
        tier = (ach.tier if ach else p.get("tier")) or ""
        if en:
            name = (ach.name_en if ach else None) or "achievement"
            tier_s = f" ({TIER_LABEL_EN.get(tier, tier)})" if tier else ""
            body = f'You unlocked the achievement "{name}"{tier_s}'
        else:
            name = (ach.name_ja if ach else None) or "実績"
            tier_s = f"（{TIER_LABEL_JA.get(tier, tier)}）" if tier else ""
            body = f"実績「{name}」{tier_s}を獲得しました"
        coin = p.get("coin", ach.coin_reward if ach else 0)
        if coin:
            meta = {"coin": coin}
    elif t == "quest_party_invited":
        quest = session.get(Quest, n.ref_quest_id) if n.ref_quest_id else None
        if quest:
            qt = quest.title  # UGC＝非翻訳
            body = (f'{actor} invited you to the quest "{qt}"' if en
                    else f"{actor} さんがクエスト「{qt}」に招集しました")
            context = f'Quest "{qt}"' if en else f"クエスト「{qt}」"
        else:
            qt = "(deleted quest)" if en else "（削除されたクエスト）"
            body = (f"{actor} invited you to the quest {qt}" if en
                    else f"{actor} さんがクエスト{qt}に招集しました")
            context = f"Quest {qt}" if en else f"クエスト{qt}"
    elif t == "security_new_device":
        body = ("A sign-in from a new device was detected" if en
                else "新しい端末からログインがありました")
        at, ip, dev = p.get("at"), p.get("ip"), p.get("device")
        context = " ・ ".join([x for x in (at, f"IP {ip}" if ip else None, dev) if x]) or None
        tag = "Security" if en else "セキュリティ"
    elif t == "security_password_changed":
        body = ("Your password was changed. If this wasn't you, contact your administrator" if en
                else "パスワードが変更されました。心当たりがなければ管理者に連絡してください")
        context = "We also notified you by email" if en else "メールでもお知らせしています"
        tag = "Security" if en else "セキュリティ"
    else:
        body = n.body or ("Notification" if en else "通知")

    return {"body": body, "context": context, "tag": tag, "meta": meta, "icon": ICON.get(t)}
