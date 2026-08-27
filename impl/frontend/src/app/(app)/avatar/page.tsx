// SC-31 アバター/着せ替え（ゲーム層）＝3Dアバタービューア＋ワードローブ（5スロット×装備・クリック着替え）。
// 正＝doc/画面設計/mocks/SC-31_アバター着せ替え.html・doc/画面設計/screens/SC-31_アバター着せ替え.md。
// 装備/コインは G 実接続（shop/api）。ベース体（男女2体）は GET /me（K.1）から SSR 初期値を渡す。
import { redirect } from "next/navigation";

import { AvatarView } from "@/features/avatar";
import { toAvatarBase } from "@/features/avatar/base";
import { getServerMe } from "@/lib/me";
import { getServerSession } from "@/lib/session";

export default async function AvatarPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const me = await getServerMe(); // K.1 正準＝profile.avatar_base をベース初期値に
  return <AvatarView initialAvatarBase={toAvatarBase(me?.profile.avatar_base)} />;
}
