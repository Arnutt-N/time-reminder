# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Telegram reminder bot (`telegram-reminder-bot`) that sends scheduled notifications using TiDB Cloud Serverless as the database backend. The bot manages user subscriptions, holiday data, and cron-based scheduling for reminder notifications.

## Development Commands

### Environment Setup
- `npm install` - Install dependencies
- `npm run check-env` - Verify environment variables are loaded correctly
- `npm run verify-env` - Validate configuration object

### Running the Application
- `npm start` - Run in production mode
- `npm run dev` - Run in development mode with auto-restart (uses node-dev)
- `npm run prod` - Run in production mode with NODE_ENV=production
- `npm run test` - Run in test mode with NODE_ENV=test

### Testing Database Connection
- `node test-connection.js` - Basic database connection test
- `node test-connection-pool.js` - Connection pool testing
- `node test-sql-tidb.js` - SQL operations testing
- `node test-tidb.js` - TiDB-specific functionality test
- `node check-tidb.js` - TiDB status check

## Architecture

### Core Components

**Main Application (`index.js`)**
- Central entry point that initializes all components
- Manages Telegram bot instance and Express server
- Coordinates cron jobs and event handlers
- Implements singleton pattern to prevent multiple initializations

**Configuration System (`config.js`)**
- Environment-aware configuration using `dotenv-flow`
- Supports multiple environments (.env, .env.development, .env.production, .env.test)
- Configuration files located in `env/` directory
- Centralizes all application settings including database, Telegram, and logging

**Database Layer (`tidb-connection.js`)**
- TiDB Cloud Serverless integration with connection pooling
- User management functions (subscription handling)
- Holiday data management (CRUD operations)
- Database initialization and schema management

**Logging System (`logger.js`)**
- Winston-based logging with configurable levels (DEBUG, INFO, WARN, ERROR)
- Environment-aware log level configuration
- Thai timezone support with dayjs

### Key Features

**User Management**
- Telegram user registration and subscription management
- Per-user subscription status tracking
- Admin functionality for user management

**Holiday Management**
- JSON-based holiday data storage and database integration
- Holiday search and filtering capabilities
- Import/export functionality for holiday data

**Scheduling System**
- Node-cron based reminder scheduling with 6-time optimized system
- Morning slots: 07:25, 08:25, 09:25 Thai time
- Afternoon slots: 15:30, 16:30, 17:30 Thai time  
- Thai timezone (Asia/Bangkok) support with consistency throughout
- External API cron trigger support via `/api/cron` endpoint

## Environment Configuration

The application uses environment-specific configuration files in the `env/` directory:
- `.env` - Default environment variables
- `.env.development` - Development-specific overrides
- `.env.production` - Production-specific overrides  
- `.env.test` - Test environment configuration

### Required Environment Variables
- `TELEGRAM_BOT_TOKEN` - Telegram bot API token
- `TELEGRAM_CHAT_ID` - Default chat ID for notifications
- `TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`, `TIDB_PASSWORD`, `TIDB_DATABASE` - TiDB connection details
- `NODE_ENV` - Environment mode (development/production/test)
- `CRON_SECRET` - Bearer token for external cron API endpoint authentication
- `TELEGRAM_WEBHOOK_SECRET` - Optional webhook secret for additional security

## Database Schema

The application expects TiDB tables for:
- User management with subscription status
- Holiday data storage
- Reminder scheduling metadata

Database initialization is handled automatically on first connection through `initializeDatabase()`.

## Docker Deployment

The application includes a Dockerfile configured for:
- Node.js 18 slim base image
- Dynamic PORT configuration for deployment platforms
- Health check endpoint
- Volume mounting for persistent data

## Development Notes

### State Management
- Uses initialization flags to prevent duplicate setups (`botInitialized`, `appInitialized`, etc.)
- Connection pooling for database efficiency
- Graceful error handling and logging throughout

### Thai Language Support
- Comments and log messages primarily in Thai
- Thai timezone handling for all date/time operations
- Holiday data likely includes Thai cultural holidays

### Testing Strategy
- Multiple test files for different components
- Environment-specific test configuration
- Database connection and SQL operation testing

### Security Features
- Rate limiting on API endpoints (100 req/15min general, 10 req/1min cron)
- JSON body size limits (256KB) to prevent DoS attacks
- Bearer token authentication for `/api/cron` endpoint
- Enhanced webhook validation with secret token support
- Token masking in logs to prevent credential exposure
- Time validation for cron requests (6-slot allowlist)

### API Endpoints
- `GET /` - Basic health check
- `GET /health` - Comprehensive health check with service status
- `GET /ping` - Simple ping endpoint  
- `POST /api/cron` - External cron trigger (authenticated)
- `GET /webhook-info` - Telegram webhook information
- `POST /reset-webhook` - Reset Telegram webhook (admin)
- `POST /bot{token}` - Telegram webhook endpoint

### Current Cron Schedule (6-Time System)
The bot now operates on an optimized 6-time notification system:

**Morning Reminders (Thai Time):**
- 07:25 (00:25 UTC) - First morning reminder + check-in alert
- 08:25 (01:25 UTC) - Second morning message + check-in alert  
- 09:25 (02:25 UTC) - Third morning message + check-in alert

**Afternoon/Evening Reminders (Thai Time):**
- 15:30 (08:30 UTC) - Afternoon reminder + check-out alert
- 16:30 (09:30 UTC) - Evening message + check-out alert
- 17:30 (10:30 UTC) - Late evening wrap-up + check-out alert

All cron jobs include:
- Holiday checking with automatic skip functionality
- User subscription validation
- Thai timezone consistency (Asia/Bangkok)
- Comprehensive error logging
- Graceful error handling with database connection pooling

### Integration with GitHub Actions
The `/api/cron` endpoint accepts external triggers with:
- Bearer token authentication using `CRON_SECRET`
- Time validation against 6-slot allowlist: ["07:25", "08:25", "09:25", "15:30", "16:30", "17:30"]
- Type validation (morning/afternoon/evening)
- Rate limiting protection (10 requests per minute)
- Comprehensive request logging with IP tracking

### Dependencies
- `express-rate-limit` - API rate limiting middleware
- `node-telegram-bot-api` - Telegram Bot API integration
- `node-cron` - Cron job scheduling with timezone support
- `mysql2` - TiDB Cloud Serverless database connectivity
- `winston` - Structured logging with Thai timezone support
- `dayjs` - Date/time handling with timezone plugins
- `dotenv-flow` - Environment configuration management