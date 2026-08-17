# ideaquest backend

FastAPI＋SQLAlchemy（同期）＋Alembic＋Redis。骨格の正＝`doc/規約/コーディング規約.md` §3.4（2プレーン×縦スライス4層）。
値の決定＝`doc/ADR/ADR-0001_認証・セッション基本パラメータ.md`。

## 現在の到達点（Chunk 1＋2＋3）

- `compose.yaml` で **Postgres＋Redis＋backend** が起動する。
- 起動時に `scripts/bootstrap.py` が **管理DB／会社DB を作成→Alembic マイグレーション→シード**（冪等）。
- `GET /healthz` が DB・Redis 疎通を返す。
- **認証エンドポイント**＝`POST /api/v1/auth/login`・`GET /api/v1/auth/session`・`POST /api/v1/auth/logout`（4層＝router→application→domain→repository）。
- **テスト**＝`doc/テスト/A_認証.md` の A-TC-001〜019 を pytest 実装（`tests/auth/`・全緑）。
- フロント（SC-00）と e2e（A-TC-020）は Chunk 4。

## 実行（`impl/` ディレクトリで）

```bash
cd impl
docker compose up --build        # db + redis + mailhog + backend + frontend が起動（常駐ワーカは除く）
curl localhost:8000/healthz      # {"status":"ok","checks":{"db":true,"redis":true}}

# 非同期パイプライン（account_sync / mail_outbox の常駐ワーカ）込みで起動する場合:
docker compose --profile workers up --build   # worker / mail-worker も起動
```

> 常駐ワーカ（`worker` / `mail-worker`）は compose の profile `workers` に隔離してある（既定 `up` では起動しない）。
> 両ワーカは共有 control DB の `*_outbox` を real sender で drain するため、backend の pytest（プロセス内
> `FakeMailSender` で同じ `mail_outbox` を drain）と同時稼働すると mail 系 TC がフレーク化する。よって
> **backend pytest は `--profile workers` を有効にしないまま**回すこと（下記テスト手順は既定どおりワーカ無し）。
>
> 逆に、**非同期を要する frontend e2e は `docker compose --profile workers up -d` が必要**＝`sc-00-mfa`/
> `sc-00-password-setup` は OTP/設定リンクの MailHog 配信（`mail-worker`）に、`sc-90` のディレクトリ参加追加は
> 会社DB users ミラー（`account_sync worker`）に依存する。ワーカ非依存の e2e（`sc-91` 等）は既定の `up` でも通る。

シード（開発用ログイン情報）＝会社コード `ACME-01` / ログインID `user@acme.example` / PW `Passw0rd!`（会社は `mfa_required=false`）。

## テスト

```bash
cd impl
docker compose up -d db redis
docker compose run --rm backend pytest -q     # bootstrap 後に pytest（A-TC-001〜019）
```

TC-ID（例 `A-TC-003`）でテスト関数と `doc/テスト/A_認証.md` の行が対で辿れる（トレーサビリティ＝テスト規約 §1）。

## 技術選定メモ

- **同期スタック（sync SQLAlchemy＋psycopg3）を採用**。理由＝スライスの目的が「ログインが動く＋テストが緑＋読んで理解できる」であり、トランザクション・ロールバックによるテスト隔離が単純で堅牢。将来 async へ移行しても4層構造は不変（router/application/domain/repository の分離を保つ）。
- **2プレーンは実データベースで再現**＝管理DBと会社DBを同一 Postgres サーバの別データベースにし、`companies.db_identifier` を DB 名として `app/db/tenant.get_tenant_session()` で解決（§1.5 動的ルーティングを最初から通す）。

## ディレクトリ（コーディング規約 §3.4＝2プレーン × 縦スライス4層）

```
app/
  main.py                 FastAPI 生成・ルータ登録・ミドルウェア
  worker.py               outbox ワーカ起動点（別プロセス・現状プレースホルダ）
  core/                   config / security(Argon2id・セッション・CSRF・レート制限) / errors(RFC7807) / deps(認可ガード)
  db/                     base(Base別) / control(管理DB) / tenant(get_tenant_session)
  infra/                  cache(Redis)   ※将来 storage(MinIO)/mail
  control_plane/          ★管理DB系
    auth/                 router / schemas / application / domain/service / repository / orm
  tenant/                 ★会社DB系
    profile/              orm(users ミラー) / repository   ※router は K スライスで
migrations/{control,company}/   Alembic（プレーン別）
scripts/bootstrap.py            DB作成→マイグレーション→シード（ops）
tests/auth/                     A-TC-001〜019
```

各モジュールは §3.1 の4層を内包＝`router.py`→`application.py`→`domain/`→`repository.py`（＋`orm.py`）。

