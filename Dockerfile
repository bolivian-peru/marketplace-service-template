# Build stage
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Runtime stage
FROM oven/bun:1-alpine
WORKDIR /app

# Don't run as root
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/index.ts"]
