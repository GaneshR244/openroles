# OpenRoles backend image. The same image runs the API and the daily fetch script:
#   API:        node dist/main.js                    (default)
#   Migrations: npx prisma migrate deploy            (run once per release, before the API)
#   Daily job:  node dist/scripts/fetch-jobs.js --trigger=cron   (from cron at 00:30 UTC)
# The fetch can take up to 90 minutes, so run it on an always-on host, never a serverless function.

FROM node:22-slim AS build
WORKDIR /app
RUN npm install -g npm@11
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-fund --no-audit
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --no-fund --no-audit

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
