# Multi-stage build for smaller container size optimized for Google Cloud Run
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./

# Install production dependencies only and clean cache
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install curl for health checks and CA certificates for SSL (TiDB Cloud Serverless requirement)
RUN apk add --no-cache curl ca-certificates tzdata

# Copy production dependencies from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application code (exclude dev environment files)
COPY . .
RUN rm -rf env/ || true

# Create non-root user for security (Cloud Run best practice)
RUN addgroup -g 1001 -S nodejs && adduser -S telegrambot -u 1001

# Create directories with proper permissions
RUN mkdir -p /app/data /app/logs && \
    chown -R telegrambot:nodejs /app

# Switch to non-root user
USER telegrambot

# Cloud Run optimized environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV TZ=Asia/Bangkok
ENV CRON_MODE=external
ENV SIMULATE_START_ON_BOOT=false

# Expose port 8080 (Cloud Run default)
EXPOSE 8080

# Add healthcheck endpoint validation (not HEALTHCHECK directive for Cloud Run)
# Cloud Run will call /healthz and /readiness endpoints

# Optimize for Cloud Run startup
LABEL \
    org.opencontainers.image.title="Telegram Reminder Bot" \
    org.opencontainers.image.description="Production-ready Telegram reminder bot for Cloud Run" \
    org.opencontainers.image.vendor="Telegram Bot Project" \
    org.opencontainers.image.version="1.0.0"

# Start the application with optimized Node.js settings for Cloud Run
CMD ["node", "--max-old-space-size=256", "index.js"]