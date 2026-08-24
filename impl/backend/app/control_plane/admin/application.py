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
from app.control_plane.admin import list_query as lq
from app.control_plane.audit import repository as audit
from app.control_plane.auth import repository as account_repo
from app.control_plane.auth.orm import Account, Company
from app.control_plane.mail_outbox import repository as mail_repo
from app.control_plane.mail_outbox.templates import CATEGORY_EMAIL_VERIFY_LINK, CATEGORY_PASSWORD_SETUP
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
        "email_verified": a.email_verified_at is not None,
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


def _ops_company_id(session) -> uuid.UUID | None:
    """運営テナント（OPS）の会社 id。予約会社コード（config・固定）で識別（B.5.1・ADR なし＝設計固定）。"""
    s = get_settings()
    company = session.execute(
        select(Company).where(Company.company_code == s.ops_company_code)
    ).scalars().first()
    return company.id if company else None


def _active_system_admin_count(session) -> int:
    """**OPS テナント内**の有効な system_admin 数（last_system_admin 保護＝B.5.1 は OPS 内が対象）。

    以前は全社横断で数えており、他社の system_admin が居ると OPS の「最後の1人」保護が誤って無効化された
    （＝ロックアウト保護の抜け）。保護対象は運営テナントなので OPS 会社に絞る。
    """
    ops_id = _ops_company_id(session)
    if ops_id is None:
        return 0
    return session.execute(
        select(func.count()).select_from(Account).where(
            Account.system_role == "system_admin", Account.status == "active",
            Account.company_id == ops_id,
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
            # OPS テナントを 0 名化する降格は拒否（B.2/B.5.1・保護対象は OPS 内）
            if account.company_id == _ops_company_id(session) and account.status == "active" \
                    and _active_system_admin_count(session) <= 1:
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
        email_changed = new_email is not None and new_email != account.email  # 変更判定は setattr 前
        payload = {f: changes[f] for f in _EDITABLE_FIELDS if f in changes}
        for field, value in payload.items():
            setattr(account, field, value)
        if email_changed:
            account.email_verified_at = None  # 新アドレスは未確認へリセット（ADR-0009 §2.3）
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
        # OPS テナントを 0 名化する無効化は拒否（保護対象は OPS 内・B.5.1）。非 OPS の system_admin は対象外。
        if account.company_id == _ops_company_id(session) and account.system_role == "system_admin" \
                and account.status == "active" and _active_system_admin_count(session) <= 1:
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


def send_email_verification(company_id: uuid.UUID, account_id: uuid.UUID) -> dict:
    """メールアドレス確認リンクを送信（B.2/B.2.1・opt-in・ADR-0009）。

    現 `email` 宛に確認リンク（`email_verify`・単回・72h・旧未使用チャレンジは失効）を mail_outbox で非同期送信。
    確認済みでも再送可（アドレス変更後の再確認）。応答＝202（受理）。
    """
    s = get_settings()
    with control_session() as session:
        account = _account_in_company(session, company_id, account_id)
        token = generate_token()
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=s.email_verify_ttl_seconds)
        account_repo.invalidate_email_verify_challenges(session, account_id)  # 最新リンクのみ有効（§2.1）
        account_repo.create_email_verify_challenge(session, account_id, hash_token(token), expires_at, account.email)
        mail_repo.enqueue(
            session, account.email, CATEGORY_EMAIL_VERIFY_LINK, secret=token, locale=account.locale,
            account_id=account_id, company_id=company_id,
        )
        audit.record("account.email_verification.send",  # 監査（B.6）。token 等の機密は入れない（§15）
                     {"company_id": str(company_id), "account_id": str(account_id)}, session=session)
        session.commit()
    return {"status": "sent"}


# DataTable 契約（§1.8.1）＝アカウント一覧のソート可能キー/enum ホワイトリスト（B.2）。
# group_id フィルタ（会社DB `quest_group_members` join）は所属スライス後＝ここには含めない（設計↔実装ドリフト回避）。
_ACCOUNT_SORT_COLUMNS = {
    "display_name": Account.display_name,
    "login_id": Account.login_id,
    "email": Account.email,
    "system_role": Account.system_role,
    "status": Account.status,
    "last_login_at": Account.last_login_at,
    "created_at": Account.created_at,
}
_ACCOUNT_STATUSES = ("active", "disabled")
_ACCOUNT_ROLES = ("general", "company_account_admin", "system_admin")


def _account_query(company_id: uuid.UUID, *, q, status, system_role, sort, exclude_ids=None):
    """アカウント一覧の検索/フィルタ/ソートを共通適用（一覧・CSV で共有・§1.8.1①②）。

    戻り値＝(rows_stmt〔order 済み・offset/limit 未適用〕, count_stmt)。未知 sort/enum はここで 422（先に検証）。
    `exclude_ids`＝固定行（ピン）を非固定母集合から除外（§1.8.1④）。
    """
    order = lq.parse_sort(sort, _ACCOUNT_SORT_COLUMNS)
    statuses = lq.parse_enum(status, "status", _ACCOUNT_STATUSES)
    roles = lq.parse_enum(system_role, "system_role", _ACCOUNT_ROLES)

    conds = [Account.company_id == company_id]
    if statuses:  # enum 多値＝OR（IN）・§1.8.1②
        conds.append(Account.status.in_(statuses))
    if roles:
        conds.append(Account.system_role.in_(roles))
    if q:
        like = f"%{q}%"
        conds.append(
            or_(Account.display_name.ilike(like), Account.login_id.ilike(like), Account.email.ilike(like))
        )
    if exclude_ids:  # 固定行は非固定母集合（data/total）から除外・§1.8.1④
        conds.append(Account.id.notin_(exclude_ids))

    rows_stmt = select(Account).where(*conds)
    # 明示ソートはキー順＋末尾 id で一意化／無指定は従来の created_at,id 決定的順序（§1.8.1①）。
    rows_stmt = rows_stmt.order_by(*order, Account.id) if order else rows_stmt.order_by(Account.created_at, Account.id)
    count_stmt = select(func.count()).select_from(Account).where(*conds)
    return rows_stmt, count_stmt


def _fetch_pinned_accounts(session, company_id: uuid.UUID, ids: list[uuid.UUID]) -> list[dict]:
    """ピン ID の行を絞込/ページに関係なく解決（pin 順を保持・未解決/他社 ID は除外・§1.8.1④）。

    pin_ids は当該会社スコープで解決する（他社アカウントの漏洩を構造的に防ぐ）。
    """
    if not ids:
        return []
    rows = session.execute(
        select(Account).where(Account.company_id == company_id, Account.id.in_(ids))
    ).scalars().all()
    by_id = {a.id: a for a in rows}
    return [_account_item(by_id[i]) for i in ids if i in by_id]


def list_company_accounts(
    company_id: uuid.UUID,
    *,
    q: str | None = None,
    status: str | None = None,
    system_role: str | None = None,
    sort: str | None = None,
    pin_ids: str | None = None,
    page: int = 1,
    per_page: int = _DEFAULT_PER_PAGE,
) -> dict:
    """会社のアカウント一覧（オフセット・§1.8）＋複数ソート/enum 多値フィルタ/固定行（§1.8.1①②④）。会社が無ければ 404（存在秘匿・B.2）。"""
    per_page = max(1, min(per_page, _MAX_PER_PAGE))
    page = max(1, page)
    pins = lq.parse_pin_ids(pin_ids)  # 不正形式は 422（先に検証）
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")  # 対象会社の実在（B.2・§1.6）
        pinned = _fetch_pinned_accounts(session, company_id, pins)  # 絞込/ページに関係なく解決・§1.8.1④
        rows_stmt, count_stmt = _account_query(
            company_id, q=q, status=status, system_role=system_role, sort=sort,
            exclude_ids=pins)  # 固定行は非固定母集合から除外
        total = session.execute(count_stmt).scalar_one()
        rows = session.execute(rows_stmt.offset((page - 1) * per_page).limit(per_page)).scalars().all()
        data = [_account_item(a) for a in rows]
    return {"data": data, "pinned": pinned, "page_info": {"total": total, "page": page, "per_page": per_page}}


def _account_item(a: Account) -> dict:
    return {
        "account_id": str(a.id),
        "display_name": a.display_name,
        "login_id": a.login_id,
        "email": a.email,
        "email_verified": a.email_verified_at is not None,
        "system_role": a.system_role,
        "status": a.status,
        "last_login_at": a.last_login_at.isoformat() if a.last_login_at else None,
    }


# DataTable 契約（§1.8.1③）＝アカウント CSV の表示可能列とラベル（列順は ?columns= が正）。
_ACCOUNT_CSV_COLUMNS = {
    "display_name": "氏名",
    "login_id": "ログインID",
    "email": "メールアドレス",
    "system_role": "システムロール",
    "status": "状態",
    "last_login_at": "最終ログイン",
}
_ACCOUNT_CSV_DEFAULT_ORDER = ["display_name", "login_id", "email", "system_role", "status", "last_login_at"]


def _account_csv_cell(key: str, a: Account) -> str:
    if key == "last_login_at":
        return a.last_login_at.isoformat() if a.last_login_at else ""
    return str(getattr(a, key))


def export_accounts_csv(company_id: uuid.UUID, *, q: str | None = None, status: str | None = None,
                        system_role: str | None = None, sort: str | None = None,
                        columns: str | None = None) -> tuple[bytes, str]:
    """アカウント一覧を CSV で出力（同一フィルタ/ソートの全件・§1.8.1③）。管理系＝監査対象（B.6）。会社が無ければ 404。"""
    keys = lq.parse_columns(columns, _ACCOUNT_CSV_COLUMNS, _ACCOUNT_CSV_DEFAULT_ORDER)
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")  # 対象会社の実在（B.2・§1.6）
        rows_stmt, _ = _account_query(company_id, q=q, status=status, system_role=system_role, sort=sort)
        rows = session.execute(rows_stmt).scalars().all()  # 全件（ページング無視・§1.8.1③）
        audit.record("account.export",  # 管理系エクスポートは監査対象（§1.8.1③・B.6・同一Tx）
                     {"company_id": str(company_id), "count": len(rows), "columns": keys}, session=session)
        session.commit()
    header = [_ACCOUNT_CSV_COLUMNS[k] for k in keys]  # ヘッダ＝表示列ラベル・列順
    body = ([_account_csv_cell(k, a) for k in keys] for a in rows)
    return lq.to_csv_bytes(header, body), "accounts.csv"  # UTF-8 BOM（Excel 互換・§1.8.1③）
