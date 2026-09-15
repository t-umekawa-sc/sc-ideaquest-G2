#!/usr/bin/env python3
"""受入用デモデータ生成（冪等・再利用可能）。

稼働中バックエンドの **HTTP API を実ユーザーで叩いて** 作る（DB 直挿し禁止）＝XP 台帳・版記録・
通知・realtime publish 等の業務ロジックを本物どおり通す。ブラウザ受入（impl/README.md の受入待ち）
で使うデモデータを、失われても再生成できるようにコード化する。

前提:
  - `cd impl && docker compose --profile workers up -d` 済み（backend :8000）。
  - ACME-01 の seed アカウント user/user2/user3/kanri がいずれも Passw0rd!（bootstrap 既定）。

実行（リポジトリ直下 or どこからでも・ホストの python3＋requests で可）:
  python3 impl/backend/scripts/seed_demo.py           # 全群
  python3 impl/backend/scripts/seed_demo.py d         # D 群のみ（e / g も同様）

冪等性: クエスト/アイデアは件名で既存検索して再利用（重複作成しない）。版・添付・投票・遷移も
現状を見て不足分だけ実施する。何度流しても同じ状態に収束する。

群単位で育てる（フロント実装フロー規約 §1.1 の受入ゲート・実装順 D→E→G→F→H）。実装済み = **D / E / G 群**（F/H は未実装）。
"""
from __future__ import annotations

import base64
import sys
import uuid

import requests

BASE = "http://localhost:8000/api/v1"
COMPANY_CODE = "ACME-01"
PASSWORD = "Passw0rd!"
APP = "http://localhost:3000"  # 受入 URL の出力用（ブラウザ）

LOGINS = {
    "user": "user@acme.example",   # テスト 太郎（作成者=owner）
    "user2": "user2@acme.example",  # チャット 太郎
    "user3": "user3@acme.example",  # アイデア 出す像
    "kanri": "kanri@acme.example",  # 管理者（company_account_admin）
}

# 1x1 透明 PNG（マジックバイト検証 §8 を通す最小の本物 PNG）。
_PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


class Client:
    """1 ユーザーのログイン済みセッション（cookie 保持・CSRF 自動付与）。"""

    def __init__(self, key: str):
        self.key = key
        self.s = requests.Session()
        r = self.s.post(
            f"{BASE}/auth/login",
            json={"company_code": COMPANY_CODE, "login_id": LOGINS[key], "password": PASSWORD},
        )
        r.raise_for_status()
        body = r.json()
        if body.get("status") != "authenticated":
            raise SystemExit(f"login({key}) failed: {body}")
        self.user_id = body["session"]["user"]["user_id"]
        self.display_name = body["session"]["user"].get("display_name", "")
        # メンションのインライン強調は composer と同じ「空白除去トークン」で一致する（frontend の @token 正規化）。
        self.nospace = "".join(self.display_name.split())

    def _headers(self) -> dict:
        # ダブルサブミット CSRF（A.0）: iq_csrf cookie と一致する X-CSRF-Token を送る。Origin は省略（非ブラウザ許容）。
        return {"X-CSRF-Token": self.s.cookies.get("iq_csrf", "")}

    def get(self, path: str, **kw):
        r = self.s.get(BASE + path, **kw)
        r.raise_for_status()
        return r.json()

    def _send(self, method: str, path: str, *, ok, **kw):
        r = self.s.request(method, BASE + path, headers=self._headers(), **kw)
        if r.status_code not in ok:
            raise RuntimeError(f"{method} {path} -> {r.status_code} {r.text}")
        ct = r.headers.get("content-type", "")
        return r.json() if r.content and ct.startswith("application/json") else None

    def post(self, path, *, ok=(200, 201, 204), **kw):
        return self._send("POST", path, ok=ok, **kw)

    def patch(self, path, *, ok=(200,), **kw):
        return self._send("PATCH", path, ok=ok, **kw)

    def put(self, path, *, ok=(200,), **kw):
        return self._send("PUT", path, ok=ok, **kw)

    def delete(self, path, *, ok=(200, 204), **kw):
        return self._send("DELETE", path, ok=ok, **kw)


# ---- 冪等ヘルパ（件名検索で再利用） ----

def find_quest(c: Client, title: str):
    data = c.get("/quests", params={"limit": 100}).get("data", [])
    for q in data:
        if q["title"] == title:
            return q
    return None


