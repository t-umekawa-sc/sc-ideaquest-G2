"""ドメイン N（情報インプット）の application（imperative shell・API設計 N.1/N.6）。

会社DB を動的解決（§1.5・company_id はセッション由来）→ 一覧/ワードクラウドを DTO 化して返す。
情報プールは会社（テナント）横断の知識レイヤ＝クエスト門番ではなく **会社内 active ユーザーなら閲覧可**（N.0）。
本スライスは Phase A＝読み取り経路（一覧＝DataTable サーバー委譲・ワードクラウド）のみ。登録/属性は Phase C。
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from app.control_plane.auth.orm import Company
from app.core import list_query as lq
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.storage import get_storage, validate_image_upload
from app.tenant.info import derive
from app.tenant.info import repository as repo
from app.tenant.info.schemas import (
    IMPACT_CLASS_VALUES,
    LINK_KIND_VALUES,
    LINK_TARGET_VALUES,
    PRIORITY_VALUES,
    SOURCE_VALUES,
    STATUS_VALUES,
)
from app.tenant.profile import repository as profile_repo
from app.tenant.quests.summarize import summarize_text

_MAX_TITLE = 255

_EMPTY_PAGE = {
    "data": [],
    "page_info": {"total": 0, "page": 1, "per_page": lq.DEFAULT_PER_PAGE},
    "facets": {"all": 0, "raw": 0, "curated": 0, "archived": 0},
}


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _image_url(path: str | None) -> str | None:
    """MinIO キー→短TTL 署名URL（§1.10）。未設定は None。"""
    return get_storage().presigned_get(path) if path else None


def _creator_dto(user) -> dict:
    if user is None:
        return {"user_id": "", "display_name": "", "avatar_image_url": None}
    return {
        "user_id": str(user.id),
        "display_name": user.display_name,
        "avatar_image_url": _image_url(user.avatar_image_path),
    }


def _card_dto(item, *, creator, categories, link_count, follow_up_count) -> dict:
    return {
        "id": str(item.id),
        "parent_info_id": str(item.parent_info_id) if item.parent_info_id else None,
        "title": item.title,
        "summary": item.summary,
        "status": item.status,
        "priority": item.priority,
        "source": item.source,
        "classification": item.classification,
        "scope": item.scope,
        "impact_class": item.impact_class,
        "categories": categories,
        "source_url": item.source_url,
        "due_date": item.due_date,
        "created_by": _creator_dto(creator),
        "created_at": item.created_at,
        "link_count": link_count,
        "follow_up_count": follow_up_count,
    }


def get_info_items(
    account_id: uuid.UUID,
    company_id: uuid.UUID,
    *,
    q: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    source: str | None = None,
    impact_class: str | None = None,
    roots_only: bool = False,
    sort: str | None = None,
    page: int | None = None,
    per_page: int | None = None,
) -> dict:
    """情報一覧（SC-50・N.1）＝DataTable サーバー委譲（番号ページャ・§1.8.1）。会社内 active ユーザーは閲覧可（N.0）。

    フィルタ enum（status/priority/source/impact_class）と sort キーはホワイトリスト検証（未知値は 422）。
    既定は archived 除外・新着（`-created_at`）。
    """
    statuses = lq.parse_enum(status, "status", STATUS_VALUES)
    priorities = lq.parse_enum(priority, "priority", PRIORITY_VALUES)
    sources = lq.parse_enum(source, "source", SOURCE_VALUES)
    impact_classes = lq.parse_enum(impact_class, "impact_class", IMPACT_CLASS_VALUES)

    company = _resolve_company(company_id)
    if company is None:
        return _EMPTY_PAGE
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            return _EMPTY_PAGE
        rows_stmt, count_stmt = repo.build_info_list_query(
            q=q, statuses=statuses, priorities=priorities, sources=sources,
            impact_classes=impact_classes, roots_only=roots_only,
            sort=sort,  # 未知 sort キーは 422（list_query）
        )
        total = ts.execute(count_stmt).scalar_one()
        facets = repo.status_counts(
            ts, q=q, priorities=priorities, sources=sources,
            impact_classes=impact_classes, roots_only=roots_only,
        )
        if page is None and per_page is None:
            rows = list(ts.execute(rows_stmt).scalars().all())
            eff_page, eff_per = 1, total or 1
        else:
            eff_page = max(1, page or 1)
            eff_per = max(1, min(per_page or lq.DEFAULT_PER_PAGE, lq.MAX_PER_PAGE))
            rows = list(ts.execute(rows_stmt.offset((eff_page - 1) * eff_per).limit(eff_per)).scalars().all())

        ids = [r.id for r in rows]
        link_counts = repo.link_counts_for_items(ts, ids)
        follow_counts = repo.follow_up_counts_for_items(ts, ids)
        cats = repo.categories_for_items(ts, ids)
        creators = repo.users_by_ids(ts, list({r.created_by_id for r in rows}))
        data = [
            _card_dto(
                r,
                creator=creators.get(r.created_by_id),
                categories=cats.get(r.id, []),
                link_count=link_counts.get(r.id, 0),
                follow_up_count=follow_counts.get(r.id, 0),
            )
            for r in rows
        ]
    return {"data": data, "page_info": {"total": total, "page": eff_page, "per_page": eff_per},
            "facets": facets}


def _parse_uuid(value: str, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        raise AppError(422, "validation_error", detail=f"{field} が不正です", errors=[{"field": field}])


def _thread_item_dto(item, creators) -> dict:
    u = creators.get(item.created_by_id)
    return {"id": str(item.id), "title": item.title,
            "created_by": u.display_name if u else None, "created_at": item.created_at}


def _attachment_dto(att, uploader) -> dict:
    """参考資料メタを DTO 化（N.2・§5.33）＝uploaded_by は表示用ユーザー・url は短TTL 署名（object_key 非露出）。"""
    return {
        "id": str(att.id),
        "original_name": att.original_name,
        "size_bytes": att.size_bytes,
        "mime_type": att.mime_type,
        "uploaded_by": _creator_dto(uploader),
        "uploaded_at": att.uploaded_at,
        "url": get_storage().presigned_get(att.object_key),
    }


def _detail_dto(item, *, categories, links, title_map, parent, follow_ups, creators, tokens, attachments, can) -> dict:
    return {
        "id": str(item.id),
        "parent_info_id": str(item.parent_info_id) if item.parent_info_id else None,
        "title": item.title,
        "body_html": item.body_html,
        "summary": item.summary,
        "source_url": item.source_url,
        "due_date": item.due_date,
        "status": item.status,
        "priority": item.priority,
        "source": item.source,
        "classification": item.classification,
        "scope": item.scope,
        "target_business": item.target_business,
        "impact_level": item.impact_level,
        "impact_class": item.impact_class,
        "impact_timing": item.impact_timing,
        "triaged_on": item.triaged_on,
        "triage": item.triage,
        "triage_reason": item.triage_reason,
        "categories": categories,
        "created_by": _creator_dto(creators.get(item.created_by_id)),
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        "links": [{
            "id": str(l.id), "target_type": l.target_type, "target_id": str(l.target_id),
            "target_title": title_map.get(l.target_id),
            "kind": l.kind, "origin": l.origin,
            "score": float(l.score) if l.score is not None else None,
            "rejected": l.rejected_at is not None,
        } for l in links],
        "thread": {
            "parent": _thread_item_dto(parent, creators) if parent else None,
            "follow_ups": [_thread_item_dto(f, creators) for f in follow_ups],
        },
        "tokens_top": tokens,
        "attachments": attachments,
        "can": can,
    }


def get_info_detail(account_id: uuid.UUID, company_id: uuid.UUID, info_id: str) -> dict:
    """情報詳細（SC-52・N.1）＝全属性＋categories＋links〔target_title 解決〕＋thread＋tokens_top＋can。

    会社内 active ユーザーは閲覧可（N.0）。不在/他テナントは 404（存在秘匿）。`can` はサーバー算出
    （内容=作成者／キュレーション=curator／リンク=全員）＝フロントは反映のみ・変更系で再検証。
    """
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(info_id, field="info_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        item = repo.get_info_item(ts, iid)
        if item is None:
            raise AppError(404, "not_found")
        categories = repo.categories_for_items(ts, [item.id]).get(item.id, [])
        links = repo.links_for_item(ts, item.id)
        title_map = repo.resolve_link_titles(ts, links)
        # 続報スレッドは「根」基準で組む（続報を開いても 根→続報1→続報2… の全体を返す・SC-50 §80）。
        # 続報はフラット（通常 depth-1）だが安全に上限付きで根を辿る。
        root = item
        _seen = {root.id}
        while root.parent_info_id is not None:
            p = repo.get_info_item(ts, root.parent_info_id)
            if p is None or p.id in _seen:
                break
            _seen.add(p.id)
            root = p
        follow_ups = repo.follow_up_items(ts, root.id)
        parent = root if item.id != root.id else None  # 開いているのが続報のとき root を「元情報」として返す
        atts = repo.list_attachments(ts, item.id)
        uids = {item.created_by_id} | {f.created_by_id for f in follow_ups} | {a.uploaded_by_id for a in atts}
        if parent:
            uids.add(parent.created_by_id)
        creators = repo.users_by_ids(ts, list(uids))
        tokens = repo.tokens_top(ts, item.id, limit=30)
        attachments = [_attachment_dto(a, creators.get(a.uploaded_by_id)) for a in atts]
        can = {
            "edit_content": item.created_by_id == user.id,  # 内容＝作成者のみ（status 非依存）
            "curate": repo.is_curator(ts, user.id),          # 属性/triage/status/archive＝curator
            "add_link": True,                                # 関連リンク＝会社内 active 全員
        }
        return _detail_dto(item, categories=categories, links=links, title_map=title_map,
                           parent=parent, follow_ups=follow_ups, creators=creators, tokens=tokens,
                           attachments=attachments, can=can)


def create_info_item(account_id: uuid.UUID, company_id: uuid.UUID, *, body) -> dict:
    """低摩擦登録／続報登録（SC-51・N.2）＝全ユーザー・status=raw。

    保存時に **body_html サニタイズ→body_text 派生→要約 summary→info_tokens 再生成**（同期・§12）。
    `parent_info_id` 指定時は親の未棄却リンクを `origin=auto` でスナップショット複製（§12-1）。返却＝作成した詳細 DTO。
    """
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    title = (body.title or "").strip()
    if not title:
        raise AppError(422, "validation_error", detail="タイトルは必須です", errors=[{"field": "title"}])
    if len(title) > _MAX_TITLE:
        raise AppError(422, "validation_error", detail="タイトルが長すぎます", errors=[{"field": "title"}])
    if not derive.is_valid_source_url(body.source_url):
        raise AppError(422, "validation_error", detail="出典URLは http/https のみです", errors=[{"field": "source_url"}])
    parent_uuid = _parse_uuid(body.parent_info_id, field="parent_info_id") if body.parent_info_id else None

    # 派生（外部送信ゼロ・オフライン）。サニタイズ→平文→要約→トークン。
    body_html = derive.sanitize_html(body.body_html)
    body_text = derive.to_plain_text(body_html)
    summary = summarize_text(body_text) if body_text else None
    tokens = derive.extract_tokens(body_text)

    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        if parent_uuid is not None and repo.get_info_item(ts, parent_uuid) is None:
            raise AppError(422, "validation_error", detail="親情報が見つかりません", errors=[{"field": "parent_info_id"}])
        item = repo.create_info_item(
            ts, created_by_id=user.id, title=title, body_html=body_html or None,
            body_text=body_text or None, summary=summary, source_url=(body.source_url or None),
            parent_info_id=parent_uuid,
        )
        ts.flush()
        repo.replace_tokens(ts, item.id, tokens)
        if parent_uuid is not None:
            repo.snapshot_parent_links(ts, parent_uuid, item.id)  # 親の未棄却リンクを auto 複製（§12-1）
        ts.commit()
        new_id = item.id
    # 作成直後の詳細（作成者視点＝can.edit_content=true）を返す。
    return get_info_detail(account_id, company_id, str(new_id))


def rehost_image(account_id: uuid.UUID, company_id: uuid.UUID, *, data: bytes, content_type: str) -> dict:
    """貼付画像を自社ホスト（MinIO）へ再ホスト（SC-51・N.2・§12-4/§N.7）＝会社内 active 全員。

    マジックバイト検証（§1.10・validate_image_upload 共用）→ 保存 → 短TTL 署名URL を返す。
    外部 `img src` を持ち込まない（トラッキング/referer 漏れ防止）ためエディタが返却 URL に置換する。
    """
    validate_image_upload(content_type, data)  # MIME allowlist＋サイズ＋シグネチャ（申告を信用しない）
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        if profile_repo.get_user_by_account(ts, account_id) is None:
            raise AppError(401, "unauthenticated")  # 会社内 active ユーザーのみ（N.0）
    storage = get_storage()
    key = storage.put(data, content_type, prefix="info-images")
    return {"url": storage.presigned_get(key)}


_MAX_INFO_ATTACHMENTS = 10  # 1情報あたり参考資料の上限（idea 添付＝§5.12 と同値）


def add_attachments(account_id: uuid.UUID, company_id: uuid.UUID, info_id: str, *, files) -> dict:
    """参考資料を追加（SC-51/SC-52・N.2・§5.33）＝内容群＝**作成者のみ**（curator も不可）・multipart。

    files＝[(filename, data)]。全ファイルを先に検証（不正1件で保存しない）→ 件数上限（既存＋今回≤10）→
    MinIO put＋DB 記帳。返り値＝追加後の参考資料一覧（DTO）。
    """
    from app.infra.storage import validate_attachment_upload

    iid = _parse_uuid(info_id, field="info_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    if not files:
        raise AppError(422, "validation_error", detail="ファイルがありません", errors=[{"field": "files", "code": "empty"}])
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        item = repo.get_info_item(ts, iid)
        if item is None:
            raise AppError(404, "not_found")
        if item.created_by_id != user.id:  # 参考資料＝内容群（作成者のみ・N.0）
            raise AppError(403, "forbidden", detail="参考資料は作成者のみ編集できます")
        # 先に全件検証（不正で部分保存しない）＝拡張子 allowlist・サイズ・非空・マジックバイト。mime は拡張子から導出。
        validated = [(fn, data, validate_attachment_upload(fn, data)) for (fn, data) in files]
        if repo.count_attachments(ts, item.id) + len(validated) > _MAX_INFO_ATTACHMENTS:
            raise AppError(422, "validation_error", detail=f"参考資料は1情報{_MAX_INFO_ATTACHMENTS}件までです",
                           errors=[{"field": "files", "code": "too_many"}])
        storage = get_storage()
        for fn, data, mime in validated:
            key = storage.put(data, mime, prefix="info-attachments")
            repo.add_attachment(ts, info_item_id=item.id, object_key=key, original_name=fn,
                                size_bytes=len(data), mime_type=mime, uploaded_by_id=user.id)
        ts.flush()
        atts = repo.list_attachments(ts, item.id)
        creators = repo.users_by_ids(ts, [a.uploaded_by_id for a in atts])
        result = {"attachments": [_attachment_dto(a, creators.get(a.uploaded_by_id)) for a in atts]}
        ts.commit()
    return result


def remove_attachment(account_id: uuid.UUID, company_id: uuid.UUID, info_id: str, attachment_id: str) -> None:
    """参考資料を削除（N.2・§5.33）＝作成者のみ。DB 行削除＋MinIO オブジェクト削除（同一 UoW）。"""
    iid = _parse_uuid(info_id, field="info_id")
    aid = _parse_uuid(attachment_id, field="attachment_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        item = repo.get_info_item(ts, iid)
        if item is None:
            raise AppError(404, "not_found")
        if item.created_by_id != user.id:
            raise AppError(403, "forbidden", detail="参考資料は作成者のみ編集できます")
        att = repo.get_attachment(ts, aid)
        if att is None or att.info_item_id != item.id:
            raise AppError(404, "not_found")
        key = att.object_key
        repo.remove_attachment(ts, att)
        ts.flush()
        get_storage().remove(key)  # 失敗時は例外で UoW ロールバック（DB 行は残る）
        ts.commit()


_CONTENT_FIELDS = {"title", "body_html", "source_url"}
_CURATION_FIELDS = {
    "priority", "source", "classification", "scope", "target_business", "impact_level",
    "impact_class", "impact_timing", "triaged_on", "triage", "triage_reason", "due_date", "categories",
}


def _parse_date(value: str | None, field: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        raise AppError(422, "validation_error", detail="日付が不正です", errors=[{"field": field}])


def update_info_item(account_id: uuid.UUID, company_id: uuid.UUID, info_id: str, *, body) -> dict:
    """情報の部分更新（SC-52/SC-51・N.2）。内容＝作成者のみ／キュレーション＝curator のみ（越権 403）。

    内容変更時は サニタイズ→body_text→要約→トークン再生成＋**内容の版スナップショット**を記録（§12）。
    キュレーション（属性/triage/categories）を付けると `status=raw→curated`。
    """
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(info_id, field="info_id")
    provided = set(body.model_fields_set)
    content = provided & _CONTENT_FIELDS
    curation = provided & _CURATION_FIELDS
    if "title" in content and (body.title is None or not body.title.strip()):
        raise AppError(422, "validation_error", detail="タイトルは必須です", errors=[{"field": "title"}])
    if "source_url" in content and not derive.is_valid_source_url(body.source_url):
        raise AppError(422, "validation_error", detail="出典URLは http/https のみです", errors=[{"field": "source_url"}])

    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        item = repo.get_info_item(ts, iid)
        if item is None:
            raise AppError(404, "not_found")
        # 認可＝内容は作成者のみ／キュレーションは curator のみ（フィールド群でオーナーが違う・N.0）。
        if content and item.created_by_id != user.id:
            raise AppError(403, "forbidden", detail="内容の編集は作成者のみです")
        if curation and not repo.is_curator(ts, user.id):
            raise AppError(403, "forbidden", detail="属性の編集は情報判定権限（info_curator）が必要です")

        if content:
            if "title" in content:
                item.title = body.title.strip()
            if "body_html" in content:
                item.body_html = derive.sanitize_html(body.body_html) or None
                item.body_text = derive.to_plain_text(item.body_html) or None
                item.summary = summarize_text(item.body_text) if item.body_text else None
                repo.replace_tokens(ts, item.id, derive.extract_tokens(item.body_text or ""))
            if "source_url" in content:
                item.source_url = body.source_url or None
            # 内容の版スナップショット（判定後も追跡できるよう毎回の内容変更で1版・§12）。
            repo.add_revision(ts, item.id, user.id,
                              {"title": item.title, "body_html": item.body_html, "source_url": item.source_url})

        if curation:
            for f in ("priority", "source", "classification", "scope", "target_business",
                      "impact_level", "impact_class", "impact_timing", "triage", "triage_reason"):
                if f in curation:
                    setattr(item, f, getattr(body, f) or None)
            if "triaged_on" in curation:
                item.triaged_on = _parse_date(body.triaged_on, "triaged_on")
            if "due_date" in curation:
                item.due_date = _parse_date(body.due_date, "due_date")
            if "categories" in curation and body.categories is not None:
                repo.replace_categories(ts, item.id, body.categories)
            if item.status == "raw":
                item.status = "curated"  # curator が属性を付与＝判定済みへ

        item.updated_at = datetime.now(timezone.utc)
        ts.commit()
    return get_info_detail(account_id, company_id, info_id)


def archive_info_item(account_id: uuid.UUID, company_id: uuid.UUID, info_id: str) -> dict:
    """アーカイブ（論理削除・N.2）＝curator のみ。`status=archived`＋`archived_at`。物理削除しない（監査保持）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(info_id, field="info_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        item = repo.get_info_item(ts, iid)
        if item is None:
            raise AppError(404, "not_found")
        if not repo.is_curator(ts, user.id):
            raise AppError(403, "forbidden", detail="アーカイブは情報判定権限（info_curator）が必要です")
        if item.status != "archived":  # 冪等（既にアーカイブ済なら no-op）
            item.status = "archived"
            item.archived_at = datetime.now(timezone.utc)
            item.updated_at = item.archived_at
            ts.commit()
    return get_info_detail(account_id, company_id, info_id)


def unarchive_info_item(account_id: uuid.UUID, company_id: uuid.UUID, info_id: str) -> dict:
    """アーカイブ解除（N.2）＝curator のみ。`status` を curated（キュレーション属性があれば）or raw へ戻し `archived_at`=NULL。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(info_id, field="info_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        item = repo.get_info_item(ts, iid)
        if item is None:
            raise AppError(404, "not_found")
        if not repo.is_curator(ts, user.id):
            raise AppError(403, "forbidden", detail="アーカイブ解除は情報判定権限（info_curator）が必要です")
        if item.status == "archived":
            has_cat = bool(repo.categories_for_items(ts, [item.id]).get(item.id))
            curated = has_cat or any((item.priority, item.source, item.classification, item.scope,
                                      item.target_business, item.impact_level, item.impact_class,
                                      item.impact_timing, item.triage, item.triaged_on))
            item.status = "curated" if curated else "raw"
            item.archived_at = None
            item.updated_at = datetime.now(timezone.utc)
            ts.commit()
    return get_info_detail(account_id, company_id, info_id)


def delete_info_item(account_id: uuid.UUID, company_id: uuid.UUID, info_id: str) -> None:
    """未判定（raw）の物理削除（N.2）＝**登録者本人のみ**（casual 登録の取消）。curated 済みは 409（archive へ誘導）。

    続報（子）がある場合は 409（孤児化を防ぐ）。従属行を削除し、参考資料の MinIO オブジェクトも除去する。
    """
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(info_id, field="info_id")
    keys: list[str] = []
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        item = repo.get_info_item(ts, iid)
        if item is None:
            raise AppError(404, "not_found")
        if item.created_by_id != user.id:
            raise AppError(403, "forbidden", detail="削除できるのは登録者本人のみです")
        if item.status != "raw":
            raise AppError(409, "conflict", detail="判定済みの情報は削除できません（アーカイブしてください）",
                           errors=[{"reason": "invalid_state"}])
        if repo.follow_up_items(ts, iid):
            raise AppError(409, "conflict", detail="続報があるため削除できません",
                           errors=[{"reason": "has_follow_ups"}])
        keys = repo.delete_info_item(ts, iid)
        ts.commit()
    storage = get_storage()
    for k in keys:  # DB コミット後に MinIO 実体を除去（best-effort）。
        try:
            storage.remove(k)
        except Exception:
            pass


# ---- 情報判定権限（info_curator）の付与/剥奪（N.5・会社アカウント管理者/system_admin）------------

def list_info_curators(company_id: uuid.UUID) -> dict:
    """情報判定権限の一覧（N.5）＝未剥奪のみ。account_id で識別（管理面＝会社アカウント管理に同居）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        return {"data": repo.list_curators(ts)}


def grant_info_curator(actor_account_id: uuid.UUID, company_id: uuid.UUID, target_account_id: str) -> dict:
    """情報判定権限を付与（N.5）＝対象は会社内アカウント（account_id→会社DB ユーザーに解決）。二重付与は 409。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    tid = _parse_uuid(target_account_id, field="account_id")
    with get_tenant_session(company.db_identifier) as ts:
        target = profile_repo.get_user_by_account(ts, tid)
        if target is None:
            raise AppError(404, "not_found")  # 会社にいない account は存在秘匿（404）
        if repo.is_curator(ts, target.id):
            raise AppError(409, "conflict", detail="既に情報判定権限が付与されています")
        actor = profile_repo.get_user_by_account(ts, actor_account_id)  # 付与者（会社DB ミラー・無ければ NULL）
        repo.grant_curator(ts, target.id, actor.id if actor else None)
        ts.commit()
        return {"data": repo.list_curators(ts)}


def revoke_info_curator(company_id: uuid.UUID, target_account_id: str) -> None:
    """情報判定権限を剥奪（N.5・論理＝revoked_at）。対象が会社にいない/未付与でも 404。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    tid = _parse_uuid(target_account_id, field="account_id")
    with get_tenant_session(company.db_identifier) as ts:
        target = profile_repo.get_user_by_account(ts, tid)
        if target is None:
            raise AppError(404, "not_found")
        if not repo.revoke_curator(ts, target.id):
            raise AppError(404, "not_found")  # 未付与＝存在しない権限（冪等ではなく明示）
        ts.commit()


# ---- 関連リンク（/info-links・N.3・情報側＝会社内 active 全員）------------------

def _link_dto(link, title: str | None) -> dict:
    return {
        "id": str(link.id), "target_type": link.target_type, "target_id": str(link.target_id),
        "target_title": title, "kind": link.kind, "origin": link.origin,
        "score": float(link.score) if link.score is not None else None,
        "rejected": link.rejected_at is not None,
    }


def _notify_refuting(company_id: uuid.UUID, actor_account_id: uuid.UUID, *,
                     target_type: str, target_id: uuid.UUID, info_title: str) -> None:
    """反証（refuting）提示の「揺さぶり」通知（§N.6・通知のみ MVP）＝post-commit・best-effort。

    宛先＝成果物の作成者/所有者＋評価者（投票者）＋クエスト管理者（owner/quest_admin）。actor は除外。
    ideas→`ref_idea_id`／quests→`ref_quest_id`。concepts/assumptions（未実装ドメイン）は宛先なし＝no-op。
    """
    from app.tenant.ideas import repository as ideas_repo
    from app.tenant.notifications import service as notify_svc
    from app.tenant.quests import repository as quests_repo

    def _build(ts):
        actor = profile_repo.get_user_by_account(ts, actor_account_id)
        actor_uid = actor.id if actor else None
        recipients: set[uuid.UUID] = set()
        refs: dict = {}
        if target_type == "ideas":
            idea = ideas_repo.get_idea(ts, target_id)
            if idea is None:
                return []
            recipients |= {idea.author_id}
            recipients |= ideas_repo.voter_ids(ts, target_id)              # 評価者（投票者）
            recipients |= quests_repo.admin_user_ids(ts, idea.quest_id)    # クエスト管理者（owner/quest_admin）
            refs = {"ref_idea_id": target_id}
        elif target_type == "quests":
            recipients |= quests_repo.admin_user_ids(ts, target_id)        # 所有者＋quest_admin
            refs = {"ref_quest_id": target_id}
        else:
            return []  # concepts/assumptions は未実装＝宛先なし
        recipients.discard(actor_uid)  # 反証を付けた本人には通知しない
        params = {"actor_name": actor.display_name if actor else None, "info_title": info_title}
        return [notify_svc.entry(r, "info_refuting_raised", refs=refs, params=params) for r in recipients if r]

    notify_svc.dispatch(company_id, _build)


def add_link(account_id: uuid.UUID, company_id: uuid.UUID, *, body) -> dict:
    """手動リンク追加（SC-52・N.3）＝会社内 active 全員・origin=manual。`refuting` は揺さぶり通知を発火（§N.6）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    if body.target_type not in LINK_TARGET_VALUES:
        raise AppError(422, "validation_error", detail="target_type が不正です", errors=[{"field": "target_type"}])
    kind = body.kind or "related"
    if kind not in LINK_KIND_VALUES:
        raise AppError(422, "validation_error", detail="kind が不正です", errors=[{"field": "kind"}])
    info_id = _parse_uuid(body.info_item_id, field="info_item_id")
    target_id = _parse_uuid(body.target_id, field="target_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        if repo.get_info_item(ts, info_id) is None:
            raise AppError(422, "validation_error", detail="情報が見つかりません", errors=[{"field": "info_item_id"}])
        if repo.find_link(ts, info_id, body.target_type, target_id) is not None:
            raise AppError(409, "conflict", detail="既に関連付け済みです")
        link = repo.create_link(ts, info_item_id=info_id, target_type=body.target_type,
                                target_id=target_id, kind=kind, origin="manual")
        ts.flush()
        title = repo.resolve_link_titles(ts, [link]).get(target_id)
        dto = _link_dto(link, title)
        info_item = repo.get_info_item(ts, info_id)
        info_title = info_item.title if info_item else ""
        ts.commit()
    if kind == "refuting":  # 反証で起票＝post-commit で揺さぶり通知（§N.6）
        _notify_refuting(company_id, account_id, target_type=body.target_type,
                         target_id=target_id, info_title=info_title)
    return dto


def _mutate_link(account_id, company_id, link_id, mutate) -> dict:
    """リンクの取得→変更→DTO 返却の共通処理（種別変更/棄却/解除）。不在は 404。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    lid = _parse_uuid(link_id, field="link_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        link = repo.get_link(ts, lid)
        if link is None:
            raise AppError(404, "not_found")
        mutate(link)
        title = repo.resolve_link_titles(ts, [link]).get(link.target_id)
        dto = _link_dto(link, title)
        ts.commit()
    return dto


def change_link_kind(account_id: uuid.UUID, company_id: uuid.UUID, link_id: str, *, kind: str) -> dict:
    """種別変更（関連↔裏付け↔反証・N.3）。related/supporting→`refuting` への遷移で揺さぶり通知を発火（§N.6）。"""
    if kind not in LINK_KIND_VALUES:
        raise AppError(422, "validation_error", detail="kind が不正です", errors=[{"field": "kind"}])
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    lid = _parse_uuid(link_id, field="link_id")
    fire = False
    target_type = target_id = info_title = None
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        link = repo.get_link(ts, lid)
        if link is None:
            raise AppError(404, "not_found")
        # refuting への遷移のみ通知（既に refuting は再通知しない）。棄却済みは揺さぶらない。
        fire = kind == "refuting" and link.kind != "refuting" and link.rejected_at is None
        target_type, target_id = link.target_type, link.target_id
        link.kind = kind
        title = repo.resolve_link_titles(ts, [link]).get(link.target_id)
        dto = _link_dto(link, title)
        if fire:
            info_item = repo.get_info_item(ts, link.info_item_id)
            info_title = info_item.title if info_item else ""
        ts.commit()
    if fire:
        _notify_refuting(company_id, account_id, target_type=target_type,
                         target_id=target_id, info_title=info_title or "")
    return dto


def reject_link(account_id: uuid.UUID, company_id: uuid.UUID, link_id: str) -> dict:
    """棄却（rejected_at セット・行は残す・再計算で復活しない・N.3/§N.6）。"""
    return _mutate_link(account_id, company_id, link_id,
                        lambda l: setattr(l, "rejected_at", datetime.now(timezone.utc)))


def unreject_link(account_id: uuid.UUID, company_id: uuid.UUID, link_id: str) -> dict:
    """棄却の取消（rejected_at を NULL）。"""
    return _mutate_link(account_id, company_id, link_id, lambda l: setattr(l, "rejected_at", None))


def get_link_candidates(account_id: uuid.UUID, company_id: uuid.UUID, *,
                        types: list[str], q: str | None,
                        quest_ids: list[str] | None = None, statuses: list[str] | None = None,
                        due_from: str | None = None, due_to: str | None = None,
                        limit: int = 20, cursor: str | None = None) -> dict:
    """リンク候補の検索（対象ピッカー・SC-52・N.3）＝会社内 active ユーザー。
    種類横断（ideas/quests）でタイトル検索＋文脈メタ＋クエスト/状態/期限で絞込＋ページング。"""
    for t in types:
        if t not in LINK_TARGET_VALUES:
            raise AppError(422, "validation_error", detail="types が不正です", errors=[{"field": "types"}])
    # cursor＝offset の文字列表現（不正は 0 扱い＝壊さない）。
    offset = 0
    if cursor:
        try:
            offset = max(0, int(cursor))
        except ValueError:
            offset = 0
    qids: list[uuid.UUID] = []
    for qid in (quest_ids or []):
        try:
            qids.append(uuid.UUID(qid))
        except (ValueError, AttributeError):
            continue  # 不正な id は無視（絞込がゆるくなるだけ）
    company = _resolve_company(company_id)
    if company is None:
        return {"candidates": [], "next_cursor": None}
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            return {"candidates": [], "next_cursor": None}
        cands, has_more = repo.search_link_candidates(
            ts, types=types, q=q or "", quest_ids=qids, statuses=statuses or [],
            due_from=due_from, due_to=due_to, limit=limit, offset=offset)
    return {"candidates": cands, "next_cursor": str(offset + limit) if has_more else None}


def get_word_cloud(account_id: uuid.UUID, company_id: uuid.UUID, *, limit: int = 40) -> dict:
    """ワードクラウド（SC-50・N.6・§5.36）＝保存済みトークンの頻度集計（archived 除外・count 降順）。"""
    if limit < 1:
        raise AppError(422, "validation_error", detail="limit が不正です", errors=[{"field": "limit"}])
    limit = min(limit, 200)
    company = _resolve_company(company_id)
    if company is None:
        return {"tokens": []}
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            return {"tokens": []}
        tokens = repo.word_cloud(ts, limit=limit)
    return {"tokens": tokens}
