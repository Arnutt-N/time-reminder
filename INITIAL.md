# INITIAL PROJECT OVERVIEW

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
- **Comprehensive Health Monitoring**: Multiple health check endpoints with service status validation
- **Thai Timezone Support**: Consistent Asia/Bangkok timezone handling throughout application
- **Express.js API Server**: RESTful endpoints with authentication and monitoring capabilities

## COMPONENTS:

### Core Application Files:
- **`index.js`** - Main application entry point with 6-time cron scheduling system, Express server, and Telegram bot initialization
- **`config.js`** - Environment-aware configuration management using dotenv-flow with multi-environment support
- **`tidb-connection.js`** - Database layer with TiDB Cloud Serverless integration, connection pooling, and CRUD operations
- **`logger.js`** - Winston-based structured logging system with Thai timezone support and environment-specific formatting

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