def ensure_quest(c: Client, *, title: str, categories, purpose, deadline, members, status="recruiting"):
    existing = find_quest(c, title)
    if existing:
        print(f"  = quest 既存: {title} ({existing['id']}) status={existing['status']}")
        return c.get(f"/quests/{existing['id']}")
    q = c.post(
        "/quests",
        json={
            "title": title,
            "color": "#3B82F6",
            "quest_group_ids": [],  # 0 件 = 会社全体（FR-38・誰でもアクセス可＝受入を単純化）
            "categories": categories,
            "deadline": deadline,
            "purpose": purpose,
            "members": members,
            "status": status,
        },
    )
    print(f"  + quest 作成: {title} ({q['id']}) status={q['status']}")
    return q


def find_idea(c: Client, quest_id: str, title: str):
    data = c.get(f"/quests/{quest_id}/ideas", params={"status": ["draft", "published"], "limit": 100}).get("data", [])
    for i in data:
        if i["title"] == title:
            return i
    return None


def ensure_idea(c: Client, quest_id: str, *, title: str, value: str, body: str, time_limit=None, status="published"):
    existing = find_idea(c, quest_id, title)
    if existing:
        print(f"    = idea 既存: {title} ({existing['id']}) rev={existing.get('current_revision')}")
        return c.get(f"/ideas/{existing['id']}")
    i = c.post(
        f"/quests/{quest_id}/ideas",
        json={"title": title, "value": value, "body": body, "time_limit": time_limit, "status": status},
    )
    print(f"    + idea 作成: {title} ({i['id']}) rev={i.get('current_revision')} status={i['status']}")
    return i


def ensure_revisions(c: Client, idea: dict, edits: list[dict]):
    """公開アイデアに版を積む（D.4 更新履歴）。目標版数 = 1 + len(edits)。現状が足りない分だけ PATCH。"""
    idea_id = idea["id"]
    cur = c.get(f"/ideas/{idea_id}")["current_revision"]
    target = 1 + len(edits)
    for n in range(cur, target):  # cur..target-1: 次の版を作る PATCH を適用
        patch = edits[n - 1]  # rev(n)->rev(n+1) を作る編集
        c.patch(f"/ideas/{idea_id}", json=patch)
        print(f"      ~ rev {n} -> {n + 1}: {list(patch.keys())}")
    if cur >= target:
        print(f"      = 版は既に {cur}（目標 {target}）")


def ensure_attachments(c: Client, idea_id: str, names: list[str]):
    """指定名の添付が無ければ追加（D.3・冪等 = 既存名はスキップ）。"""
    have = {a["original_name"] for a in c.get(f"/ideas/{idea_id}").get("attachments", [])}
    for name in names:
        if name in have:
            print(f"      = 添付既存: {name}")
            continue
        c.post(f"/ideas/{idea_id}/attachments", files=[("files", (name, _PNG_1PX, "image/png"))])
        print(f"      + 添付追加: {name}")


def ensure_attachment_revision(c: Client, idea_id: str, base_revisions: int):
    """添付を版スナップショットに載せる（設計B＝保存で版に取り込む）。添付付与後の版がまだ無ければ1回 touch。

    add/DELETE 添付は独立EPで版を作らないため、既存デモの添付は版に未記録＝削除しても差分に出ない。
    受入で「添付削除が更新履歴に出る」を確認できるよう、添付付与後に content を1回 PATCH して現添付を版に記録する。
    冪等＝版数が base_revisions を超えていれば記録済みとみなしスキップ。
    """
    detail = c.get(f"/ideas/{idea_id}")
    revs = c.get(f"/ideas/{idea_id}/revisions").get("data", [])
    if detail.get("attachments") and len(revs) <= base_revisions:
        c.patch(f"/ideas/{idea_id}", json={"note": "受入デモ（添付を更新履歴に記録）"})
        print(f"      ~ 添付を版に記録（capture PATCH）rev{len(revs)}→{len(revs) + 1}")
    else:
        print("      = 添付は既に版に記録済み（or 添付なし）")


def try_vote(c: Client, idea_id: str, vote_type: str):
    try:
        c.post(f"/ideas/{idea_id}/vote", json={"type": vote_type})
        print(f"      · {c.key} 投票 {vote_type}")
    except RuntimeError as e:
        print(f"      ! {c.key} 投票 skip: {e}")


def try_follow(c: Client, idea_id: str):
    try:
        c.post(f"/ideas/{idea_id}/follow")
        print(f"      · {c.key} フォロー")
    except RuntimeError as e:
        print(f"      ! {c.key} フォロー skip: {e}")


_STATUS_ORDER = ["draft", "recruiting", "in_progress", "evaluating", "completed"]


