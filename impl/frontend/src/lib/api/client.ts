// APIクライアント（fetch ラッパ・§4.1 lib/api）。
// 同一オリジン /api/v1 を叩く（next.config の rewrite で backend へプロキシ）。
// 状態変更系は iq_csrf Cookie を読み X-CSRF-Token に載せる（ダブルサブミット・A.0）。
// エラーは RFC7807 problem+json（§1.7）を ApiError に整形。業務計算はしない。

export class ApiError extends Error {
  status: number;
  code: string;
  body: unknown;
  constructor(status: number, code: string, body: unknown) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T | null> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  // FormData（ファイルアップロード）は Content-Type をブラウザに任せる（boundary 自動付与）。
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCookie("iq_csrf");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  const res = await fetch(`/api/v1${path}`, { ...init, method, headers, credentials: "include" });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = (body && typeof body === "object" && "code" in body && (body as { code?: string }).code) || "error";
    // セッション切れ（401）は一元でログインへ誘導＋理由を渡す（デザイン標準 §14 セッション終了時の通知）。
    // セキュリティ＝リダイレクト先は固定 `/login`（可変 next なし＝オープンリダイレクト防止）／認証系 EP は
    // 401 が想定内のため除外＋既に /login 上なら無処理（ループ＝自己 DoS 防止）／reason は非機密 enum のみ。
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/") && window.location.pathname !== "/login") {
      window.location.assign("/login?reason=session_expired");
    }
    throw new ApiError(res.status, code, body);
  }
  return body as T;
}
