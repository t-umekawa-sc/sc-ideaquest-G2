# テストパターン D. アイデア・添付・版・投票・フォロー

> 規約＝[`../規約/テスト規約.md`](../規約/テスト規約.md)。仕様の正＝[`../API設計/D_アイデア・添付・版・投票・フォロー.md`](../API設計/D_アイデア・添付・版・投票・フォロー.md)（D.1〜D.6）・[`../データモデル.md`](../データモデル.md) §5.10〜§5.14・§5.23。エラー code の網羅は OpenAPI が SoT（API設計 README §1.7）。
> 対象＝ドメイン D（アイデア）の縦スライス。**本スライスはまずデータ基盤（ORM/migration/repository）**＝`app/tenant/ideas/`。application/router（作成/編集/公開/添付/版/投票/フォローの API）は後続で本 md に追記する。
> 前提フィクスチャ＝seed 会社 ACME-01（会社DB あり）。repository テスト（`impl/backend/tests/ideas/test_repository.py`）は前提（グループ/クエスト/ユーザー）を ORM で直接 seed し teardown で物理削除。呼び出し側 Tx 相乗（自身では commit しない）。

## 1. repository（永続化プリミティブ・D.1〜D.6・§5.10〜§5.14・§5.23）

> 対象＝`app/tenant/ideas/repository.py`。アイデア CRUD・可視性（公開＋自分の下書き）・利害関係者置換・投票（1人1票・切替/取消・集計）・版（追加/一覧/取得・UNIQUE）・添付（追加/計数/削除）・フォロー（冪等）を検証。

| TC-ID | 階層 | 目的 | 前提 | 操作 | 期待 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| D-TC-001 | int | 作成と有効行取得・トゥームストーン除外 | クエスト/ユーザー seed | `create_idea`→`get_idea`／`deleted_at` 設定後再取得 | 有効行を返す（author_id 正・current_revision=1）／削除後は None | D.1／§5.10 |
| D-TC-002 | int | 一覧の可視性（公開＋自分の下書き） | 公開/自分の下書き/他人の下書きを seed | `list_ideas_for_quest` | 公開＋自分の下書きのみ。他人の下書きは除外 | D.1／§5.10 |
| D-TC-003 | int | status フィルタ（published のみ） | 公開＋自分の下書き | `list_ideas_for_quest(status=['published'])` | 公開のみ（自分の下書きも除外） | D.1 |
| D-TC-004 | int | カーソルページング（keyset） | 公開3件 | `list_ideas_for_quest`（limit=2→cursor） | `(created_at,id) DESC` で重複なく続きを返す | §1.8 |
| D-TC-005 | int | 利害関係者の置換セット | アイデア1件 | `replace_stakeholders` を2回 | 後の配列で全置換 | D.2／§5.11 |
| D-TC-006 | int | 投票 1人1票・初回/切替 | アイデア1件 | `upsert_vote`（approve→oppose） | 初回 created=True／切替 created=False・type 更新・行は1つ | D.5／§5.13 |
| D-TC-007 | int | 賛成/反対の集計 | 2名が approve/oppose | `count_votes` | `{approve:1, oppose:1}` | D.5 |
| D-TC-008 | int | 投票取消の冪等 | 投票済み | `remove_vote` を2回 | 1回目 True／2回目 False（XP は戻さない） | D.5／§8-⑥ |
| D-TC-009 | int | 版の追加/一覧/取得・UNIQUE | アイデア1件 | `add_revision`×2→`list`/`get` | 新しい順に返る・changes スナップショット取得可 | D.4／§5.14 |
| D-TC-010 | int | 添付の追加/計数/削除 | アイデア1件 | `add_attachment`→`count`→`remove` | count 1→0（size CHECK 満たす） | D.3／§5.12 |
| D-TC-011 | int | フォローの冪等 | アイデア1件 | `add_follow`×2→`remove_follow` | 重複行を作らない・is_following True→False | D.6／§5.23 |
| D-TC-012 | int | フォロー中アイデア集合 | 1件フォロー | `list_followed_idea_ids` | フォロー中のみ含む | D.6 |
