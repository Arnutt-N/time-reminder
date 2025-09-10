# INITIAL PROJECT OVERVIEW

## FEATURE:

- Telegram reminder bot with TiDB Cloud Serverless database integration
- Multi-environment configuration system using dotenv-flow
- User subscription management and holiday data management
- Cron-based scheduling system for automated reminders
- Express.js health check endpoint for monitoring

## COMPONENTS:

### Core Application Files:
- `index.js` - Main application entry point with bot initialization and cron scheduling
- `config.js` - Environment-aware configuration management using dotenv-flow
- `tidb-connection.js` - Database layer with connection pooling and data operations
- `logger.js` - Winston-based logging system with Thai timezone support

### Configuration:
- `env/` folder contains environment-specific configuration files:
  - `.env` - Default environment variables
  - `.env.development` - Development overrides
  - `.env.production` - Production settings
  - `.env.test` - Test environment configuration

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

- Environment variables are managed through dotenv-flow with environment-specific files in `env/` directory
- TiDB connection requires proper SSL/TLS configuration for cloud connectivity
- Telegram bot token and chat IDs must be configured in environment files
- Docker deployment configured with dynamic PORT support for cloud platforms
- Thai timezone (Asia/Bangkok) is used throughout the application
- Connection pooling is implemented for database efficiency
- Logging system supports configurable log levels (DEBUG, INFO, WARN, ERROR)

## DEVELOPMENT WORKFLOW:

- Use `npm run dev` for development with auto-restart
- Use `npm run check-env` to verify environment configuration
- Database tests available for validating TiDB connectivity
- Docker support for containerized deployment
- Multiple environment support (development/production/test)