# テストパターン リッチテキスト（W-TC）＝TipTap/PM-JSON サニタイズ中核

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。対象＝リッチテキスト統一（TipTap 移行）の**書込時サニタイズ境界**＝`impl/backend/app/core/richtext.py` の PM-JSON 検証・直列化（純関数）。設計＝[`../設計ドラフト/リッチテキスト2系統統一(TipTap移行)_設計.md`](<../設計ドラフト/リッチテキスト2系統統一(TipTap移行)_設計.md>)（§3.4 サニタイズ・§8 テスト方針）＋台帳 [`../バックログ/未実装・ギャップ一覧.md`](../バックログ/未実装・ギャップ一覧.md) §1-b。
>
> **セキュリティ最優先**＝蓄積型 XSS を保存境界で止める。保存形式＝**PM-JSON**（ユーザー決定 2026-10-09）。サニタイズは「任意 HTML を nh3 で削る」から「**PM-JSON を許可リスト（ノード/マーク/属性）で検証し、決定的に直列化**する」へ転換。モデル→既知タグが1対1なので許可リストが精密に書け、`execCommand` の「ブラウザ毎に別タグ」問題も消える。
>
> 直列化の**許可リスト（document プリセット）**＝ノード {doc, paragraph, heading(1–3), bulletList, orderedList, listItem, blockquote, codeBlock, horizontalRule, hardBreak, text, image, table, tableRow, tableHeader, tableCell, mention}／マーク {bold→`<strong>`, italic→`<em>`, strike→`<s>`, code→`<code>`, link→`<a>`}。マーク入れ子は**固定順**（link>bold>italic>strike>code）＝直列化の決定性。URL スキームは http/https/相対のみ（`javascript:`/`data:`/`vbscript:` 除去）。`<a>` には `rel="noopener noreferrer nofollow"` を必ず付与。

## 1. PM-JSON サニタイズ・直列化（unit・`app/core/richtext.py`）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| W-TC-001 | unit | 許可ノード/マークを保持して直列化 | heading(2)/paragraph/bold/italic/link(https)/bulletList を含む PM-JSON | `pm_to_html(doc)` | `<h2>`・`<p>`・`<strong>`・`<em>`・`<a href="https://…" rel="noopener noreferrer nofollow">`・`<ul><li>` を出力（許可ノード/マークは残る） | 設計 §3.1/§3.4 |
| W-TC-002 | unit | 未知ノードを除去 | `type:"iframe"`/`"script"`/`"rawHtml"` ノードを含む PM-JSON | `sanitize_pm(doc)`／`pm_to_html(doc)` | 未知ノードは落ちる（出力に `<iframe`/`<script`/生 HTML を残さない）・既知の兄弟ノードは保持 | 設計 §3.4／§2.2④ |
| W-TC-003 | unit | 未知マークを除去（テキストは保持） | text に mark `type:"blink"`・`type:"onclick"` | `pm_to_html(doc)` | 未知マークのタグは出さない・text 本文は残る | 設計 §3.4 |
| W-TC-004 | unit | リンク href のスキーム検証 | link mark `href:"javascript:alert(1)"`／`"data:text/html,…"`／`"vbscript:…"` | `pm_to_html(doc)` | 当該 link マークは除去（`javascript:`/`data:`/`vbscript:` を出力に残さない）・text は残る。http/https/相対（`/path`）/mailto は許可 | 設計 §3.4／§2.2④ |
| W-TC-005 | unit | 画像 src のスキーム検証＋alt エスケープ | image `src:"javascript:…"`／`src:"data:…"`（不正）と `src:"/files/x.png"`（相対・正） | `pm_to_html(doc)` | 不正 src の image ノードは**丸ごと落とす**・相対/自ホストのみ `<img src=… alt=…>`・alt はエスケープ | 設計 §3.4／U-8（自社ホスト再ホスト） |
| W-TC-006 | unit | mention ノードの直列化（id 形式検証） | mention `attrs:{id:"acc_123", label:"山田"}` と id 不正（`"<x>"`）の2種 | `pm_to_html(doc)` | 正＝`<span data-type="mention" data-id="acc_123">@山田</span>`（label エスケープ）・不正 id＝`data-id` を付けず `@label` のテキスト化（id に生値を通さない） | 設計 §3.3（メンションノード） |
| W-TC-007 | unit | heading.level を許可範囲へ丸め | heading `attrs:{level:7}`／`level:0`／`level:"x"` | `pm_to_html(doc)` | level は 1–3 にクランプ（7→`<h3>`・0→`<h1>`・非整数→`<h1>`）・`<h7>` 等は出さない | 設計 §3.1 |
| W-TC-008 | unit | テキストの HTML エスケープ（生タグ注入不可） | text value `"<script>alert(1)</script> & <b>x</b>"` | `pm_to_html(doc)` | `&lt;script&gt;…&amp;…&lt;b&gt;` とエスケープ出力・生 `<script`/`<b` を残さない | 設計 §3.4／§2.2④ |
| W-TC-009 | unit | 直列化の決定性（同入力→バイト一致・マーク順固定） | bold+italic+link を同時に持つ text（属性順/マーク順を入替えた2表現） | `pm_to_html` を複数回・2表現で比較 | 出力が完全一致（`<a …><strong><em>…</em></strong></a>` の固定入れ子・属性順固定） | 設計 §8（直列化の決定性） |
| W-TC-010 | unit | codeBlock（language 検証・内部エスケープ・マーク無効） | codeBlock `attrs:{language:"js; <x>"}` と正常 `"python"`・本文に `<script>` | `pm_to_html(doc)` | 正常＝`<pre><code class="language-python">`・不正 language は class を付けない（`^[A-Za-z0-9+#-]+$` 以外除去）・本文はエスケープ・内部のマークは無視 | 設計 §3.1 |
| W-TC-011 | unit | table の直列化（危険属性除去） | table→tableRow→tableHeader/tableCell（`attrs` に `style:"…"`・巨大 `colspan`） | `pm_to_html(doc)` | `<table><tbody><tr><th>/<td>` を出力・`style` は出さない・`colspan/rowspan` は整数(1–1000)のみ許可しそれ以外除去 | 設計 §3.1 |
| W-TC-012 | unit | 平文抽出（body_text 用） | 見出し/段落/リストを含む PM-JSON | `pm_to_text(doc)` | テキストのみ連結・タグ無し・空白正規化（検索/トークンの元）・`<` を含まない | N.6（派生平文）／設計 §3.4 |
| W-TC-013 | unit | 入力頑健性（安全側フォールバック） | `None`・`{}`・壊れた JSON 文字列・`type` 欠落 | `sanitize_pm`/`pm_to_html`/`pm_to_text` | 例外を投げず空 `doc`／空文字を返す（安全側・保存を止めない） | 設計 §6（非機能）／安全側 |
| W-TC-014 | unit | リンクに tabnabbing/referrer 防止属性 | link mark `href:"https://ext.example"` | `pm_to_html(doc)` | 出力 `<a>` に `rel="noopener noreferrer nofollow"` を付与（referrer 漏れ・逆タブナビ防止） | §2.2④／§10 |
| W-TC-015 | unit | サニタイズ結果は canonical PM-JSON（round-trip 安定） | 未知ノード/マーク/属性混じりの PM-JSON | `sanitize_pm(doc)` を2回適用 | 1回目で未知要素が除去され、2回目適用で不変（冪等）・`pm_to_html(sanitize_pm(x))==pm_to_html(x)` | 設計 §3.4 |
