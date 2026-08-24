FROM node:20-alpine AS build
RUN npm install -g pnpm
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/error-analyzer/package.json ./packages/error-analyzer/
COPY packages/performance-analyzer/package.json ./packages/performance-analyzer/
COPY packages/correlation-engine/package.json ./packages/correlation-engine/
COPY packages/incident-engine/package.json ./packages/incident-engine/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @pia/web build
RUN pnpm --filter @pia/api build

FROM node:20-alpine AS production
RUN npm install -g pnpm
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml* ./
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/error-analyzer ./packages/error-analyzer
COPY --from=build /app/packages/performance-analyzer ./packages/performance-analyzer
COPY --from=build /app/packages/correlation-engine ./packages/correlation-engine
COPY --from=build /app/packages/incident-engine ./packages/incident-engine
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN pnpm install --frozen-lockfile --prod
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]