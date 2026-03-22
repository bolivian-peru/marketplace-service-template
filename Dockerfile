FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Install dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Run
EXPOSE 3000
ENV PORT=3000

CMD ["bun", "run", "src/index.ts"]
