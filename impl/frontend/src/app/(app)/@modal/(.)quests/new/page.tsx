"use client";

// SC-11 クエスト作成（URL 付きモーダル）。Intercept Routes＝一覧(/quests)等からのソフト遷移で /quests/new を
// このモーダルに差し込む。直アクセス/リロードは (app)/quests/new のフルページにフォールバック（コーディング規約 §4）。
// フォーム項目はプロトタイプのスタブ（モック移植で本実装）。
import { useRouter } from "next/navigation";

import { Button, Field, Modal, ModalBody, ModalFooter } from "@/components/ui";

export default function QuestCreateInterceptModal() {
  const router = useRouter();
  const close = () => router.back();
  return (
    <Modal open onClose={close} title="クエストを作成（SC-11）" size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <ModalBody>
          <p className="muted">
            URL 付きモーダル（Parallel Routes <code>@modal</code> ＋ Intercept Routes）。一覧から開くとモーダル・直アクセス/リロードはフルページ。フォーム項目はモック移植で実装します。
          </p>
          <Field id="q_title" label="件名" required>
            <input id="q_title" className="input" placeholder="例: 新しい社内制度のアイデア募集" />
          </Field>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={close}>
            キャンセル
          </Button>
          <Button type="submit" variant="primary">
            作成する
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
