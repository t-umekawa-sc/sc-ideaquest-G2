# FR-48② セルフサインアップ セキュリティ強化（CAPTCHA / 漏洩PW / 使い捨てメール / 管理者通知）

> 状態: 設計＋実装（2026-10-07 着手・env-gated）。FR-48② セルフサインアップ（[設計 §8.4](アイデアコンテスト機能_設計.md)・[API設計 A §A.11.4](../API設計/A_認証・セッション.md)）の follow-up（外部依存 SEC）を本書で詰める。
> 方針＝**4つとも env/フラグで無効化できる形**で実装。dev/テストは無効のまま（現行 green）、本番で env/フラグ投入時のみ有効。

## 0. なぜ必要か（背景）

`POST /public/signup` は**未認証の公開書込口**＝最も自動化攻撃・濫用に狙われる面。基本の SEC（検証前に作らない A／列挙耐性 B／OTPブルート C／権限固定 E／会社コード再検証 F／自動ログインしない I／監査 J／レート制限・Origin）は実装済み。本書は**外部サービス/外部呼び出しを伴う残り**を足す。

| 項目 | SEC | 外部サービス | 既定 | 本番で有効化 |
|---|---|---|---|---|
| CAPTCHA（Cloudflare Turnstile） | G | **要**（Cloudflare・無料） | OFF（キー空） | `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` |
| 漏洩PW拒否（HIBP） | D | 要（無料・キー不要） | OFF | `HIBP_ENABLED=true` |
| 使い捨てメール判定 | G | 不要（ローカル同梱） | **ON** | （既定で有効・`SIGNUP_DISPOSABLE_EMAIL_BLOCK`） |
| 管理者通知ダイジェスト | H | 不要（内製） | OFF | `SIGNUP_ADMIN_NOTIFY_ENABLED=true` |

---

## 1. CAPTCHA（Cloudflare Turnstile・SEC G）

### 導入する意味
ボットによる大量アカウント作成（spam・OTPメール爆撃・DB汚染）を入口で止める。IP/メールのレート制限だけでは分散IPに弱い。

### 外部サービスの仕組み（※ユーザー質問への回答）
**Q: Turnstile はトークンの正当性確認だけ？ それともボット判定までする？**
**A: 両方。トークン正当性確認だけではない。**
- ウィジェットがブラウザで動く時点で Cloudflare が**クライアントがボットか判定**する（JS実行・ブラウザ挙動・プルーフオブワーク・**Cloudflare が自社ネットワークで持つ IP/クライアントのレピュテーション**）。怪しければ対話チャレンジを出し、問題なければ**判定結果を埋め込んだ単回トークン**を発行。
- backend が `siteverify`（secret key）でトークンを送ると、Cloudflare は「①トークンが本物で未使用・未失効・自サイト発行か ②ボット判定を通過したか」を `success: true/false` で返す。
- つまり**ボット判定はトークン発行時（Cloudflare側）、siteverify はそれをサーバー側で改ざん・再利用なく確認**する二段構え。偽造・使い回しは siteverify で弾かれる。

### 実装仕様
- **env**: `TURNSTILE_SITE_KEY`（フロント公開）・`TURNSTILE_SECRET_KEY`（backend秘匿）。**両方空なら CAPTCHA 無効**（dev/CI/テスト自動スキップ）。`turnstile_timeout_seconds`（既定3）。
- **backend**: `core/captcha.py` の `verify_turnstile(token, ip) -> bool`（httpx・`https://challenges.cloudflare.com/turnstile/v0/siteverify`）。`signup()` 冒頭で検証（失敗は 400 `captcha_failed`）。`GET /public/bootstrap` に `turnstile_site_key` を返し、フロントがウィジェットを出すか判断。
- **frontend**: SC-05 に Turnstile ウィジェット（script 直読み込み）→ トークンを `signup()` に同梱。
- **テスト**: secret 未設定＝スキップ（現行テスト green）／設定時は siteverify を Fake 化。

### あなたの操作（必須・外部作業はこれだけ）
1. Cloudflare 無料アカウント作成 → **Turnstile** でサイト登録（公開デプロイのドメイン／dev は `localhost` も登録可）。
2. **Site Key** と **Secret Key** を取得。
3. **本番デプロイの env に2つを設定**（dev 共有スタックには設定しない＝ACMEログインUX等に影響させない）。

---

## 2. 漏洩パスワード拒否（Have I Been Pwned・SEC D）

### 導入する意味
過去の漏洩で出回ったPW（`Passw0rd!` 等も実は漏洩済み）での登録を拒否 → クレデンシャルスタッフィング耐性。「8文字以上」だけでは弱いPWを通す。

### 外部サービスの仕組み（※ユーザー質問への回答）
**Q: SHA-1 の先頭5桁を送るとのことだが、それが漏洩する恐れは？**
**A: 実質ない（k-匿名性＋TLS＋パディング）。**
- 送るのは **PW の SHA-1（40桁hex）の先頭5文字だけ（＝20bit）**。この5文字バケットには**数百〜千個の別パスワードのハッシュが一致**＝あなたのPWを特定できない。
- HIBP はバケットの**全 suffix 一覧を返し、最終照合はこちらのサーバー内でローカル実施**。**PW平文もフルハッシュも外部に一切出ない**。
- 通信は **HTTPS(TLS)**＝第三者に先頭5文字すら見えない。さらに `Add-Padding: true` でレスポンスをランダム水増し（水増し行は count=0）し、サイズからの推測も防ぐ。
- サーバー側サインアップでは PW 平文は TLS で既に backend に届いており、HIBP 判定は**ローカルで SHA-1 を作り先頭5文字だけ送る**ので**新たな平文露出はゼロ**。
- **APIキー不要・完全無料**。

