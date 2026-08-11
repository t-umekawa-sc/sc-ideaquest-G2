"""アカウント管理のユースケース（ドメイン B・コントロールプレーン中心）。

本体は管理DB `accounts`。氏名・所属は会社DB `users`/`quest_group_members`（B.2）。本スライスは
一覧の読み取り（`GET /admin/companies/{company_id}/accounts`）＝管理DB `accounts` から射影する。
所属グループ（会社DB）付与は後続スライス。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import redis
from sqlalchemy import func, or_, select

from app.control_plane.account_sync import repository as account_sync_repo
from app.control_plane.audit import repository as audit
from app.control_plane.auth import repository as account_repo
from app.control_plane.auth.orm import Account, Company
from app.control_plane.mail_outbox import repository as mail_repo
from app.control_plane.mail_outbox.templates import CATEGORY_PASSWORD_SETUP
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import delete_account_sessions, generate_token, hash_token
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile import repository as user_repo
from app.tenant.quest_group import repository as qg_repo

_MAX_PER_PAGE = 100
_DEFAULT_PER_PAGE = 20


def _account_state(a: Account) -> dict:
    """発行/編集/状態変更のレスポンス（機密は含めない・§B.6）。"""
    return {
        "account_id": str(a.id),
        "display_name": a.display_name,
        "login_id": a.login_id,
        "email": a.email,
        "system_role": a.system_role,
        "status": a.status,
        "password_set": a.password_hash is not None,
    }


def _account_in_company(session, company_id: uuid.UUID, account_id: uuid.UUID) -> Account:
    """対象アカウントを取得（他会社/不明は 404＝存在秘匿・B.2/§1.6）。"""
    account = session.get(Account, account_id)
    if account is None or account.company_id != company_id:
        raise AppError(404, "not_found")
    return account


def _active_system_admin_count(session) -> int:
    return session.execute(
        select(func.count()).select_from(Account).where(
            Account.system_role == "system_admin", Account.status == "active"
        )
    ).scalar_one()


def issue_account(
    company_id: uuid.UUID,
    *,
    display_name: str,
    login_id: str,
    email: str,
    system_role: str = "general",
    locale: str = "ja",
    memberships: list[dict] | None = None,
) -> dict:
    """アカウントを発行（B.2/B.5 発行フロー・system_admin 経路）。

    管理DB Tx で accounts INSERT（`password_hash=NULL`・`password_set=false`・`status=active`）＋
    同一Tx で (1) `account_sync_outbox`（会社DB `users` ミラー生成＋初期所属 `memberships` を相乗）と
    (2) `mail_outbox`（password-setup リンクを非同期送信・ADR-0007）を積む。identity 重複は 409。
    `memberships`＝`[{group_id, role}]`（会社DB `quest_group_members`）は worker が users の後に適用（B.5 step3）。
    """
    s = get_settings()
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")  # 対象会社の実在（B.2）

        # identity 会社内一意（login_id/email）＝重複は 409（B.2）。DB 制約でも担保（§4.2）
        clashes = session.execute(
            select(Account).where(
                Account.company_id == company_id,
                or_(Account.login_id == login_id, Account.email == email),
            )
        ).scalars().all()
        for a in clashes:
            field = "login_id" if a.login_id == login_id else "email"
            raise AppError(409, "conflict", extra={"errors": [{"field": field}]})

        account = Account(
            id=uuid.uuid4(), company_id=company_id,
            login_id=login_id, email=email, display_name=display_name,
            password_hash=None, locale=locale, system_role=system_role, status="active",
        )
        session.add(account)
        session.flush()  # account.id 確定

        # 初回PW設定リンク（otp_challenges purpose=password_setup・72h・A.7）
        token = generate_token()
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=s.password_setup_ttl_seconds)
        account_repo.create_password_setup_challenge(session, account.id, hash_token(token), expires_at)

        # 会社DB users ミラー（初回生成）＝同一Tx で outbox（B.5・§4.6）。初期所属は payload に相乗（B.5 step3）
        payload = {
            "display_name": display_name, "login_id": login_id, "email": email,
            "status": "active", "password_set": False,
            "system_role": system_role, "locale": locale,
        }
        if memberships:
            payload["memberships"] = memberships
        account_sync_repo.enqueue(session, account.id, company_id, "upsert", payload)
        # PW設定リンクのメール（非同期・同一Tx で mail_outbox に積む・ADR-0007 §2.6）
        mail_repo.enqueue(
            session, email, CATEGORY_PASSWORD_SETUP, secret=token, locale=locale,
            account_id=account.id, company_id=company_id,
        )
        audit.record("account.issue", {  # 監査（B.6・同一Tx）。機密（token）は入れない
            "company_id": str(company_id), "account_id": str(account.id),
            "system_role": system_role, "memberships": memberships or [],
        }, session=session)
        session.commit()
        return _account_state(account)


_EDITABLE_FIELDS = ("display_name", "login_id", "email", "system_role")


def edit_account(
    company_id: uuid.UUID, account_id: uuid.UUID, *, changes: dict, acting_account_id: str, r: redis.Redis
) -> dict:
    """アカウント編集（B.2・差分適用）。identity 一意再検証（重複 409）／`system_role` 変更は
    自己降格・0名化を拒否（`last_system_admin`）。system_role 変更時は当該アカウントの全セッション破棄（A.9-③）。

    `changes["memberships"]` を指定した場合は、その値を希望有効所属の全集合として会社DB
    `quest_group_members` へ直接差分適用（既存アカウントは mirror 済み＝outbox 非経由・B.3）。
    """
    memberships = changes.get("memberships")  # None＝所属に触れない（差分・§B.3）
    with control_session() as session:
        account = _account_in_company(session, company_id, account_id)
        db_identifier = session.get(Company, company_id).db_identifier

        new_role = changes.get("system_role")
        role_changed = new_role is not None and new_role != account.system_role
        if role_changed and account.system_role == "system_admin" and new_role != "system_admin":
            # 自己降格は常に不可（自己ロックアウト防止・B.2）
            if str(account_id) == acting_account_id:
                raise AppError(422, "last_system_admin")
            # 0 名化する降格は拒否（B.2/B.5.1）
            if account.status == "active" and _active_system_admin_count(session) <= 1:
                raise AppError(422, "last_system_admin")

        # identity 会社内一意（自分を除く）＝重複 409（B.2）
        new_login, new_email = changes.get("login_id"), changes.get("email")
        if new_login or new_email:
            ident_conds = []
            if new_login:
                ident_conds.append(Account.login_id == new_login)
            if new_email:
                ident_conds.append(Account.email == new_email)
            clashes = session.execute(
                select(Account).where(
                    Account.company_id == company_id, Account.id != account_id, or_(*ident_conds)
                )
            ).scalars().all()
            for a in clashes:
                if new_login and a.login_id == new_login:
                    raise AppError(409, "conflict", extra={"errors": [{"field": "login_id"}]})
                if new_email and a.email == new_email:
                    raise AppError(409, "conflict", extra={"errors": [{"field": "email"}]})

        old_role = account.system_role  # 監査用に変更前を退避（§2-⑬ 権限変更履歴）
        payload = {f: changes[f] for f in _EDITABLE_FIELDS if f in changes}
        for field, value in payload.items():
            setattr(account, field, value)
        if payload:
            account_sync_repo.enqueue(session, account_id, company_id, "upsert", payload)  # users ミラー
        audit.record("account.edit", {  # 監査（B.6・同一Tx）。system_role は前後、identity は変更キーのみ
            "company_id": str(company_id), "account_id": str(account_id),
            "changed_fields": sorted(payload.keys()),
            "system_role": {"before": old_role, "after": account.system_role} if role_changed else None,
            "memberships": memberships,
        }, session=session)
        session.commit()
        result = _account_state(account)

    if memberships is not None:  # 会社DB へ直接差分適用（別DB＝単一Txにできない・B.3）
        _apply_membership_diff(db_identifier, account_id, memberships)
    if role_changed:
        delete_account_sessions(r, str(account_id))  # 新権限を確実に適用（全セッション破棄・A.9-③）
    return result


def _apply_membership_diff(db_identifier: str, account_id: uuid.UUID, memberships: list[dict]) -> None:
    """`memberships`＝希望有効所属の全集合として会社DB `quest_group_members` へ差分適用（B.3・§5.5）。

    集合に無い現有効所属は解除（トゥームストーン）、集合内は upsert（role 反映）。冪等。
    既存アカウントは users ミラー済みが前提（発行直後で未同期の稀ケースは 409＝リトライを促す）。
    """
    desired: dict[uuid.UUID, str] = {
        uuid.UUID(str(m["group_id"])): m.get("role", "member") for m in memberships
    }
    with get_tenant_session(db_identifier) as tsession:
        user = user_repo.get_user_by_account(tsession, account_id)
        if user is None:
            raise AppError(409, "conflict")  # ミラー未生成の編集（発行直後未同期・まれ）
        for group_id in qg_repo.list_active_group_ids_for_user(tsession, user.id):
            if group_id not in desired:
                qg_repo.remove_membership(tsession, group_id, user.id)  # 集合外＝解除
        for group_id, role in desired.items():
            qg_repo.upsert_membership(tsession, group_id, user.id, role)
        tsession.commit()


def disable_account(
    company_id: uuid.UUID, account_id: uuid.UUID, r: redis.Redis, *, forbid_system_admin_target: bool = False
) -> dict:
    """アカウント無効化（B.2）。**有効な system_admin が 0 名になる操作は拒否**（`last_system_admin`・
    運営テナントの最後の system_admin 保護＝B.5.1）。成功時は全アクティブセッション破棄＋信頼端末失効（A.9-③）。

    `forbid_system_admin_target`＝会社アカウント管理者経路（B.2.1）＝**system_admin アカウントは無効化不可**
    （403・§8-⑯＝会社アカ管理者は last_system_admin 不変条件を迂回できない）。
    """
    with control_session() as session:
        account = _account_in_company(session, company_id, account_id)
        if forbid_system_admin_target and account.system_role == "system_admin":
            raise AppError(403, "forbidden")  # 会社アカ管理者は system_admin を disable 不可（B.2.1）
        if account.system_role == "system_admin" and account.status == "active":
            if _active_system_admin_count(session) <= 1:
                raise AppError(422, "last_system_admin")  # ロックアウト防止（B.2/B.5.1）
        account.status = "disabled"
        account_sync_repo.enqueue(session, account_id, company_id, "disable", {"status": "disabled"})
        account_repo.revoke_all_trusted_devices(session, account_id)  # 信頼端末失効（A.9-③）
        audit.record("account.disable", {"company_id": str(company_id), "account_id": str(account_id)},
                     session=session)  # 監査（B.6）
        session.commit()
        result = _account_state(account)
    delete_account_sessions(r, str(account_id))  # 全アクティブセッション破棄（Redis・A.9-③）
    return result


def enable_account(company_id: uuid.UUID, account_id: uuid.UUID) -> dict:
    """アカウント再有効化（B.2）。"""
    with control_session() as session:
        account = _account_in_company(session, company_id, account_id)
        account.status = "active"
        account_sync_repo.enqueue(session, account_id, company_id, "enable", {"status": "active"})
        audit.record("account.enable", {"company_id": str(company_id), "account_id": str(account_id)},
                     session=session)  # 監査（B.6）
        session.commit()
        return _account_state(account)


def reset_password(company_id: uuid.UUID, account_id: uuid.UUID) -> dict:
    """初回/再設定PWリンクを再送（B.2・A.7）。旧リンクを失効し新リンクを mail_outbox で非同期送信。"""
    s = get_settings()
    with control_session() as session:
        account = _account_in_company(session, company_id, account_id)
        token = generate_token()
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=s.password_setup_ttl_seconds)
        account_repo.invalidate_password_setup_challenges(session, account_id)  # 旧リンク失効（A.7）
        account_repo.create_password_setup_challenge(session, account_id, hash_token(token), expires_at)
        mail_repo.enqueue(
            session, account.email, CATEGORY_PASSWORD_SETUP, secret=token, locale=account.locale,
            account_id=account_id, company_id=company_id,
        )
        audit.record("account.password_reset",  # 監査（B.6）。token 等の機密は入れない（§15）
                     {"company_id": str(company_id), "account_id": str(account_id)}, session=session)
        session.commit()
    return {"status": "sent"}


def list_company_accounts(
    company_id: uuid.UUID,
    *,
    q: str | None = None,
    status: str | None = None,
    page: int = 1,
    per_page: int = _DEFAULT_PER_PAGE,
) -> dict:
    """会社のアカウント一覧（オフセット・§1.8）。対象会社が無ければ 404（存在秘匿・B.2）。"""
    per_page = max(1, min(per_page, _MAX_PER_PAGE))
    page = max(1, page)
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")  # 対象会社の実在（B.2・§1.6）

        conds = [Account.company_id == company_id]
        if status in ("active", "disabled"):
            conds.append(Account.status == status)
        if q:
            like = f"%{q}%"
            conds.append(
                or_(Account.display_name.ilike(like), Account.login_id.ilike(like), Account.email.ilike(like))
            )

        total = session.execute(select(func.count()).select_from(Account).where(*conds)).scalar_one()
        rows = session.execute(
            select(Account)
            .where(*conds)
            .order_by(Account.created_at, Account.id)
            .offset((page - 1) * per_page)
            .limit(per_page)
        ).scalars().all()
        data = [_account_item(a) for a in rows]

    return {"data": data, "page_info": {"total": total, "page": page, "per_page": per_page}}


def _account_item(a: Account) -> dict:
    return {
        "account_id": str(a.id),
        "display_name": a.display_name,
        "login_id": a.login_id,
        "email": a.email,
        "system_role": a.system_role,
        "status": a.status,
        "last_login_at": a.last_login_at.isoformat() if a.last_login_at else None,
    }
