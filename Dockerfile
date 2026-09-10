# syntax=docker/dockerfile:1

FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts ./
COPY shared ./shared
COPY server ./server
COPY web ./web
COPY assets ./assets
RUN pnpm build

FROM node:24-slim AS runtime
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=production \
    PORT=3000
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# server bundle 只把 @resvg/resvg-js 留成 external，其餘依賴已經 inline 進 dist-server
RUN pnpm install --frozen-lockfile --prod && pnpm store prune
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY assets/fonts ./assets/fonts

# node:24-slim 內建 uid 1000 的 node 使用者；server 只讀檔案，不需要 root
USER node

EXPOSE 3000
CMD ["node", "dist-server/index.mjs"]