def advance_to(c: Client, quest_id: str, target: str):
    """クエストを target まで隣接前進（冪等・既に到達なら何もしない）。"""
    cur = c.get(f"/quests/{quest_id}")["status"]
    ci, ti = _STATUS_ORDER.index(cur), _STATUS_ORDER.index(target)
    while ci < ti:
        nxt = _STATUS_ORDER[ci + 1]
        c.post(f"/quests/{quest_id}/transition", json={"to": nxt})
        print(f"    > {cur} -> {nxt}")
        cur = nxt
        ci += 1


# ---- D 群 ----

def seed_d(owner: Client, u2: Client, u3: Client):
    print("[D群] アイデア（投票/フォロー/更新履歴/添付/完了凍結）")
    party = [
        {"user_id": u2.user_id, "permissions": ["vote", "idea_create", "comment"]},
        {"user_id": u3.user_id, "permissions": ["vote", "idea_create", "comment"]},
    ]

    # --- Quest A（recruiting）= 投票/フォロー/更新履歴/添付 ---
    qa = ensure_quest(
        owner,
        title="【受入】D-アイデア（投票/履歴/添付）",
        categories=["業務改善", "DX"],
        purpose="日々の業務の非効率をアイデアで解消する（受入デモ・編集可）。",
        deadline="2027-01-31",
        members=party,
    )

    # Idea 1: 更新履歴（3 版）＋添付 2 件（うち1件を編集モードで削除デモ D-TC-218）
    i1 = ensure_idea(
        owner, qa["id"],
        title="夜間配送の集約デモ",
        value="配送コストを10%削減",
        body="夜間の個別配送を1便に集約し、積載率を上げてコストを下げる。",
        time_limit="2026-12-15",
    )
    ensure_revisions(owner, i1, edits=[
        {"value": "配送コストを15%削減", "body": "夜間の個別配送を1便に集約。加えて再配達を翌朝便へ寄せる。",
         "time_limit": "2026-12-20"},
        {"body": "夜間の個別配送を1便に集約。再配達を翌朝便へ寄せ、置き配の同意を既定化する。",
         "time_limit": "2027-01-10"},
    ])
    ensure_attachments(owner, i1["id"], ["設計メモ.png", "コスト試算.png"])
    ensure_attachment_revision(owner, i1["id"], base_revisions=3)  # 添付を版に記録＝削除が更新履歴の差分に出る（設計B）
    try_vote(u2, i1["id"], "approve")
    try_vote(u3, i1["id"], "oppose")
    try_follow(u3, i1["id"])

    # Idea 2: ユーザーが自分で投票/フォローを試すための素の公開アイデア（投票ゼロ始まり）
    ensure_idea(
        owner, qa["id"],
        title="会議室予約の自動化デモ",
        value="予約の重複と空予約を撲滅",
        body="センサーで在室を検知し、無使用予約を自動解放。Slack から空き検索・予約。",
        time_limit="2026-11-30",
    )

    # --- Quest B（completed）= 完了クエストの編集 409（D-TC-216）/ 凍結（D-TC-214） ---
    qb = ensure_quest(
        owner,
        title="【受入】D-完了クエスト（編集409/凍結）",
        categories=["DX"],
        purpose="完了済みクエストの凍結挙動を確認する（受入デモ・編集不可）。",
        deadline="2026-06-30",
        members=party,
    )
    ib = ensure_idea(
        owner, qb["id"],
        title="請求書処理の電子化デモ",
        value="経理の入力工数を半減",
        body="OCR で請求書を取り込み、会計システムへ自動連携する。",
        time_limit="2026-06-15",
    )
    advance_to(owner, qb["id"], "completed")

    print("\n=== D 群 受入 URL ===")
    print(f"  更新履歴(3版)/添付/添付削除  : {APP}/ideas/{i1['id']}")
    print(f"    ↳ 完了クエスト「Q」ではなく上記アイデアで『版N(履歴)』と📎添付DL・編集→添付×を確認")
    print(f"  投票/フォロー(素の公開)      : 上記クエスト『会議室予約の自動化デモ』")
    print(f"  クエスト(recruiting)         : {APP}/quests/{qa['id']}")
    print(f"  完了クエスト(編集409/凍結)   : {APP}/quests/{qb['id']}  → アイデア『請求書処理の電子化デモ』を編集")
    print(f"  idea_count 連動              : {APP}/quests  で上記2クエストの💡件数")


# ---- E 群（チャット） ----

