// アカウント一覧の検索/状態フィルタ/ページング状態と取得を集約する共有フック（SC-92 と SC-93 で共用・DRY §2.3）。
// 取得系（listAccounts / listOwnAccounts）を fetcher として受ける＝経路差（クロステナント/自社固定）はフックの外。
// 判定（範囲・件数）はサーバーの page_info に従い、フックは状態管理と表示用データの供給のみ（業務層・判定はしない）。
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import type { Account, AccountListResponse } from "./types";

const PER_PAGE = 20; // 一覧の1ページ件数（backend 既定と一致・最大 100）

export type AccountListParams = { q?: string; status?: string; page: number; per_page: number };

export function useAccountList(
  fetcher: (params: AccountListParams) => Promise<AccountListResponse | null>,
) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(""); // "" = 全件 / "active" / "disabled"
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetcher({ q: q || undefined, status: status || undefined, page, per_page: PER_PAGE });
      setAccounts(res?.data ?? []);
      setTotal(res?.page_info.total ?? 0);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.code === "forbidden"
          ? "アカウントを表示する権限がありません。"
          : "アカウント一覧の取得に失敗しました。",
      );
    } finally {
      setLoading(false);
    }
  }, [fetcher, q, status, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 検索/フィルタ適用時は先頭ページへ戻す（絞り込みで現在ページが範囲外になるのを防ぐ）。
  const apply = useCallback((next: { q: string; status: string }) => {
    setQ(next.q);
    setStatus(next.status);
    setPage(1);
  }, []);

  return { accounts, total, page, perPage: PER_PAGE, q, status, loading, loadError, setPage, apply, reload };
}
