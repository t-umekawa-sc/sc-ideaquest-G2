# リッチテキスト2系統統一（TipTap 移行）— 設計ドラフト

> 起票: 2026-10-09（調査/設計セッション）。実装は別セッション（バックログ起票・正本反映は実装セッションが一元管理）。
> 関連実例: お知らせ（共有 `RichTextEditor` を使用）／情報インプット（独自 contentEditable）／チャット（plain＋`renderTextHtml`）。

## 0. 位置づけ・狙い

- 本サービスは**情報を取り扱うサービス**であり、**文章の表現力は死活要件**（ユーザー判断・2026-10-09）。今後リッチテキスト機能は拡張が見込まれる。
- 現状はリッチテキストが **3系統にばらけている**（§1）。唯一の共有部品も自コメントで **「contentEditable＋execCommand（デモ水準）」** と明記＝**非推奨API上の暫定実装**で、拡張（表・メンションのノード化・堅いUndo・綺麗な出力・IME・将来の共同編集）に耐えない。
- **方針決定（2026-10-09・確定）**: **TipTap（ProseMirror ベース）への移行を必須**とする。表現力・拡張性・日本語IME・メンション統一・出力HTMLの一貫性（サニタイズとの相性）で execCommand 据え置きに優位。
- **系統は「チャット軽量／ドキュメント高機能」の2系統に集約**（UX・保存要件が本質的に異なるため）。ただし**土台（エディタエンジン・サニタイズ・メンションモデル）は2系統で共有**し、再分岐を防ぐ。

## 1. 現状整理（コードで裏取り済み・2026-10-09）

| 用途 | 仕組み | 保存形式 | サニタイズ | 実装箇所 |
| --- | --- | --- | --- | --- |
| お知らせ（announcements） | 共有 `RichTextEditor`/`RichTextView` | HTML | backend `nh3`（書込時） | `components/richtext/*`／`AnnouncementAdminView.tsx:10`・`AnnouncementDetailView.tsx:9` |
| 情報インプット（info） | **独自 contentEditable**（共有部品不使用＝二重化） | HTML | backend `nh3`（書込時） | `features/info-input/components/InfoFormPanel.tsx`・`InfoDetailView.tsx` |
| チャット（chat） | plain text ＋ 描画時変換 | **プレーンテキスト** | **frontend**（`renderTextHtml`） | `features/chat/render.ts`・`IdeaChatView.tsx:693` |

- 共有/独自とも `document.execCommand` 依存（`RichTextEditor.tsx:40,59`／`InfoFormPanel.tsx:94,107`）。
- サニタイズ中核（共有・backend）＝`backend/app/core/richtext.py`（`nh3`・許可リスト方式）。
- チャットのメンションは**描画時に現メンバーへ動的解決**（`renderTextHtml(body, members)`）。unit 契約テストあり＝**E-TC-211 / E-TC-229**。
- チャットは **IdeaChatView 経由でアイデア・コンセプトに再利用**（中核1本＝memory `chat-thread-independence`）。チャットを触ると全ホストに波及。
- 本文系 `textarea` は ideas/concepts/projects/contests/quests/strategy/evaluations 等**十数画面**に存在＝リッチ化の潜在的展開先。

## 2. 方針（合意事項）

1. **エンジン＝TipTap（ProseMirror）に移行必須**。自前 execCommand は段階的に廃止。
2. **2系統に集約**：
   - **ドキュメント系**（高機能・HTML保存）＝お知らせ・情報インプット・将来の本文系。
   - **チャット系**（軽量プリセット）＝チャット。
3. **系統内の実装は各1本**。特に**情報インプットの独自 contentEditable を共有ドキュメント部品へ寄せる**（HTML同形式・frontend中心＝低リスク）。「ドキュメント系で2実装」を残さない。
4. **土台は2系統で共有**：①同一 TipTap エンジン＋**機能プリセット**で差を出す、②**サニタイズは backend 書込時・中央で強制**（呼び出し側任意にしない＝蓄積型XSS防止）、③**メンションは共通ノードモデル**。
5. チャットの要求が将来重くなっても**プリセットを上げるだけ**で再分岐しない設計にする。

## 3. アーキテクチャ（ドラフト）

### 3.1 共有エディタ基盤（新規）

- `components/richtext/` を TipTap ラッパに置換/拡張。
  - `RichTextEditor`（編集）＝props に `preset: "document" | "chat"`（または拡張配列）・`value`（HTML or ProseMirror JSON：§4で決定）・`onChange`・`mentionSource?`・`uploadImage?`。
  - `RichTextView`（表示）＝直列化HTMLを `dangerouslySetInnerHTML`（backend無害化済み前提）。チャットもここへ寄せられる。