def post_message(c: Client, idea_id: str, *, body=None, quotes=None, mentions=None, files=None):
    """チャット投稿（E・multipart Form）。body/引用/メンション/添付を1メッセージで送る。返り値＝ChatMessageDTO。"""
    form = [("idea_id", idea_id)]
    if body is not None:
        form.append(("body", body))
    for q in (quotes or []):
        form.append(("quoted_message_ids", q))
    for m in (mentions or []):
        form.append(("mentions", m))
    files_param = [("files", (n, d, mt)) for (n, d, mt) in (files or [])] or None
    r = c.s.post(BASE + "/chat-messages", data=form, files=files_param, headers=c._headers())
    if r.status_code != 201:
        raise RuntimeError(f"POST /chat-messages -> {r.status_code} {r.text}")
    return r.json()


def spell_to_use(c: Client):
    """魔法リアクション用スペルID。解放済みがあればそれ、無ければ can_unlock を1つ解放（SP不足は None）。"""
    cat = c.get("/spells")
    for s in cat.get("data", []):
        if s.get("unlocked"):
            return s["id"]
    sp = cat.get("skill_point_balance", 0)
    for s in cat.get("data", []):
        if s.get("can_unlock") and sp >= s.get("sp_cost", 1):
            c.post(f"/spells/{s['id']}/unlock")
            return s["id"]
    return None


def seed_e(owner: Client, u2: Client, u3: Client):
    print("[E群] チャット（投稿/引用/メンション/リアクション/魔法/添付/既読）")
    qa = find_quest(owner, "【受入】D-アイデア（投票/履歴/添付）")
    if not qa:
        print("  ! 先に D 群が必要です（python3 impl/backend/scripts/seed_demo.py d）")
        return
    idea = ensure_idea(
        owner, qa["id"],
        title="Eチャットデモ",
        value="議論の見本",
        body="このアイデアのチャットで 投稿/引用/メンション/リアクション/魔法/添付/既読 を確認します。",
        time_limit="2027-01-31",
    )
    iid = idea["id"]
    alive = [m for m in owner.get(f"/ideas/{iid}/chat").get("data", []) if not m.get("is_deleted")]
    if alive:
        print("    = チャット既存（投稿済み）→ skip")
    else:
        # m1（リアクション対象・u2 の投稿）
        m1 = post_message(u2, iid, body="この案、いいですね。夜間便の集約に賛成です。")
        m2 = post_message(u3, iid, body=f"@{owner.nospace} 積載率の想定値は？", mentions=[owner.user_id])
        # owner が m1・m2 を複数引用して返信＋メンション
        post_message(owner, iid, body="ありがとうございます。積載率は現状60%→85%を想定しています。",
                     quotes=[m1["id"], m2["id"]], mentions=[u2.user_id, u3.user_id])
        # 通常リアクション（u3）＋魔法リアクション（owner＝SP保有者。u2/u3 はSP0のため）を m1 に付与
        try:
            u3.post(f"/chat-messages/{m1['id']}/reactions", json={"type": "normal", "emoji": "👍"})
            print("      · u3 通常リアクション 👍")
        except RuntimeError as e:
            print(f"      ! 通常リアクション skip: {e}")
        spell = spell_to_use(owner)
        if spell:
            try:
                owner.post(f"/chat-messages/{m1['id']}/reactions", json={"type": "magic", "spell_id": spell})
                print("      · owner 魔法リアクション（SP保有者）")
            except RuntimeError as e:
                print(f"      ! 魔法リアクション skip: {e}")
        else:
            print("      ! SP不足で魔法リアクションは skip")
        # owner の最終投稿より後に他ユーザーの発言＝owner に未読が残り既読セパレータが出る
        post_message(u2, iid, body="参考資料を添付します。", files=[("議事メモ.png", _PNG_1PX, "image/png")])
        post_message(u3, iid, body="承知しました。集計は私が対応します。")
        print("    + チャット投稿一式（引用/メンション/添付/リアクション/魔法/未読）")

    # 完了クエストのチャット凍結（請求書処理の電子化デモ）の URL を具体化。
    frozen_url = "（先に D 群を実行）"
    qb = find_quest(owner, "【受入】D-完了クエスト（編集409/凍結）")
    if qb:
        fib = find_idea(owner, qb["id"], "請求書処理の電子化デモ")
        if fib:
            frozen_url = f"{APP}/ideas/{fib['id']}/chat"
    print("\n=== E 群 受入 URL ===")
    print(f"  チャット（SC-24）           : {APP}/ideas/{iid}/chat")
    print(f"    ↳ 引用/メンション/👍・魔法リアクション/📎添付DL/既読セパレータ（初回オープンで未読区切り）")
    print(f"  完了クエストのチャット凍結  : {frozen_url}  → 入力欄が凍結バナー")


