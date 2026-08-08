import type { NextConfig } from "next";

// ブラウザは常に同一オリジン(:3000)と通信し、/api/v1/* は backend へプロキシする（§4.1 薄いBFF）。
// これにより CORS 不要＋CSRF ダブルサブミット（iq_csrf を JS が読む）が同一オリジンで成立する。
const backend = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  images: { unoptimized: true }, // 自前アセットを配信するため画像最適化サーバは使わない
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` }];
  },
};

export default nextConfig;
