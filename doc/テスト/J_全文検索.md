# テストパターン J. 全文検索（PGroonga・クエスト内 FTS）

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/J_全文検索.md`](../API設計/J_全文検索.md)（J.0〜J.6）・[`../API設計/README.md`](../API設計/README.md) §1.11（PGroonga）・§1.8（オフセット）。索引＝データモデル §6（migration `0018_company_pgroonga_fts`）。対象実体＝D（ideas/attachments）・E（chat_messages）。門番＝C.0（パーティー∩グループ AND）。
> 対象＝新ドメイン J（`app/tenant/search/`＝application/router/repository/schemas）＝`GET /api/v1/quests/{quest_id}/search`（SC-12 全文検索タブ）。**配信/検索専用＝新業務ロジックなし**（可視範囲は WHERE 述語で強制・索引ヒットをそのまま返さない）。グローバル `GET /search` は予約（本スライス対象外）。
> 実装＝PGroonga `&@~`（クエリ・AND）＋`pgroonga_score`＋`pgroonga_snippet_html`。3 種（idea/chat/attachment）を合成し score 降順・オフセットページング（total）。`q` はバインド変数（§2.2③）。スニペットは許可リストサニタイズ（生 dangerouslySetInnerHTML 禁止・§2.2④）。
> 前提＝seed 会社 ACME-01。api は throwaway 実アカウントでログイン＋パーティー/グループ所属を seed。全て自分の可視範囲のみ（§1.5・§2.2）。

## 1. ヒット・種別・合成（J.1〜J.3）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| J-TC-101 | api | アイデアヒット（title/body/value/note） | 公開アイデア（本文に検索語） | `GET /quests/{id}/search?q=語` | `type=idea`・`idea_id`/`idea_title`/`quest`・`snippet_html`・`score` を含む1件以上 | J.2/J.3 |
| J-TC-102 | api | チャットヒット | 可視アイデアの chat_messages に検索語 | `?q=語` | `type=chat`・`chat_message_id`・`target`（SC-24 導線） | J.3 |
| J-TC-103 | api | 添付ヒット（ファイル名） | 添付 `original_name` に検索語 | `?q=語` | `type=attachment`・`attachment_id`・親 idea/chat 継承 | J.2/J.3 |
| J-TC-104 | api | UNION スコア順（種別混在の単一リスト） | idea/chat 双方がヒット | `?q=語` | `data` は score 降順の単一配列（種別混在） | J.3 |
| J-TC-105 | api | types 絞り込み | idea/chat/attachment 全ヒット | `?q=語&types=idea` | `type=idea` のみ（chat/attachment を含まない） | J.1 |
| J-TC-106 | api | ページング（total・offset） | ヒット 3 件 | `?q=語&per_page=2` → `&page=2` | 1ページ目2件・`page_info.total=3`・2ページ目に残り1件 | J.4／§1.8 |
| J-TC-107 | api | 0件 | ヒットしない語 | `?q=該当なし` | `{data:[], page_info:{total:0,...}}` | J.3 |
| J-TC-108 | api | 空クエリは 422 | — | `?q=`（空/空白） | 422 `validation_error`（field=q） | J.1 |

## 2. 認可・可視範囲（J.0・§2.2）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| J-TC-121 | api | 門番 NG は 404（存在秘匿） | パーティー非参加 or グループ非所属 | `GET /quests/{id}/search?q=語` | 404 not_found（どちらか欠けても 404） | J.0 門番 |
| J-TC-122 | api | 下書きアイデアは対象外（本人でも） | 本人の draft アイデアに検索語 | 本人で `?q=語` | 下書きはヒットに出ない | J.0 |
| J-TC-123 | api | 削除/トゥームストーンは対象外 | 削除アイデア・is_deleted チャットに検索語 | `?q=語` | いずれも出ない | J.0 |
| J-TC-124 | api | 未認証は 401 | セッションなし | `?q=語` | 401 | J.0 |

## 3. スニペット・XSS（J.5・§2.2④）

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| J-TC-131 | api | スニペットはハイライト＋ユーザー文エスケープ | 本文に検索語＋`<script>` 相当 | `?q=語` | `snippet_html` に `<span class="keyword">` は生・ユーザー文中の `<` は `&lt;` にエスケープ済み（生タグはハイライトのみ） | J.5 |
