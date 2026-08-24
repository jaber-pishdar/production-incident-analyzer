FROM node:22-alpine AS build
RUN npm install -g pnpm@9
WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./

# Copy all package.json files for dependency resolution
COPY packages/shared/package.json ./packages/shared/
COPY packages/error-analyzer/package.json ./packages/error-analyzer/
COPY packages/performance-analyzer/package.json ./packages/performance-analyzer/
COPY packages/correlation-engine/package.json ./packages/correlation-engine/
COPY packages/incident-engine/package.json ./packages/incident-engine/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install dependencies (frozen lockfile ensures reproducible builds)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/error-analyzer/src ./packages/error-analyzer/src
COPY packages/error-analyzer/tsconfig.json ./packages/error-analyzer/
COPY packages/performance-analyzer/src ./packages/performance-analyzer/src
COPY packages/performance-analyzer/tsconfig.json ./packages/performance-analyzer/
COPY packages/correlation-engine/src ./packages/correlation-engine/src
COPY packages/correlation-engine/tsconfig.json ./packages/correlation-engine/
COPY packages/incident-engine/src ./packages/incident-engine/src
COPY packages/incident-engine/tsconfig.json ./packages/incident-engine/
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/web/src ./apps/web/src
COPY apps/web/tsconfig.json ./apps/web/
COPY apps/web/index.html ./apps/web/
COPY apps/web/vite.config.ts ./apps/web/
COPY apps/web/public ./apps/web/public

# Build all packages
RUN pnpm --filter @pia/shared build
RUN pnpm --filter @pia/error-analyzer build
RUN pnpm --filter @pia/performance-analyzer build
RUN pnpm --filter @pia/correlation-engine build
RUN pnpm --filter @pia/incident-engine build
RUN pnpm --filter @pia/web build
RUN pnpm --filter @pia/api build

# ─── Production stage ─── #
FROM node:22-alpine AS production
RUN npm install -g pnpm@9
WORKDIR /app

# Copy production artifacts
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml* ./
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/error-analyzer/package.json ./packages/error-analyzer/
COPY --from=build /app/packages/error-analyzer/dist ./packages/error-analyzer/dist
COPY --from=build /app/packages/performance-analyzer/package.json ./packages/performance-analyzer/
COPY --from=build /app/packages/performance-analyzer/dist ./packages/performance-analyzer/dist
COPY --from=build /app/packages/correlation-engine/package.json ./packages/correlation-engine/
COPY --from=build /app/packages/correlation-engine/dist ./packages/correlation-engine/dist
COPY --from=build /app/packages/incident-engine/package.json ./packages/incident-engine/
COPY --from=build /app/packages/incident-engine/dist ./packages/incident-engine/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

# Patch main fields to point to compiled JS (development points to src/index.ts)
RUN sed -i 's|"main": "src/index.ts"|"main": "dist/index.js"|' packages/shared/package.json \
  && sed -i 's|"main": "src/index.ts"|"main": "dist/index.js"|' packages/error-analyzer/package.json \
  && sed -i 's|"main": "src/index.ts"|"main": "dist/index.js"|' packages/performance-analyzer/package.json \
  && sed -i 's|"main": "src/index.ts"|"main": "dist/index.js"|' packages/correlation-engine/package.json \
  && sed -i 's|"main": "src/index.ts"|"main": "dist/index.js"|' packages/incident-engine/package.json

EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]