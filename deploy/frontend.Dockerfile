FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src/ ./src/
RUN npm run build
FROM caddy:2.11.4-alpine
COPY --from=build /build/dist /srv/skymeet
COPY deploy/frontend.Caddyfile /etc/caddy/Caddyfile
