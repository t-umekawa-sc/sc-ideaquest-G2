// アカウント一覧を全件取得する共有フック（DataTable client モード用・SC-92/93 共用・DRY §2.3）。
// backend はオフセットページング（最大 per_page=100）＝全件をループ取得し DataTable に渡す
// （管理系＝会社内アカウントは小〜数百件で妥当。検索/絞込/ソート/ページングは DataTable がクライアント処理）。
// サーバー駆動モード（大volume 画面）は将来拡張＝DataTable の computeRows() 境界で差し替え。
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import type { Account, AccountListResponse } from "./types";

const FETCH_PER_PAGE = 100; // backend 上限。全件をこの単位でループ取得。

export function useAllAccounts(
  fetcher: (params: { page: number; per_page: number }) => Promise<AccountListResponse | null>,
) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const all: Account[] = [];
      let page = 1;
      for (;;) {
        const res = await fetcher({ page, per_page: FETCH_PER_PAGE });
        const batch = res?.data ?? [];
        all.push(...batch);
        const total = res?.page_info.total ?? all.length;
        if (batch.length === 0 || all.length >= total) break;
        page += 1;
      }
      setAccounts(all);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.code === "forbidden"
          ? "アカウントを表示する権限がありません。"
          : "アカウント一覧の取得に失敗しました。",
      );
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { accounts, loading, loadError, reload };
}
