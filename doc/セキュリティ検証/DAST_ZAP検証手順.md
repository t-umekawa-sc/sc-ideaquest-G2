# DAST（OWASP ZAP）検証手順

> 動的アプリケーションセキュリティテスト（DAST）を OWASP ZAP で実施する手順の正本。
> 位置づけ＝**既存の静的対策を実行時に検証する**。対策の元表＝[`../WEBアプリ開発時のセキュリティ対策一覧.md`](../WEBアプリ開発時のセキュリティ対策一覧.md)（コーディング規約 §2.2 が参照）／静的テスト＝[`../テスト/セキュリティ横断.md`](../テスト/セキュリティ横断.md)（SEC-TC）。DAST↔SAST は補完関係（コードレベルは `/security-review` skill と併用）。
>
> 方針合意＝2026-09-28（自動関連付け実装を優先し後追いで実施）。検査対象は**自社ステージング/ローカルのみ**。本番や共有環境へのスキャンは禁止。

## 0. 前提・現況

- **ZAP は未インストール**（2026-10-03 時点・Docker イメージ/CLI とも無し）。Docker（v29+）は利用可。→ 実行時に Docker 版 ZAP を取得する（§1）。
- アプリ起動＝`impl/` で `docker compose up`。**frontend=:3000 / backend=:8000**（frontend が `/api/v1/*` を backend にプロキシ）。**診断の入口は http://localhost:3000**。
- 認証＝**Cookie セッション ＋ ダブルサブミット CSRF**。非 httpOnly Cookie `iq_csrf` と `X-CSRF-Token` ヘッダの一致を検証（`impl/backend/app/core/deps.py` `verify_csrf`）。**Active スキャンでは両方を ZAP に載せないと 403 連発**になる（§3）。
- **Origin 許可リスト**あり（`ALLOWED_ORIGINS`＝既定 3000/8000）。状態変更系は Origin / Sec-Fetch-Site も検証。
- **マルチテナント＝会社別 DB**（他社の id は構造的に届かない）。Active では **IDOR / クロステナント越権**を重点確認。
- seed 管理者は実在（`kanri@acme` / `admin@ops` 等・`Passw0rd!`）。Active は**使い捨て垢**で行う。
- **レポートは git 追跡外**（artifacts 扱い）。出力先は `/tmp/zap-reports/` 等のリポジトリ外、または生成物を commit しない。

## 1. 準備（ZAP イメージ取得）

```bash
docker pull ghcr.io/zaproxy/zaproxy:stable
mkdir -p /tmp/zap-reports   # レポート出力先（git 外）
```

> WSL2 の Docker では `--network host` が使える。効かない場合はターゲットを `http://host.docker.internal:3000` に切り替える。

## 2. 段階① Baseline（受動スキャン・非破壊）

**まず最初にこれ**。クロールして受動検出するだけで、攻撃ペイロードは投入しない（データ改変なし）。ヘッダ/Cookie 属性/情報漏れ等を検出する。dev 環境でそのまま実行してよい。

```bash
# 2-1) スタック起動（impl/ で）
cd impl && docker compose up -d
#   workers 依存の挙動も見るなら: docker compose --profile workers up -d

# 2-2) 起動確認
curl -s -i http://localhost:8000/healthz | head

# 2-3) Baseline 実行（レポートは git 外へ）
docker run --rm --network host \
  -v /tmp/zap-reports:/zap/wrk:rw \
  ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
  -t http://localhost:3000 \
  -r baseline-report.html -w baseline-report.md
```

- 結果＝`/tmp/zap-reports/baseline-report.html` を開いて確認。
- 終了コード＝WARN/FAIL があると非 0 で返る（CI で使う想定・§4）。
- 既知の対策済み項目（応答セキュリティヘッダ §10・HSTS は TLS 時のみ 等＝SEC-TC-001/002）と突き合わせ、**誤検知 / 既知対応済み / 真の指摘**を仕分ける。

## 3. 段階② 認証付き Active（能動スキャン・攻撃投入）

