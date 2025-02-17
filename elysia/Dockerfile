FROM oven/bun:latest AS base
WORKDIR /usr/src/app

FROM base AS release
COPY package.json bun.lock tsconfig.json ./
COPY src src
RUN bun install

ENV SERVICE_PORT=3001

ENTRYPOINT [ "bun", "run", "start" ]