- プリセット＝拡張（Extension）の束。
  - **document**: 見出し/リスト/リンク/太字他/表/画像/コードブロック/引用。
  - **chat**: 太字/斜体/コード/リンク/**メンション**（軽量）。

### 3.2 ドキュメント系

- お知らせ＝共有部品のまま（TipTap化で自動的に恩恵）。
- 情報インプット＝独自実装を撤去し共有部品へ移行（保存は既存 `body_html` 踏襲）。
- 将来の本文系展開＝共有部品を import するだけ（配線のみ）。

### 3.3 チャット系

- `IdeaChatView` の `textarea`＋`renderTextHtml` を、chat プリセットの共有エディタへ置換。
- **メンション**＝ProseMirror の mention ノード（`data-id`）として扱い、サニタイズ許可リストに属性追加。動的解決（現メンバー表示）は描画時にノードの id→表示名で解決。
- **E-TC-211 / E-TC-229 のメンション契約**は新実装へ移植（テスト先行）。

### 3.4 サニタイズ（中央・backend書込時に一本化）

- `app/core/richtext.py` の許可リストを **TipTap の直列化タグ集合に一致**させる（モデル→既知タグ＝許可リストが精密に書ける＝execCommandの「ブラウザ毎に別タグ」問題が消える）。
- メンション/画像の属性（`data-id`・`src`/`alt` 等）を許可リストへ明示追加。
- **全書込経路が必ず sanitize を通る**ことを中央で保証（新ドメイン追加時に忘れられない構造）。memory `zap-dast-security-plan` と連動（XSS検証）。

## 4. 要決定（未確定・ユーザー/実装判断待ち）

1. **保存形式**: ドキュメント系は **HTML据え置き**（既存 `body_html` 資産を活かす）で確定候補。チャットは **(a) plain据え置き＋描画時変換を廃止しない / (b) 構造化（HTML or PM-JSON）へ移行**のどちらか。移行は**データ移行＋通知/検索/メンション抽出など plain 前提の派生処理**に波及（要棚卸し）。→ **既定案: ドキュメント=HTML、チャット=当面plain据え置き（最後に再検討）**。
2. **エディタの value 型**: HTML文字列 or ProseMirror JSON。JSON は変換・協調に強いが保存/移行コスト増。→ **既定案: 保存は HTML（既存踏襲）・編集内部はPMモデル**。
3. **TipTap 拡張の採否**: 表・画像・コードブロック・タスクリスト・共同編集（Yjs）の要否。→ 拡張要件を別途一覧化。
4. **バンドル/SSR**: Next(App Router) での client component 化・動的 import・初期バンドル影響の許容ライン。

## 5. 移行手順（段階・低リスク順）

1. **基盤**: TipTap ラッパ（`RichTextEditor`/`RichTextView`）＋document/chat プリセット＋サニタイズ許可リスト更新（TC先出し＝XSS/直列化）。
2. **お知らせ**: 共有部品差し替え（既にHTML・影響局所）。
3. **情報インプット**: 独自 contentEditable 撤去→共有部品へ（HTML同形式）。
4. **本文系の展開**: 必要な画面から共有部品を配線（backend で `*_html` 列＋sanitize を1本足す）。
5. **チャット（最後）**: chat プリセットへ置換・メンションノード化・E-TC-211/229 移植。保存形式変更を伴う場合はデータ移行＋派生処理棚卸しを別EPで。

## 6. 非機能・横断

- **IME（日本語）**: TipTap/ProseMirror の composition 処理に委ねる（execCommand手DOMの崩れを解消）。移行時に日本語入力の実機検証を必須化。
- **アクセシビリティ/reduce-motion/i18n**: 既存標準（§4.9・§4.7）を維持。
- **貼付クリーニング**: TipTap の paste rules で Word/Googleドキュメント由来のゴミHTMLを構造化クリーン。
- **デザイン標準**: `richtext.css`/`.rt`/`.rt-view` を踏襲しつつプリセット別スタイルを整理（デザイン標準へ反映は実装セッションが実施）。

## 7. 影響範囲（既存）

- 置換: `components/richtext/RichTextEditor.tsx`・`RichTextView.tsx`・`richtext.css`。
- 移行: `features/info-input/components/InfoFormPanel.tsx`・`InfoDetailView.tsx`（独自実装撤去）。
- 置換（最後）: `features/chat/components/IdeaChatView.tsx`・`features/chat/render.ts`（＋`render.test.ts` の契約移植）。チャット再利用ホスト（ideas/concepts）へ波及。
- backend: `app/core/richtext.py`（許可リスト拡張）。

## 8. テスト方針

- テスト規約 §5（TC先出し・red-green）。新規 TC は該当ドメイン md に `根拠` 列付きで追加。
- 必須カバレッジ: **サニタイズ（XSS・許可/除去タグ）**、**メンション契約（E-TC-211/229 相当を新実装へ）**、**直列化の決定性（モデル→既知タグ）**、IME/貼付の主要ケース。
