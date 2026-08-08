# ideaquest backend

FastAPI＋SQLAlchemy（同期）＋Alembic＋Redis。骨格の正＝`doc/規約/コーディング規約.md` §3.4（2プレーン×縦スライス4層）。
値の決定＝`doc/ADR/ADR-0001_認証・セッション基本パラメータ.md`。

## 現在の到達点（Chunk 1＝起動骨格）

- `compose.yaml` で **Postgres＋Redis＋backend** が起動する。
- 起動時に `scripts/bootstrap.py` が **管理DB／会社DB を作成→Alembic マイグレーション→シード**（冪等）。
- `GET /healthz` が DB・Redis 疎通を返す。
- **認証エンドポイント（`/api/v1/auth/*`）とテストは Chunk 2 以降**。

## 実行（リポジトリ直下で）

```bash
docker compose up --build        # db + redis + backend が起動
curl localhost:8000/healthz      # {"status":"ok","checks":{"db":true,"redis":true}}
```

シード（開発用ログイン情報）＝会社コード `ACME-01` / ログインID `user@acme.example` / PW `Passw0rd!`（会社は `mfa_required=false`）。

## 技術選定メモ

- **同期スタック（sync SQLAlchemy＋psycopg3）を採用**。理由＝スライスの目的が「ログインが動く＋テストが緑＋読んで理解できる」であり、トランザクション・ロールバックによるテスト隔離が単純で堅牢。将来 async へ移行しても4層構造は不変（router/application/domain/repository の分離を保つ）。
- **2プレーンは実データベースで再現**＝管理DBと会社DBを同一 Postgres サーバの別データベースにし、`companies.db_identifier` を DB 名として `app/core/db.get_tenant_session()` で解決（§1.5 動的ルーティングを最初から通す）。

## ディレクトリ（縦スライス4層・随時追加）

```
app/
  core/        config / db(control+tenant) / redis / security
  models/      control(accounts,companies) / company(users)
  routers/     （Chunk 2）auth ルータ
  application/ （Chunk 2）ユースケース
  domain/      （Chunk 2）純粋ロジック
  repository/  （Chunk 2）DB アクセス
migrations/
  control/     管理DB マイグレーション
  company/     会社DB マイグレーション
scripts/
  bootstrap.py 作成→マイグレーション→シード
```