> **⚠️ データを改変しうる。必ず使い捨て DB で実施する**（dev 共有 DB・本番・ステージング共有は厳禁）。

### 3.1 使い捨て環境の用意

- 専用インスタンス（別 compose プロジェクト名 or 別ポート）を立て、`acme` / `acme2` を drop → bootstrap した隔離 DB で実行する。
- ログインは **Active 専用の使い捨て垢**を使う（共有垢を使うとセッション巻き込み・ロックのリスク）。
- **ログイン試行レート制限**（IP+login_id・compose 既定 `LOGIN_RATE_LIMIT_MAX`）に注意。Active は多数リクエストを投げるため、必要ならこの env を使い捨て環境でだけ緩める。

### 3.2 ZAP への認証・CSRF 載せ込み

状態変更系を検査するには、ログイン後に取得した以下を ZAP の全リクエストに載せる。

1. **セッション Cookie**（ログインで払い出されるもの）
2. **`iq_csrf` Cookie**（非 httpOnly）
3. **`X-CSRF-Token` ヘッダ**＝`iq_csrf` と同値（ダブルサブミット）

実装方法（いずれか）:

- **ZAP Replacer ルール**で `X-CSRF-Token` ヘッダを `iq_csrf` の値で注入する（最も確実）。
- ZAP の **Authentication（Cookie/Session management）** でログインシーケンスを記録し、CSRF トークンを抽出→ヘッダに反映。
- これを載せないと `verify_csrf` で **403 `csrf_failed`** が返り、何も検査できない。

### 3.3 重点観点

- **マルチテナント IDOR / クロステナント越権**＝他社 DB のリソース id を叩いて **404 not_found**（存在しない＝構造的遮断）になるか（SEC-TC-020 の動的確認）。
- **Mass Assignment**＝サーバー制御列をクライアント入力で昇格できないか（SEC-TC-040）。
- **冪等キー**＝二重送信・キー再利用の扱い（SEC-TC-041〜044）。
- **アップロード**＝マジックバイト検証・サイズ上限（SEC-TC-010〜012）。
- 認証/認可境界・入力検証（SQLi/XSS 等の能動検出）。

### 3.4 実行例（full scan）

```bash
docker run --rm --network host \
  -v /tmp/zap-reports:/zap/wrk:rw \
  ghcr.io/zaproxy/zaproxy:stable zap-full-scan.py \
  -t http://localhost:3000 \
  -r active-report.html -w active-report.md
#   認証・CSRF 載せ込みは automation framework / context ファイルで指定する
#   （-z オプションや context yaml。Replacer ルールもここで設定）
```

> 認証付き Active は context / automation framework YAML を使うのが実務的。最初は手動で ZAP デスクトップ GUI で認証を確立 → Active Scan を回し、固まったら YAML 化して CI に載せる流れが安全。

## 4. 段階③ CI / リリースゲート

- **PR 毎**＝`zap-baseline`（非破壊）を GitHub Actions で実行。WARN/FAIL で気付けるようにする（閾値は `.zap/rules` でチューニング）。
- **本番デプロイ前**＝使い捨て環境でフル Active を 1 回。[`../本番デプロイ要件.md`](../本番デプロイ要件.md) のリリース前チェックに紐付ける。
- レポートは CI の artifacts として保存（リポジトリには commit しない）。

## 5. 対象外・注意

- **WebSocket（realtime・ドメイン L）は ZAP の WS 対応が限定的**＝自動スキャンでは十分に検査されない。**手動確認で補完**する。
- 検査は**自社ステージング/ローカルのみ**。外部公開ホストや他社テナントへのスキャンは行わない。
- 検出結果は静的対策（[`../WEBアプリ開発時のセキュリティ対策一覧.md`](../WEBアプリ開発時のセキュリティ対策一覧.md)・[`../テスト/セキュリティ横断.md`](../テスト/セキュリティ横断.md)）と突き合わせ、真の指摘は再現テスト（SEC-TC 追加）に落として恒久化する。
