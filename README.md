# ideaquest

社内のアイデア創出をゲーミフィケーション（XP／コイン／レベル／魔法／ランキング）で促す WEB アプリ（マルチテナント SaaS）。

- スタック＝フロント **Next.js**（App Router）／バック **FastAPI**（SQLAlchemy・2プレーン×縦スライス4層）／**PostgreSQL**（将来 PGroonga 全文検索）／**Redis**／**Docker**。
- リポジトリ構成＝**`doc/`＝設計**（要件定義・データモデル・API設計・画面設計・テストパターン・ADR・規約）／**`impl/`＝実装**（backend・frontend・compose）。詳細は [`doc/規約/リポジトリ構成規約.md`](doc/規約/リポジトリ構成規約.md)。

> **現在の実装状況**＝**ログイン（SC-00 状態A＝パスワードログイン）の縦スライスまで**動作。MFA・パスワード設定/再設定・他ドメインは未実装（[handoff.md](handoff.md) 参照）。

---

## 必要なもの

- Docker / Docker Compose（これだけ。Python・Node はコンテナ内で完結）

## 起動（フルスタック）

```bash
cd impl
cp .env.example .env          # 任意（既定値で動くので省略可）
docker compose up --build
```

起動すると backend が自動で **DB作成 → マイグレーション → シード**（冪等）を行ってから API を立ち上げる。

| サービス | URL / ポート | 用途 |
| --- | --- | --- |
| frontend（Next.js） | http://localhost:3000 | 画面。ログインは http://localhost:3000/login |
| backend（FastAPI） | http://localhost:8000 | API。ヘルスチェック http://localhost:8000/healthz |
| db（PostgreSQL 16） | localhost:5432 | 管理DB `ideaquest_control` ＋ 会社DB `ideaquest_company_acme` |
| redis | localhost:6379 | セッション／レート制限 等 |

ポートや資格情報は `impl/.env`（雛形＝`impl/.env.example`）で変更できる。

### 開発用ログイン情報（シード）

| 項目 | 値 |
| --- | --- |
| 会社コード | `ACME-01` |
| ログインID | `user@acme.example` |
| パスワード | `Passw0rd!` |

ログイン成功でダッシュボード（SC-01 プレースホルダ）に遷移する。

## API 仕様（OpenAPI）の確認

backend（FastAPI）が**コードから自動生成**する API 仕様を、起動中（`docker compose up`）に以下で確認できる。

| URL | 内容 |
| --- | --- |
| http://localhost:8000/docs | **Swagger UI**（対話的。ブラウザからリクエストを試せる） |
| http://localhost:8000/redoc | **ReDoc**（読み物向けの整ったリファレンス表示） |
| http://localhost:8000/openapi.json | **OpenAPI 定義そのもの**（機械可読 JSON。フロントの型生成 `npm run codegen` の入力） |

```bash
# JSON を手元で見る（パス一覧・スキーマ名を抜粋）
curl -s localhost:8000/openapi.json | python3 -m json.tool | less
```

> この OpenAPI がフロントの型（`impl/frontend/src/lib/api/schema.d.ts`）の生成元。API を変えたら型を再生成する（下記コマンド）。

## よく使うコマンド（`impl/` で実行）

```bash
# ログを追う（デバッグ）
docker compose logs -f backend
docker compose logs -f frontend

# DB/Redis だけ起動（テスト用）
docker compose up -d db redis

# バックエンドのテスト（pytest・A-TC-001〜019）
docker compose run --rm backend pytest -q

# フロントの e2e（Playwright・A-TC-020）＝フルスタック起動後に
docker compose exec frontend npx playwright install chromium   # 初回のみ
docker compose exec frontend npx playwright test

# 個別ビルド/再起動
docker compose build backend
docker compose restart backend

# フロントの型生成（backend の OpenAPI → TypeScript 型。backend 起動中に）
docker compose exec frontend npm run codegen      # src/lib/api/schema.d.ts を更新

# 停止 / 完全初期化（DB ボリュームも消す）
docker compose down
docker compose down -v
```

### DB を直接見る

```bash
docker compose exec db psql -U ideaquest -d ideaquest_control        # 管理DB
docker compose exec db psql -U ideaquest -d ideaquest_company_acme   # 会社DB(ACME)
```

## 仕組みのメモ

- **同一オリジン方針**＝ブラウザは常に `:3000` と通信し、`/api/v1/*` は Next.js の rewrite で backend にプロキシする（CORS 不要＋CSRF ダブルサブミットが同一オリジンで成立）。
- **2プレーンを実データベースで再現**＝管理DBと会社DBを同一 Postgres の別データベースにし、`companies.db_identifier` を DB 名として動的解決する。
- 詳細＝[`impl/backend/README.md`](impl/backend/README.md)（バックエンド構成・技術選定）／[`doc/規約/コーディング規約.md`](doc/規約/コーディング規約.md)（§3.4 バックエンド・§4.1 フロント）。

## ドキュメントの入口

- 要件＝[`doc/要件定義/README.md`](doc/要件定義/README.md)
- データモデル＝[`doc/データモデル.md`](doc/データモデル.md)
- API設計＝[`doc/API設計/`](doc/API設計/)（`README.md`＝全体規約＋A〜L）
- 画面設計＝[`doc/画面設計/`](doc/画面設計/)（画面API連携＝`doc/画面設計/画面API連携/`）
- テスト＝[`doc/テスト/`](doc/テスト/)（テスト規約＋ドメイン別テストパターン）
- ADR＝[`doc/ADR/`](doc/ADR/)
