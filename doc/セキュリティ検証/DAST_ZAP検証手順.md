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

## 5. 役割分担（狙った試験 vs ZAP）

「期待値が分かっている＝結果を狙った試験」と「狙いの定まらない探索」は担い手を分ける。重複して ZAP に仕様アサートを書くのは**非推奨**（遅い・非決定的・TC-ID で追跡できない）。

> **期待値が言える → テストコード（原則 api、ブラウザ強制のみ e2e）。期待値が言えない／面で探す／実構成の裏取り → ZAP。**

- **期待値を表明する試験（本籍＝テストコード）** — CSRF 欠落→403・他社 id→404（IDOR）・Mass Assignment→422・応答ヘッダ付与・本番 `/docs`→404 等。[`../テスト/セキュリティ横断.md`](../テスト/セキュリティ横断.md) の SEC-TC として、設計書に TC-ID で紐付けて恒久化する（正＝[`../規約/テスト規約.md`](../規約/テスト規約.md)）。
  - **原則 api 層（pytest）**＝ステータスコード/認可/IDOR/Mass Assignment/冪等キー/応答ヘッダ。backend 契約を直接叩けて速く決定的。
  - **e2e（Playwright）はブラウザが実際に強制する対策のみ**＝CSP が実スクリプトをブロック・Cookie 属性がワイヤ上で有効・clickjacking（frame-ancestors）・SameSite 遷移挙動。api で表現できるものを e2e に上げない（共有DBで非冪等/フレーク傾向のため）。
- **ZAP に残すもの（テストコードが苦手な領域）** — ①未知の発見（想定外の注入点/漏れを面で探す＝スキャナ本来の価値）／②実行時構成・デプロイ差の裏取り（テストは通るが実バイナリ/実構成でヘッダが落ちている等）／③全エンドポイントの Cookie 属性・漏れの横断受動チェック。
- まとめ＝ZAP は「設計・SEC-TC で担保した対策が**実稼働でも崩れていない**ことの外形確認」と「**未知の探索**」に限定する。仕様通りかの第一義的な証明は 設計書 → SEC-TC → コード のトレーサビリティ側が担う。

## 6. 対象外・注意

- **WebSocket（realtime・ドメイン L）は ZAP の WS 対応が限定的**＝スパイダー/アクティブスキャンが WS を自動駆動できない（WebSockets アドオンで手動の傍受/再送/ファジングは可能）。検証手段とツールの切り分けは §7。
- 検査は**自社ステージング/ローカルのみ**。外部公開ホストや他社テナントへのスキャンは行わない。
- 検出結果は静的対策（[`../WEBアプリ開発時のセキュリティ対策一覧.md`](../WEBアプリ開発時のセキュリティ対策一覧.md)・[`../テスト/セキュリティ横断.md`](../テスト/セキュリティ横断.md)）と突き合わせ、真の指摘は再現テスト（SEC-TC 追加）に落として恒久化する。

## 7. WebSocket（realtime・L）の検証手段

ZAP の WS 自動スキャンが弱いぶん、**WS だけ目的別ツールで補完**する。既存の WS 向け SEC/TC は pytest 側に揃っている（`tests/realtime/test_ws.py`・`test_ws_chat.py`＝L-TC-101 未認証拒否／L-TC-131 不正 Origin／L-TC-105 クロステナント／L-TC-112 非メンバー購読拒否／L-TC-121〜123 失効）ため、ここは**その隙間だけ**を埋める。

### 7.1 ツールと分担（いずれも無料・OSS）

| ツール | ライセンス | 担当する隙間 |
| --- | --- | --- |
| **pytest**（既存） | MIT | 接続途中のセッション失効・将来ホストの購読ゲート回帰（L-TC 追加） |
| **Playwright**（既存） | Apache-2.0 | 画面操作を自動化して WS トラフィックを生成（下記 7.3 の“操作役”） |
| **k6**（ローカル実行） | AGPL-3.0 | WS 負荷・接続数/流量上限＝DoS/リソース枯渇 |
| **ZAP + WebSockets アドオン** | Apache-2.0 | WS メッセージの手動傍受・再送・ファジング（ライブ経路/未知探索） |
| **Autobahn\|Testsuite** / **websocat** | MIT / MIT・Apache | WS プロトコル適合性・不正フレームのファジング |

> 有料の Burp Suite Professional は「手動 WS 検査が楽」な任意オプションに過ぎず、本構成では ZAP の WebSockets アドオンで無料代替する。SaaS 版（k6 Cloud / Artillery Cloud）は使わず CLI/ローカル実行に限定すれば追加費用ゼロ。k6=AGPL・Artillery=MPL は「ツールを改変して外部配布する」場合のみ法務確認が要る（社内でそのまま使う分には義務なし）。

### 7.2 自動（再実行だけ）層 と 初回手動 層

- **完全自動層（手動ゼロ・CI 可・同内容なら実行するだけ）** ＝ pytest／Playwright（画面は自動操作）／k6。期待値が決まった試験（接続途中失効・購読ゲート回帰・負荷上限）はここに置く。最初に 1 回書けば以降は再実行のみ。
- **初回手動層（人の判断が価値）** ＝ ZAP WS アドオン/Autobahn による**未知探索・ライブ経路（`wss`＋プロキシ経由）確認**。シナリオ設計は人が行うが、固まったシナリオは 7.3 で自動実行へ転換できる。純粋な「新しい穴を探す探索」だけは自動化で減らせても完全にはゼロにならない。

### 7.3 手動操作を減らす＝Playwright→ZAP プロキシ経由で WS を自動生成

スキャナ/インターセプタは「WS トラフィックが流れないと検査対象が無い」。その“操作役”を人ではなく Playwright に任せる。

```
Playwright（ヘッドレスで画面を自動操作）
      │  HTTP_PROXY=ZAP を指定
      ▼
   ZAP（プロキシ）──► backend/WS
      │  通過した WS メッセージを記録
      ▼
   ZAP WebSockets アドオンで再送/ファジング/傍受
```

- Playwright のブラウザ起動時にプロキシを ZAP（既定 `http://localhost:8080`）へ向け、ログイン〜チャット投稿〜通知受信など**WS が流れる操作を自動再生**する。
- ZAP は通過した WS フレームを記録するので、以降の傍受/ファジングは記録済みメッセージに対して実施＝**人が画面をクリックし続ける必要がない**。
- これで「初回にシナリオを決める時だけ手動 → 以降は Playwright+ZAP の自動実行」に落とせる。
