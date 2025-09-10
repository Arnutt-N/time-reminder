# Multi-stage build for smaller container size optimized for Google Cloud Run
FROM node:18-alpine as builder

WORKDIR /app

# Copy the environment file
COPY env/.env.production ./env/

# Copy package files for dependency installation
COPY package*.json ./

# Install production dependencies only and clean cache
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install curl for health checks (Cloud Run requirement)
RUN apk add --no-cache curl

# Copy production dependencies from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create non-root user for security (Cloud Run best practice)
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Set ownership of app directory
RUN chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Cloud Run specific environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV TZ=Asia/Bangkok

# Expose port 8080 (Cloud Run default)
EXPOSE 8080

# Cloud Run handles health checks, no need for HEALTHCHECK directive
# Create data directory for holidays (if needed)
RUN mkdir -p /app/data

# Start the application
CMD ["node", "index.js"]