# Multi-stage build — เล็ก + secure
ARG NODE_VERSION=20-alpine

# ============= deps stage =============
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ============= runtime stage =============
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

# non-root user
RUN addgroup -S app && adduser -S app -G app

# copy deps + source
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=app:app . .

USER app

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Health check (Node 18+ has fetch built-in)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]