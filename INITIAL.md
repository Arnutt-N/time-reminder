# INITIAL PROJECT OVERVIEW

🔒 **CRITICAL SECURITY NOTICE**: This repository has been security-hardened. All environment files contain PLACEHOLDER VALUES ONLY. Real credentials must be configured externally and NEVER committed to the repository.

## FEATURES:

### Core Functionality
- **6-Time Optimized Scheduling System**: Morning (07:25, 08:25, 09:25) and Afternoon (15:30, 16:30, 17:30) Thai time
- **Telegram Bot Integration**: Rich bot interactions with subscription management and admin commands  
- **TiDB Cloud Serverless**: Database backend with SSL/TLS security and connection pooling
- **Multi-environment Configuration**: Environment-specific settings using dotenv-flow
- **User & Holiday Management**: Subscription tracking and Thai holiday data integration

### Advanced Features
- **External Cron API**: `/api/cron` endpoint for GitHub Actions integration with Bearer token authentication
- **Security Enhancements**: Rate limiting (100/15min general, 10/1min cron), JSON body limits (256KB), token masking
- **Production Stabilization**: Cloud Run optimized initialization, webhook management, scheduler coordination
- **Message Deduplication**: Intelligent recipient deduplication to prevent duplicate notifications
- **Webhook Management**: Comprehensive webhook validation, health monitoring, and security features
- **Comprehensive Health Monitoring**: Multiple health check endpoints with service status validation
- **Thai Timezone Support**: Consistent Asia/Bangkok timezone handling throughout application
- **Express.js API Server**: RESTful endpoints with authentication and monitoring capabilities

## COMPONENTS:

### Core Application Files:
- **`index.js`** - Main application entry point with 6-time cron scheduling system, Express server, and production-safe Telegram bot initialization
- **`config.js`** - Production-safe configuration management with Cloud Run compatibility and graceful fallback
- **`config/production.js`** - Production-specific configuration without .env dependencies, with validation and secret management
- **`tidb-connection.js`** - Database layer with TiDB Cloud Serverless integration, connection pooling, and CRUD operations
- **`logger.js`** - Winston-based structured logging system with Thai timezone support and environment-specific formatting

### Production Services:
- **`src/services/scheduler-coordinator.js`** - Centralized scheduler coordination between GitHub Actions and internal cron
- **`src/services/webhook-manager.js`** - Comprehensive Telegram webhook management with validation and health monitoring
- **`src/utils/message-deduplicator.js`** - Intelligent message recipient deduplication with statistics tracking

### Deployment & Scripts:
- **`scripts/migrate-secrets.sh`** - Google Secret Manager migration script for production deployment
- **`Dockerfile`** - Cloud Run optimized container with CA certificates and production environment variables

### Configuration:
⚠️ **SECURITY WARNING**: All configuration files contain PLACEHOLDER VALUES only. Real credentials must be set externally.

- **Development Mode**: `env/` folder with environment-specific configuration files:
  - `.env` - Default environment variables ⚠️ **PLACEHOLDER VALUES ONLY**
  - `.env.development` - Development overrides ⚠️ **PLACEHOLDER VALUES ONLY**
  - `.env.production` - Production settings (development only) ⚠️ **PLACEHOLDER VALUES ONLY**
  - `.env.test` - Test environment configuration
- **Production Mode**: `config/production.js` with Cloud Run environment variables and Secret Manager integration
- **Secure Setup**: Use `DEPLOYMENT_GUIDE.md` for proper credential configuration

### Testing & Utilities:
- `test-connection.js` - Basic database connectivity testing
- `test-connection-pool.js` - Connection pool validation
- `test-sql-tidb.js` - SQL operations testing
- `check-tidb.js` - TiDB service status verification

## DOCUMENTATION:

- Node.js Telegram Bot API: https://github.com/yagop/node-telegram-bot-api
- TiDB Cloud Serverless: https://docs.pingcap.com/tidbcloud/
- node-cron: https://github.com/node-cron/node-cron
- dotenv-flow: https://github.com/kerimdzhanov/dotenv-flow

## SETUP CONSIDERATIONS:

🔒 **MANDATORY SECURITY REQUIREMENTS**:
- **NEVER commit real credentials** to the repository
- **ALL environment files contain PLACEHOLDER VALUES** - replace with real values externally
- **Previously exposed credentials MUST be rotated** before use
- **Use secure configuration methods** described in `DEPLOYMENT_GUIDE.md`

**Configuration Methods**:
- **Development**: Environment variables managed through dotenv-flow with environment-specific files in `env/` directory ⚠️ **USE REAL VALUES LOCALLY**
- **Production**: Cloud Run environment variables with Google Secret Manager integration (no .env files)
- **Cloud Build**: Use substitution variables with real values ⚠️ **CONFIGURE BEFORE DEPLOYMENT**

**Security & Setup**:
- TiDB connection requires proper SSL/TLS configuration for cloud connectivity
- Telegram bot token and chat IDs must be configured with NEW VALUES (not previously exposed ones)
- Production-safe bot initialization after server startup to prevent Cloud Run startup failures
- Docker deployment configured with dynamic PORT support and CA certificates for TiDB SSL
- Thai timezone (Asia/Bangkok) is used throughout the application
- Connection pooling implemented for database efficiency
- Message deduplication prevents duplicate notifications to users who are both users and admins
- Scheduler coordination prevents conflicts between GitHub Actions and internal cron
- Webhook management with comprehensive validation and health monitoring
- Logging system supports configurable log levels (DEBUG, INFO, WARN, ERROR) with token masking
- Enhanced .gitignore prevents accidental secret commits
- Security remediation documented in `SECURITY_REMEDIATION.md`

## DEVELOPMENT WORKFLOW:

- Use `npm run dev` for development with auto-restart and full .env support
- Use `npm run check-env` to verify environment configuration
- Use `npm run verify-env` to validate configuration object loading
- Database tests available for validating TiDB connectivity
- Docker support for containerized deployment with Cloud Run optimization
- Multiple environment support (development/production/test)
- Production deployment uses Google Secret Manager and Cloud Run environment variables
- Message deduplication testing and statistics tracking
- Webhook validation and health monitoring
- Scheduler coordination testing between external and internal cron modes