# Ars-note v1.5.67 sync server Dockerfile.
# Multi-stage build: build TypeScript, then run with minimal image

# ── Stage 1: Build ──
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json ./
COPY tsconfig.json ./

# Install dev dependencies for build
RUN npm install

COPY src/ ./src/

RUN npm run build

# ── Stage 2: Production ──
FROM node:22-slim

WORKDIR /app

# Copy built files and package.json
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/package.json ./

# Production install — no devDependencies (currently zero runtime deps)
RUN npm install --omit=dev || true

# Create data directory for local backend
RUN mkdir -p /app/server-data

# Expose the sync server port
EXPOSE 8787

# Environment variables (override at runtime)
ENV ARSNOTE_PORT=8787
ENV ARSNOTE_HOST=0.0.0.0
ENV ARS_NOTE_STORAGE_BACKEND=local

# Non-root user for security
RUN groupadd -r arsnote && useradd -r -g arsnote arsnote
RUN chown -R arsnote:arsnote /app
USER arsnote

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:8787/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

CMD ["node", "dist/index.js"]