# ---- G 群（ゲーミフィケーション：魔法解放/ショップ/アバター/ランキング/実績） ----

def purchase(c: Client, item_id: str):
    """アイテム購入（G.1・Idempotency-Key 付き＝二重送信でもコインは一度だけ消費）。返り値＝PurchaseResponse。"""
    r = c.s.post(
        BASE + f"/items/{item_id}/purchase",
        headers={**c._headers(), "Idempotency-Key": str(uuid.uuid4())},
    )
    if r.status_code not in (200, 201):
        raise RuntimeError(f"POST /items/{item_id}/purchase -> {r.status_code} {r.text}")
    return r.json()


def seed_g(owner: Client, u2: Client, u3: Client):
    print("[G群] 魔法解放/ショップ/アバター/ランキング/実績")

    # --- SC-32 魔法解放：解放済みを1つ用意（無ければ1つ解放）。残りは受入で解放を試せるよう残す。 ---
    cat = owner.get("/spells")
    sp = cat.get("skill_point_balance", 0)
    unlocked = [s for s in cat.get("data", []) if s.get("unlocked")]
    if unlocked:
        print(f"    = 魔法 解放済み {len(unlocked)} 件／SP残 {sp}")
    elif spell_to_use(owner):  # 1つ解放（SP不足なら None）
        print(f"    + 魔法 1つ解放（SP残 {owner.get('/spells').get('skill_point_balance', 0)}）")
    else:
        print(f"    ! SP不足で解放できず（SP残 {sp}）")
    can_unlock = [s for s in owner.get("/spells").get("data", []) if s.get("can_unlock")]
    print(f"      ↳ 受入で解放を試せる（can_unlock）: {len(can_unlock)} 件")

    # --- SC-30 ショップ購入 ＋ SC-31 装備：未所有の手頃なアイテムを1つ購入して装備。残コインは受入用に残す。 ---
    resp = owner.get("/items")
    coin = resp.get("coin_balance", 0)
    items = resp.get("data", [])
    target = next((it for it in items if it.get("owned")), None)
    if target:
        print(f"    = アイテム所有済み: {target['name_ja']}（slot={target['slot']}・コイン残 {coin}）")
    else:
        affordable = sorted(
            (it for it in items if not it.get("owned") and it.get("price_coin", 0) <= coin),
            key=lambda it: it.get("price_coin", 0),
        )
        if affordable:
            target = affordable[0]
            res = purchase(owner, target["id"])
            print(f"    + 購入: {target['name_ja']}（{target['price_coin']}コイン → 残 {res.get('coin_balance')}）")
        else:
            print(f"    ! 購入可能な未所有アイテムなし（コイン残 {coin}）")
    if target and not target.get("is_equipped"):
        owner.put("/me/equipment", json={target["slot"]: target["id"]})
        print(f"      · 装備: slot={target['slot']} ← {target['name_ja']}")
    elif target:
        print(f"      = 既に装備済み: {target['name_ja']}")

    # --- SC-41 ランキング / SC-40 実績：D/E 群の XP・行動から既にデータあり。件数を出して確認。 ---
    try:
        summ = owner.get("/achievements").get("summary", {})
        print(f"    = 実績: 獲得 {summ.get('unlocked')}／全 {summ.get('total')}（獲得コイン {summ.get('coin_earned')}）")
    except RuntimeError as e:
        print(f"    ! 実績取得 skip: {e}")

    print("\n=== G 群 受入 URL ===")
    print(f"  魔法 解放/SP残高（SC-32）        : {APP}/spells")
    print(f"  ショップ 購入/コイン残（SC-30）  : {APP}/shop")
    print(f"  アバター 装備/ベース切替（SC-31）: {APP}/avatar")
    print(f"  ランキング（SC-41）              : {APP}/ranking")
    print(f"  実績（SC-40）                    : {APP}/achievements")
    print("  ※owner は game_mode OFF。ゲーム層UI（ショップ/魔法/実績/ランキング）を見るには プロフィール>ゲームモード を ON。")


def main():
    which = (sys.argv[1].lower() if len(sys.argv) > 1 else "all")
    print(f"seed_demo: target={which} base={BASE}")
    owner = Client("user")
    u2 = Client("user2")
    u3 = Client("user3")

    if which in ("all", "d"):
        seed_d(owner, u2, u3)
    if which in ("all", "e"):
        seed_e(owner, u2, u3)
    if which in ("all", "g"):
        seed_g(owner, u2, u3)

    print("\n完了。")


if __name__ == "__main__":
    main()
