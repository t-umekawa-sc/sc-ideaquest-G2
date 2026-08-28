# QA/受入は本番ビルドで配信する（next dev のオンデマンド compile による「F5 で CSS が剥がれる」現象を回避）。
# 本番ビルドはハッシュ付き CSS を確定的に参照するため、リロードでスタイルが外れない。
# ※ コード変更を反映するにはイメージ再ビルドが必要（`docker compose up -d --build frontend`）。
# ※ 素早いコード反復はホストの `npm run dev`（HMR）を使う（フロントエンド実装フロー規約）。
FROM node:22-slim
WORKDIR /app

# 依存を先に入れてレイヤキャッシュ（build には devDependencies が要るので全部入れる）。
COPY package.json ./
RUN npm install

COPY . .

# Next の /api リライト先（next.config.ts）は**ビルド時に焼かれる**ため、build 前に compose ネットワークの
# backend を指しておく（未設定だと localhost:8000 の fallback が焼かれ、コンテナ内で ECONNREFUSED になる）。
ARG BACKEND_ORIGIN=http://backend:8000
ENV BACKEND_ORIGIN=$BACKEND_ORIGIN

# 本番ビルド（.next を生成）。dynamic ページは実行時サーバーレンダ＝build に backend 不要。
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start"]
