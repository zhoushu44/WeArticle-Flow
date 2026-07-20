FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

COPY package.json package-lock.json ./
RUN npm ci

COPY --from=build /app/dist ./dist
COPY --from=build /app/api ./api
COPY --from=build /app/src/lib ./src/lib
COPY --from=build /app/tsconfig.json ./tsconfig.json

EXPOSE 8787
CMD ["node", "--import", "tsx", "api/server.ts"]
