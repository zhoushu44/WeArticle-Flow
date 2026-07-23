FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787

COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/api ./api
COPY --from=build /app/src/lib ./src/lib
COPY --from=build /app/layouts.json ./layouts.json
COPY --from=build /app/tsconfig.json ./tsconfig.json

EXPOSE 8787

CMD ["node", "--import", "tsx", "api/server.ts"]