### 実装仕様
- **backend**: `core/pwned.py` の `is_pwned_password(pw) -> bool`（httpx・`https://api.pwnedpasswords.com/range/{prefix}`・`Add-Padding`・タイムアウト）。`signup()` のPW検証（最低文字数の後）で呼ぶ → 漏洩なら **422 field=password**。
- **env**: `HIBP_ENABLED`（既定 false）。**外部障害/タイムアウトは fail-open（通す）**＝HIBP ダウンでサインアップ全停止を避ける（可用性優先・ユーザー選択）。`hibp_timeout_seconds`（既定2）。
- **テスト**: Fake で漏洩PW→拒否／通常→許可（外部未接続）。

### あなたの操作
**不要**（無料・キー不要）。本番 backend が `api.pwnedpasswords.com` へ egress できるネットワークだけ確認。prod で `HIBP_ENABLED=true`。

---

## 3. 使い捨てメールドメイン判定（SEC G）

### 導入する意味
一時メール（10minutemail 等）での使い捨て登録・多重登録・spam を抑制。

### 仕組み（外部サービス不要＝ローカル blocklist）
公開の `disposable-email-domains` リスト（GitHub・数千ドメイン）を**リポジトリに同梱**し、email の @以降ドメインを照合。外部APIは使わない（有料/キー要の外部判定サービスは不採用）。

### 実装仕様
- **backend**: `app/core/disposable_domains.txt`（同梱・自動生成）＋`core/disposable_email.py` の `is_disposable(email)`（起動時ロード・キャッシュ）。`signup()` の email 検証で呼ぶ → 使い捨ては **422 field=email**。
- **env**: `SIGNUP_DISPOSABLE_EMAIL_BLOCK`（既定 **true**・ローカルで安全）。
- **更新の自動化（案A・採用 2026-10-07）**＝実行時は外部を叩かず、**CI（GitHub Actions）週次で生成物を更新し差分を PR**。
  - `scripts/update_disposable_domains.py`＝公開リスト（disposable-email-domains）を取得→正規化（小文字/重複排除/ソート）→**誤爆防止（主要プロバイダ allowlist・`*.example` 除外・件数サニティ＝下限500/急減ガード）**→`disposable_domains.txt` 書き出し。異常時は非ゼロ終了で中止。手動実行も可（`--input`/`--check-only`）。
  - `.github/workflows/update-disposable-domains.yml`＝`schedule`（週次・月曜）＋`workflow_dispatch`。スクリプト実行→差分があれば `peter-evans/create-pull-request` で PR 作成（**人がレビューしてマージ＝誤爆の最終防波堤**）。無差分なら何もしない。
  - 初期同梱＝上流から 9205 件を取り込み済（2026-10-07）。
  - **あなたの操作**＝週1で来る PR の差分を確認してマージするだけ。※GitHub リポジトリ設定で **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" を ON**（Actions が PR を作れるようにする）。
- **テスト**: 既知 disposable→拒否／通常→許可（A-TC-132）。

### あなたの操作
**ほぼ不要**。採用リスト（定番 `disposable-email-domains`）と更新頻度を運用で決める程度。

---

## 4. 管理者通知ダイジェスト（SEC H）

### 導入する意味
新規サインアップを運営（会社の `company_account_admin`）に知らせモデレーション可能に。ただし大量登録時の**通知爆撃を防ぐ**ためまとめる。

### 仕組み（外部サービス不要＝既存の通知/mail 基盤）
既存 `notifications` catalog ＋ `mail_outbox`。新種別 `signup_registered` を追加。**会社ごとにクールダウン**（例60分）＝クールダウン中の登録は Redis にカウントだけ貯め、次回通知時に「ほか N 件」とまとめて1通（完全な定時cronより軽量で実用的）。

### 実装仕様
- **backend**: `verify()` 成功時に会社の `company_account_admin` へ `signup_registered`（in-app + mail）。`env` `SIGNUP_ADMIN_NOTIFY_ENABLED`（既定 false）／`signup_admin_notify_cooldown_seconds`（既定3600）。本人には出さない。
- **テスト**: 連続サインアップでクールダウン通り間引かれ、まとめ件数が出る。

### あなたの操作
**不要**（内製）。通知頻度（既定60分）・宛先に system_admin を含めるかを運用で決める程度。prod で `SIGNUP_ADMIN_NOTIFY_ENABLED=true`。

---

## 5. まとめ：あなたがやる必要があること

| 項目 | 外部アカウント | あなたの操作 |
|---|---|---|
| **CAPTCHA** | Cloudflare（無料） | **必須**：アカウント作成→Turnstile登録→Site/Secret key 取得→**本番 env に設定** |
| 漏洩PW（HIBP） | 不要 | 本番 egress 許可＋`HIBP_ENABLED=true`（キー不要） |
| 使い捨てメール | 不要 | 採用リスト/更新頻度を決める（既定で有効） |
| 管理者通知 | 不要 | 頻度/宛先ポリシーを決める＋`SIGNUP_ADMIN_NOTIFY_ENABLED=true` |

> **env をどこに置くか**＝本番デプロイの環境変数（compose/シークレットマネージャ）。dev 共有スタックには CAPTCHA/HIBP を設定しない（ACME ログイン等の既存 UX・テストを壊さないため）。
