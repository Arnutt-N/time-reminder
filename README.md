# Telegram Reminder Bot - Cloud Run Edition

A robust Telegram bot for sending scheduled reminders, optimized for Google Cloud Run with TiDB Cloud Serverless database integration.

## 🌟 Features

- ⏰ **6-Time Optimized Scheduling**: Morning (07:25, 08:25, 09:25) and Afternoon (15:30, 16:30, 17:30) Thai time
- 🇹🇭 **Thai Timezone Support**: Full Asia/Bangkok timezone handling
- 📱 **Telegram Integration**: Rich bot interactions with subscription management and admin commands
- 🗄️ **TiDB Cloud**: Serverless database with SSL security and connection pooling
- ☁️ **Google Cloud Run**: Serverless deployment with 99.95% SLA
- 📊 **Structured Logging**: Cloud Operations compatible JSON logs
- 🔒 **Enhanced Security**: Rate limiting (100/15min general, 10/1min cron), Bearer token auth, JSON body limits (256KB)
- 🛡️ **Security Enhancements**: Token masking, time validation, comprehensive input sanitization
- 🆓 **Free Tier Friendly**: Designed to run within free tier limits

## 🚀 Quick Start

### Prerequisites

1. **Google Cloud Account**: [Sign up for free](https://cloud.google.com/free)
2. **TiDB Cloud Account**: [Create serverless cluster](https://tidbcloud.com/)
3. **Telegram Bot**: [Create with @BotFather](https://t.me/BotFather)
4. **GitHub Repository**: For cron job automation

### 1. Environment Setup

1. Copy the environment template:
```bash
cp .env.production.example .env.production
```

2. Fill in your configuration values:
```bash
# Get Telegram bot token from @BotFather
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Get chat ID by messaging your bot and visiting:
# https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
TELEGRAM_CHAT_ID=your_telegram_chat_id_here
ADMIN_CHAT_ID=your_admin_chat_id_here

# TiDB Cloud Serverless connection (free tier)
TIDB_HOST=your_tidb_host_here
TIDB_USER=your_tidb_username
TIDB_PASSWORD=your_secure_password
TIDB_DATABASE=telegram_bot

# Generate with: openssl rand -hex 32
CRON_SECRET=your_random_secret_string_here
```

### 2. Deploy to Google Cloud Run

#### Option A: Automated Script (Recommended)

```bash
# Make the script executable
chmod +x deploy/deploy-to-cloud-run.sh

# Deploy with GitHub setup
./deploy/deploy-to-cloud-run.sh --setup-github

# Follow the prompts and note the service URL
```

#### Option B: Manual Deployment

```bash
# 1. Enable required APIs
gcloud services enable cloudbuild.googleapis.com run.googleapis.com

# 2. Build and submit to Cloud Build
gcloud builds submit --config cloudbuild.yaml

# 3. The Cloud Build will automatically deploy to Cloud Run
```

#### Option C: Direct Docker Deployment

```bash
# 1. Build and push image
docker build -t gcr.io/YOUR-PROJECT-ID/telegram-reminder-bot .
docker push gcr.io/YOUR-PROJECT-ID/telegram-reminder-bot

# 2. Deploy to Cloud Run
gcloud run deploy telegram-reminder-bot \
  --image gcr.io/YOUR-PROJECT-ID/telegram-reminder-bot \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080
```

### 3. Setup GitHub Actions Cron

1. Get your Cloud Run service URL:
```bash
gcloud run services describe telegram-reminder-bot \
  --region=us-central1 --format="value(status.url)"
```

2. Add GitHub repository secrets:
   - `CLOUD_RUN_URL`: Your Cloud Run service URL
   - `CRON_SECRET`: The secret from your .env.production file

3. The GitHub Actions workflow (`.github/workflows/scheduled-reminders.yml`) will automatically:
   - Send morning reminders at 7:25, 8:25, and 9:25 AM Thai time
   - Send afternoon reminders at 3:30, 4:30, and 5:30 PM Thai time
   - 6-time optimized scheduling system for better coverage

## 📋 Architecture

### Cloud Run Benefits

- **No Sleep Mode**: Unlike Render free tier, always responsive
- **99.95% SLA**: Enterprise-grade reliability
- **Auto-scaling**: Scales to zero when not in use
- **Free Tier**: 2M requests/month, 360K GB-seconds/month
- **Structured Logs**: Integrated with Google Cloud Operations

### Component Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  GitHub Actions │────│  Google Cloud    │────│  TiDB Cloud     │
│  (Cron Jobs)    │    │  Run Service     │    │  Serverless     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         │ POST /api/cron         │ Database queries       │
         │ (authenticated)        │ (SSL encrypted)        │
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Telegram Bot   │────│  Application     │────│  User & Holiday │
│  Notifications  │    │  Logic & Logs    │    │  Data Storage   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🛠️ Development

### Local Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Test database connection
npm run test-db

# Verify environment configuration
npm run check-env
```

### Available Scripts

- `npm start` - Production mode
- `npm run dev` - Development with auto-restart
- `npm run prod` - Production with NODE_ENV=production
- `npm run test` - Test mode
- `npm run check-env` - Verify environment variables
- `npm run verify-env` - Validate configuration object

### Environment Files

The application supports multiple environment files in the `env/` directory:
- `.env` - Default variables
- `.env.development` - Development overrides
- `.env.production` - Production settings
- `.env.test` - Test environment

## 📊 Monitoring & Logging

### Health Checks

- **Health Endpoint**: `GET /health`
- **Validation**: Database connection, Telegram API, webhook status, cron job status
- **Cloud Run Metadata**: Service, revision, region information
- **6-Time Schedule Status**: All cron jobs (07:25, 08:25, 09:25, 15:30, 16:30, 17:30)

### Enhanced Logging

- **Development**: Human-readable format with file logging
- **Production**: Structured JSON for Cloud Operations
- **Thai Timezone**: All timestamps in Asia/Bangkok timezone
- **Log Levels**: DEBUG, INFO, WARN, ERROR
- **Security Logging**: Token masking, rate limiting alerts, validation failures
- **Cron Logging**: Detailed execution logs for all 6 scheduled times
- **MarkdownV2 Support**: Proper message formatting with escape handling

### Viewing Logs

```bash
# Real-time logs
gcloud logs tail --project=YOUR-PROJECT-ID

# Filter by severity
gcloud logs read "resource.type=cloud_run_revision AND severity>=ERROR"

# View in Cloud Console
# https://console.cloud.google.com/logs/query
```

## 🔧 Configuration Reference

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot API token from @BotFather | `your_bot_token` |
| `TELEGRAM_CHAT_ID` | Target chat for notifications | `your_chat_id` |
| `ADMIN_CHAT_ID` | Admin chat for notifications | `your_admin_id` |
| `TIDB_HOST` | TiDB Cloud serverless endpoint | `your_tidb_host` |
| `TIDB_USER` | Database username | `your_tidb_username` |
| `TIDB_PASSWORD` | Database password | `your_secure_password` |
| `TIDB_DATABASE` | Database name | `telegram_bot` |
| `CRON_SECRET` | Authentication for cron endpoints | `your_random_secret` |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Runtime environment |
| `LOG_LEVEL` | `INFO` | Logging level |
| `LOG_TO_FILE` | `false` | Enable file logging |
| `TIDB_DATABASE` | `telegram_bot` | Database name |
| `TIDB_PORT` | `4000` | Database port |
| `PORT` | `8080` | Application port |

## 🔒 Security

### Enhanced Security Features

- **Rate Limiting**: 100 requests per 15 minutes (general), 10 requests per minute (cron endpoints)
- **Bearer Token Authentication**: Secure API endpoint access with token masking in logs
- **Input Validation**: Comprehensive time format validation (07:25, 08:25, 09:25, 15:30, 16:30, 17:30)
- **Request Size Limits**: JSON body limited to 256KB to prevent abuse
- **Database Security**: SSL/TLS encrypted connections with connection pooling
- **Token Security**: Automatic token masking in all log outputs
- **Webhook Validation**: Secure webhook handling with comprehensive error logging

### API Endpoints Security

- **`/api/cron`**: Protected by Bearer token authentication and rate limiting (10/min)
- **`/health`**: Public endpoint for service monitoring
- **`/api/*`**: General API rate limiting (100 per 15 minutes)

### Best Practices

- Rotate secrets regularly (especially CRON_SECRET)
- Monitor access logs for suspicious activity
- Use principle of least privilege for database access
- Enable audit logging for all API endpoints
- Validate all time parameters against allowed values
- Implement comprehensive error handling with security logging

## 🚨 Troubleshooting

### Common Issues

#### Bot Not Responding
```bash
# Check health endpoint
curl https://your-service-url.a.run.app/health

# View logs
gcloud logs read "resource.type=cloud_run_revision" --limit=50
```

#### Database Connection Issues
```bash
# Test TiDB connection locally
node test-connection.js

# Check SSL configuration
node test-tidb.js
```

#### Cron Jobs Not Working
1. Verify GitHub repository secrets are set
2. Check GitHub Actions workflow runs
3. Validate CRON_SECRET matches
4. Confirm Cloud Run service is accessible
5. Verify time format in API requests (must match: 07:25, 08:25, 09:25, 15:30, 16:30, 17:30)
6. Check rate limiting (max 10 requests per minute for cron endpoint)

#### Missing Reminders
1. Check GitHub Actions execution logs
2. Verify Thai timezone calculations
3. Test cron endpoint manually:
```bash
# Morning reminders
curl -X POST https://your-service-url.a.run.app/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"type":"morning","time":"07:25"}'

# Afternoon reminders
curl -X POST https://your-service-url.a.run.app/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"type":"afternoon","time":"15:30"}'
```

### Getting Help

1. **Check Logs**: Start with Cloud Run logs
2. **Health Check**: Verify `/health` endpoint
3. **Test Locally**: Run in development mode
4. **GitHub Issues**: Report bugs with logs attached

## 💡 Cost Optimization

### Free Tier Limits

- **Cloud Run**: 2M requests, 360K GB-seconds/month
- **TiDB Cloud**: 5GB storage, 10K requests/day
- **GitHub Actions**: 2,000 minutes/month

### Usage Estimates

- **6 daily reminders × 30 days = 180 requests/month**
- **Well within all free tier limits**
- **Estimated cost: $0/month**

## 🔄 Migration from Render

If migrating from Render, the key differences:

1. **No Sleep Mode**: Cloud Run doesn't sleep
2. **Environment Variables**: Set via Cloud Run console
3. **Port Configuration**: Uses 8080 instead of 3000
4. **External Cron**: GitHub Actions replaces internal cron
5. **Structured Logging**: JSON format for production

## 📈 Scaling

The application is designed to scale automatically:

- **Requests**: Up to 2M/month on free tier (6 daily reminders = 180/month)
- **Instances**: 0-10 auto-scaling with health monitoring
- **Memory**: 256Mi per instance with connection pooling
- **Concurrent**: 80 requests per instance with rate limiting protection
- **Security**: Built-in rate limiting and input validation for protection

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Test locally with `npm run dev`
4. Test database connectivity with `npm run check-env`
5. Validate environment configuration
6. Test all 6 cron endpoints (07:25, 08:25, 09:25, 15:30, 16:30, 17:30)
7. Verify rate limiting and security features
8. Submit a pull request with comprehensive testing

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- [Google Cloud Run](https://cloud.google.com/run) for serverless hosting
- [TiDB Cloud](https://tidbcloud.com/) for serverless database
- [Telegram Bot API](https://core.telegram.org/bots/api) for bot functionality
- [GitHub Actions](https://github.com/features/actions) for cron scheduling