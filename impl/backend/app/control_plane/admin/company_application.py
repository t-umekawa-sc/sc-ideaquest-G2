"""会社 CRUD のユースケース（ドメイン B.1・system_admin・SC-91/92）。

会社は管理DB `companies`。DBプロビジョニングは MVP 手動（§8-⑫）＝作成は `status=suspended` で
コントロールDB に行を作るのみ（会社DB作成/`active` 化は運用）。`group_count`（会社DB `quest_groups`）は
ドメインC実装時に付与する（本スライスは `account_count` のみ）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, or_, select

from app.control_plane.admin import list_query as lq
from app.control_plane.audit import repository as audit
from app.control_plane.auth.orm import Account, Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.storage import get_storage, validate_image_upload
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember

_SETTINGS_FIELDS = ("vote_anonymized", "hide_voters_from_managers", "mfa_required")
_PROFILE_FIELDS = ("name", "color", "icon_image_path")


# DataTable 契約（§1.8.1①）＝ソート可能キーのホワイトリスト。直カラムはここ、集計 account_count は
# list_companies 内で subquery カラムを渡す（`group_count` は会社DB `quest_groups` 依存＝ドメインC後）。
# 汎用パーサ（複数ソート/enum/pin_ids/CSV 列）は list_query に集約（DRY・§2.3）。
_SORT_COLUMNS = {
    "name": Company.name,
    "company_code": Company.company_code,
    "created_at": Company.created_at,
}

_COMPANY_STATUSES = ("active", "suspended")


def _icon_url(path: str | None) -> str | None:
    """会社アイコンの MinIO キー→短TTL 署名URL（B.1・§1.10）。未設定は None（storage 未呼び出し）。

    presign は HMAC 計算のみ（接続しない）＝一覧の各行で呼んでも I/O は発生しない。生キーは応答に出さない。
    """
    return get_storage().presigned_get(path) if path else None


def _item(c: Company, account_count: int) -> dict:
    return {
        "company_id": str(c.id), "company_code": c.company_code, "name": c.name,
        "db_identifier": c.db_identifier, "status": c.status, "color": c.color,
        "icon_image_path": c.icon_image_path, "icon_image_url": _icon_url(c.icon_image_path),
        "account_count": account_count,
    }


def _detail(c: Company, account_count: int) -> dict:
    return {
        **_item(c, account_count),
        "mfa_required": c.mfa_required,
        "vote_anonymized": c.vote_anonymized,
        "hide_voters_from_managers": c.hide_voters_from_managers,
    }


def _account_count_expr():
    """会社あたりの有効アカウント数を SQL 集計する (subquery, coalesce 式)（ソート/範囲/表示で共用）。"""
    acc_sq = (
        select(Account.company_id.label("cid"), func.count().label("n"))
        .group_by(Account.company_id).subquery()
    )
    return acc_sq, func.coalesce(acc_sq.c.n, 0)


def _fetch_pinned(session, ids: list[uuid.UUID]) -> list[dict]:
    """ピン ID の行を絞込/ページに関係なく解決（pin 順を保持・未解決 ID は除外・§1.8.1④）。"""
    if not ids:
        return []
    acc_sq, account_count = _account_count_expr()
    rows = session.execute(
        select(Company, account_count.label("account_count"))
        .outerjoin(acc_sq, acc_sq.c.cid == Company.id).where(Company.id.in_(ids))
    ).all()
    by_id = {c.id: (c, n) for c, n in rows}
    return [_item(*by_id[i]) for i in ids if i in by_id]


def _company_query(*, q, status, sort, account_count_min, account_count_max, exclude_ids=None):
    """会社一覧の検索/フィルタ/ソートを共通適用（一覧・CSV で共有・§1.8.1①②）。

    戻り値＝(rows_stmt〔order 済み・offset/limit 未適用〕, count_stmt)。account_count は集計 subquery を
    outerjoin してソート/範囲フィルタ可能にする。未知の sort キー/enum 値はここで 422（先に検証）。
    `exclude_ids`＝固定行（ピン）を非固定母集合から除外（§1.8.1④）。
    """
    acc_sq, account_count = _account_count_expr()
    order = lq.parse_sort(sort, {**_SORT_COLUMNS, "account_count": account_count})
    statuses = lq.parse_enum(status, "status", _COMPANY_STATUSES)

    conds = []
    if statuses:  # enum 多値＝OR（IN）・§1.8.1②
        conds.append(Company.status.in_(statuses))
    if q:
        like = f"%{q}%"
        conds.append(or_(Company.name.ilike(like), Company.company_code.ilike(like),
                         Company.db_identifier.ilike(like)))
    if account_count_min is not None:  # number 範囲＝集計への WHERE・§1.8.1②
        conds.append(account_count >= account_count_min)
    if account_count_max is not None:
        conds.append(account_count <= account_count_max)
    if exclude_ids:  # 固定行は非固定母集合（data/total）から除外・§1.8.1④
        conds.append(Company.id.notin_(exclude_ids))

    def _join(stmt):
        return stmt.outerjoin(acc_sq, acc_sq.c.cid == Company.id).where(*conds)

    rows_stmt = _join(select(Company, account_count.label("account_count")))
    # 明示ソートはキー順＋末尾 id で一意化／無指定は従来の created_at,id 決定的順序（§1.8.1①）。
    rows_stmt = rows_stmt.order_by(*order, Company.id) if order else rows_stmt.order_by(Company.created_at, Company.id)
    count_stmt = _join(select(func.count()).select_from(Company))
    return rows_stmt, count_stmt


def list_companies(*, q: str | None = None, status: str | None = None, sort: str | None = None,
                   account_count_min: int | None = None, account_count_max: int | None = None,
                   pin_ids: str | None = None,
                   page: int = 1, per_page: int = lq.DEFAULT_PER_PAGE) -> dict:
    """会社一覧（SC-91・オフセット・§1.8）＋複数ソート/項目別フィルタ/固定行契約（§1.8.1①②④）。"""
    per_page = max(1, min(per_page, lq.MAX_PER_PAGE))
    page = max(1, page)
    pins = lq.parse_pin_ids(pin_ids)  # 不正形式は 422（先に検証）
    with control_session() as session:
        pinned = _fetch_pinned(session, pins)  # 絞込/ページに関係なく解決・§1.8.1④
        rows_stmt, count_stmt = _company_query(
            q=q, status=status, sort=sort,
            account_count_min=account_count_min, account_count_max=account_count_max,
            exclude_ids=pins)  # 固定行は非固定母集合から除外
        total = session.execute(count_stmt).scalar_one()
        rows = session.execute(rows_stmt.offset((page - 1) * per_page).limit(per_page)).all()
        data = [_item(c, n) for c, n in rows]
    return {"data": data, "pinned": pinned, "page_info": {"total": total, "page": page, "per_page": per_page}}


# DataTable 契約（§1.8.1③）＝CSV エクスポートの表示可能列とラベル（列順は ?columns= が正）。
_CSV_COLUMNS = {
    "name": "会社名",
    "company_code": "会社コード",
    "db_identifier": "DB識別子",
    "status": "状態",
    "account_count": "アカウント数",
}
_CSV_DEFAULT_ORDER = ["name", "company_code", "db_identifier", "status", "account_count"]


def _csv_cell(key: str, c: Company, n: int) -> str:
    return str(n) if key == "account_count" else str(getattr(c, key))


def export_companies_csv(*, q: str | None = None, status: str | None = None, sort: str | None = None,
                         account_count_min: int | None = None, account_count_max: int | None = None,
                         columns: str | None = None) -> tuple[bytes, str]:
    """会社一覧を CSV で出力（同一フィルタ/ソートの全件・§1.8.1③）。管理系＝監査対象（B.6）。"""
    keys = lq.parse_columns(columns, _CSV_COLUMNS, _CSV_DEFAULT_ORDER)
    with control_session() as session:
        rows_stmt, _ = _company_query(
            q=q, status=status, sort=sort,
            account_count_min=account_count_min, account_count_max=account_count_max)
        rows = session.execute(rows_stmt).all()  # 全件（ページング無視・§1.8.1③）
        audit.record("company.export",  # 管理系エクスポートは監査対象（§1.8.1③・B.6・同一Tx）
                     {"count": len(rows), "columns": keys}, session=session)
        session.commit()
    header = [_CSV_COLUMNS[k] for k in keys]  # ヘッダ＝表示列ラベル・列順
    body = ([_csv_cell(k, c, n) for k in keys] for c, n in rows)
    return lq.to_csv_bytes(header, body), "companies.csv"  # UTF-8 BOM（Excel 互換・§1.8.1③）


def create_company(*, name: str, company_code: str, db_identifier: str,
                   color: str | None = None, icon_image_path: str | None = None) -> dict:
    """会社作成（SC-91）。`status=suspended`（停止＝作成時点は会社DB未整備）で作成。code/db_identifier は全社一意（409）。"""
    with control_session() as session:
        clash = session.execute(
            select(Company).where(
                or_(Company.company_code == company_code, Company.db_identifier == db_identifier)
            )
        ).scalars().first()
        if clash is not None:
            field = "company_code" if clash.company_code == company_code else "db_identifier"
            raise AppError(409, "conflict", extra={"errors": [{"field": field}]})
        company = Company(
            id=uuid.uuid4(), company_code=company_code, name=name, db_identifier=db_identifier,
            status="suspended", color=color or "#6366F1", icon_image_path=icon_image_path,
        )
        session.add(company)
        audit.record("company.create",  # 監査（B.6・同一Tx）
                     {"company_id": str(company.id), "company_code": company_code}, session=session)
        session.commit()
        return _detail(company, 0)


def get_company_detail(company_id: uuid.UUID) -> dict:
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")
        count = session.execute(
            select(func.count()).select_from(Account).where(Account.company_id == company_id)
        ).scalar_one()
        return _detail(company, count)


def update_company_profile(company_id: uuid.UUID, changes: dict) -> dict:
    """会社プロフィール更新（SC-92・name/color/icon）。"""
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")
        applied = [f for f in _PROFILE_FIELDS if f in changes]
        for field in applied:
            setattr(company, field, changes[field])
        audit.record("company.update",  # 監査（B.6・同一Tx）
                     {"company_id": str(company_id), "changed_fields": applied}, session=session)
        session.commit()
        count = session.execute(
            select(func.count()).select_from(Account).where(Account.company_id == company_id)
        ).scalar_one()
        return _detail(company, count)


def set_company_icon(company_id: uuid.UUID, *, data: bytes, content_type: str) -> dict:
    """会社アイコン画像を設定（B.1・§1.10）＝管理DB companies.icon_image_path 更新＋旧オブジェクト掃除。

    /me/avatar-image（K.4）と同流儀＝非公開バケットへ物理名ハッシュで put、応答は署名URL に解決した会社詳細。
    会社アイコンは管理DB `companies` のみを触る（会社DB 未整備＝suspended でも設定可）。
    """
    validate_image_upload(content_type, len(data))
    storage = get_storage()
    key = storage.put(data, content_type, prefix="company-icons")
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")
        old = company.icon_image_path
        company.icon_image_path = key
        audit.record("company.icon_set",  # 監査（B.6・同一Tx）
                     {"company_id": str(company_id)}, session=session)
        session.commit()
        count = session.execute(
            select(func.count()).select_from(Account).where(Account.company_id == company_id)
        ).scalar_one()
        detail = _detail(company, count)
    if old and old != key:
        try:
            storage.remove(old)  # 旧画像は best-effort（失敗しても新設定は成立・整合は運用掃除）
        except Exception:
            pass
    return detail


def delete_company_icon(company_id: uuid.UUID) -> None:
    """会社アイコン画像を削除（既定＝頭文字＋会社カラーへ・B.1）。冪等。"""
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")
        old = company.icon_image_path
        company.icon_image_path = None
        audit.record("company.icon_delete",  # 監査（B.6・同一Tx）
                     {"company_id": str(company_id)}, session=session)
        session.commit()
    if old:
        try:
            get_storage().remove(old)
        except Exception:
            pass


def list_company_quest_groups(company_id: uuid.UUID) -> dict:
    """会社のクエストグループ候補一覧（system_admin・所属割当の候補・B.3）。

    会社が無ければ 404（存在秘匿）。対象会社DB `quest_groups` を列挙し、有効メンバー数を付す。
    グループ作成 EP は API 設計に未定義＝ここでは一覧のみ（プロビジョニングは別途）。
    """
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")  # 対象会社の実在（B.3・§1.6）
        db_identifier = company.db_identifier
    with get_tenant_session(db_identifier) as ts:
        groups = ts.execute(
            select(QuestGroup)
            .where(QuestGroup.deleted_at.is_(None))  # 削除済み（トゥームストーン）は除外（§5.4）
            .order_by(QuestGroup.quest_group_code)
        ).scalars().all()
        counts = dict(ts.execute(
            select(QuestGroupMember.quest_group_id, func.count())
            .where(QuestGroupMember.removed_at.is_(None))
            .group_by(QuestGroupMember.quest_group_id)
        ).all())
        data = [
            {"group_id": str(g.id), "quest_group_code": g.quest_group_code,
             "name": g.name, "member_count": counts.get(g.id, 0)}
            for g in groups
        ]
    return {"data": data}


def create_company_quest_group(company_id: uuid.UUID, *, quest_group_code: str, name: str) -> dict:
    """クエストグループを作成（system_admin・B.3・§5.4）。会社構造の変更＝会社設定と同格の権限帯。

    会社が無ければ 404。`quest_group_code` は会社内一意（会社DB 内で一意）＝重複は 409（DB 一意制約でも担保）。
    code の大文字正規化/形式検証は schema 側（`QuestGroupCreateRequest`）で実施済み。
    """
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")  # 対象会社の実在（B.3・§1.6）
        db_identifier = company.db_identifier
    with get_tenant_session(db_identifier) as ts:
        clash = ts.execute(
            select(QuestGroup).where(
                QuestGroup.quest_group_code == quest_group_code,
                QuestGroup.deleted_at.is_(None),  # 有効行のみで一意（削除後の同コード再作成を許容・§5.4）
            )
        ).scalars().first()
        if clash is not None:
            raise AppError(409, "conflict", extra={"errors": [{"field": "quest_group_code"}]})
        group = QuestGroup(id=uuid.uuid4(), quest_group_code=quest_group_code, name=name)
        ts.add(group)
        ts.commit()
        # 監査（B.6）＝会社DB 書込のため独立記録（管理DB へ append・best-effort）
        audit.record("quest_group.create", {
            "company_id": str(company_id), "group_id": str(group.id), "quest_group_code": quest_group_code,
        })
        return {"group_id": str(group.id), "quest_group_code": group.quest_group_code,
                "name": group.name, "member_count": 0}


def _active_member_count(ts, group_id: uuid.UUID) -> int:
    return ts.execute(
        select(func.count()).select_from(QuestGroupMember).where(
            QuestGroupMember.quest_group_id == group_id, QuestGroupMember.removed_at.is_(None)
        )
    ).scalar_one()


def _load_active_group(ts, group_id: uuid.UUID) -> QuestGroup:
    group = ts.execute(
        select(QuestGroup).where(QuestGroup.id == group_id, QuestGroup.deleted_at.is_(None))
    ).scalars().first()
    if group is None:
        raise AppError(404, "not_found")  # 不明/削除済みグループ（存在秘匿）
    return group


def rename_company_quest_group(company_id: uuid.UUID, group_id: uuid.UUID, *, name: str) -> dict:
    """クエストグループのリネーム（system_admin・`name` のみ・B.3.1）。`quest_group_code` は不変（安定識別子）。"""
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")
        db_identifier = company.db_identifier
    with get_tenant_session(db_identifier) as ts:
        group = _load_active_group(ts, group_id)
        group.name = name
        count = _active_member_count(ts, group_id)
        ts.commit()
        audit.record("quest_group.rename",  # 監査（B.6・独立記録）
                     {"company_id": str(company_id), "group_id": str(group_id), "name": name})
        return {"group_id": str(group.id), "quest_group_code": group.quest_group_code,
                "name": group.name, "member_count": count}


def delete_company_quest_group(company_id: uuid.UUID, group_id: uuid.UUID) -> None:
    """クエストグループの削除（system_admin・B.3.1）。**空グループのみ**＝有効所属があれば 409 `in_use`。

    方式＝トゥームストーン（`deleted_at` 設定・物理削除しない＝解除済み所属の FK と監査を保持・§5.4）。
    ※クエスト（ドメインC）の参照チェックは quests テーブル実装時にここへ追加する。
    """
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")
        db_identifier = company.db_identifier
    with get_tenant_session(db_identifier) as ts:
        group = _load_active_group(ts, group_id)
        if _active_member_count(ts, group_id) > 0:
            raise AppError(409, "conflict", extra={"errors": [{"reason": "in_use"}]})  # 空グループのみ削除可
        group.deleted_at = datetime.now(timezone.utc)  # トゥームストーン
        ts.commit()
    audit.record("quest_group.delete",  # 監査（B.6・独立記録）
                 {"company_id": str(company_id), "group_id": str(group_id)})


def update_company_settings(company_id: uuid.UUID, changes: dict) -> dict:
    """会社設定フラグ更新（SC-92）。**記名（`vote_anonymized=false`）時は `hide_voters_from_managers`
    を無効化して保存**（サーバー整合・B.1）。設定は login/表示時に DB を直参照＝キャッシュ未実装のため
    Redis `company_config` 無効化は現状 no-op（§1.14 キャッシュ導入時にここへ）。
    """
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")
        applied = [f for f in _SETTINGS_FIELDS if f in changes]
        for field in applied:
            setattr(company, field, changes[field])
        if not company.vote_anonymized:  # 記名時は投票者非開示を無効化（整合）
            company.hide_voters_from_managers = False
        audit.record("company.settings_update",  # 監査（B.6・同一Tx）
                     {"company_id": str(company_id), "changed_fields": applied}, session=session)
        session.commit()
        count = session.execute(
            select(func.count()).select_from(Account).where(Account.company_id == company_id)
        ).scalar_one()
        return _detail(company, count)
