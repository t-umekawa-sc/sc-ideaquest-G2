FROM node:22-slim

ENV NODE_ENV=development
WORKDIR /app

# 依存を先に入れてレイヤキャッシュ
COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]
