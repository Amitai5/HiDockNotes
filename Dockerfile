# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24-bookworm-slim
ARG APP_BUILD=source
FROM ${NODE_IMAGE} AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/electron/package.json apps/electron/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/jensen-protocol/package.json packages/jensen-protocol/package.json
RUN npm install --global npm@11.21.0 --ignore-scripts

FROM manifests AS source
RUN --mount=type=cache,target=/root/.npm npm ci --workspace=apps/web --workspace=apps/server --workspace=packages/core --workspace=packages/jensen-protocol --include=dev --ignore-scripts --no-audit --no-fund
COPY apps/web apps/web
COPY apps/server apps/server
COPY packages/core packages/core
COPY packages/jensen-protocol packages/jensen-protocol
RUN npm run build:web

# CI copies the single tested Vite/Node compilation; image jobs never rebuild it.
FROM scratch AS prebuilt
COPY apps/web/dist /app/apps/web/dist
COPY apps/server/dist /app/apps/server/dist

FROM ${APP_BUILD} AS compiled

FROM manifests AS production-dependencies
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN --mount=type=cache,target=/root/.npm npm ci --workspace=apps/server --workspace=packages/core --workspace=packages/jensen-protocol --omit=dev --ignore-scripts --no-audit --no-fund
RUN --mount=type=cache,target=/root/.cache/ffmpeg-static-nodejs node node_modules/ffmpeg-static/install.js
COPY scripts/release/prune-container.cjs scripts/release/prune-container.cjs
RUN node scripts/release/prune-container.cjs
# Validate native modules separately: speech and semantic search load different ONNX libraries.
RUN node -e "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('CREATE VIRTUAL TABLE t USING fts5(text)');d.close()"
RUN node -e "if(typeof require('sherpa-onnx-node').OfflineRecognizer!=='function')process.exit(1)"
RUN node -e "import('@huggingface/transformers').catch(e=>{console.error(e);process.exit(1)})"

FROM ${NODE_IMAGE} AS runtime
ARG VERSION=development
ARG REVISION=unknown
LABEL org.opencontainers.image.title="HiDockNotes" \
      org.opencontainers.image.description="Private recording library, browser USB sync, transcription and meeting assistant" \
      org.opencontainers.image.source="https://github.com/Amitai5/HiDockNotes" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$REVISION
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data BACKUP_DIR=/backups WEB_DIR=/app/apps/web/dist \
    CHATGPT_CALLBACK_BIND=127.0.0.1 OMP_NUM_THREADS=4 HF_HOME=/data/cache/huggingface
# Debian's slim image includes tar but not the bzip2 executable required by model archives.
RUN apt-get update && apt-get install -y --no-install-recommends bzip2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY scripts/release/archive-smoke.cjs scripts/release/archive-smoke.cjs
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/packages/core/package.json ./packages/core/package.json
COPY --from=production-dependencies /app/packages/jensen-protocol/package.json ./packages/jensen-protocol/package.json
COPY --from=production-dependencies /app/apps/server/package.json ./apps/server/package.json
COPY --from=compiled /app/apps/web/dist ./apps/web/dist
COPY --from=compiled /app/apps/server/dist ./apps/server/dist
COPY LICENSE THIRD_PARTY_NOTICES.md ./
RUN mkdir /data /backups && chown node:node /data /backups
USER node
RUN node scripts/release/archive-smoke.cjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.cjs"]
