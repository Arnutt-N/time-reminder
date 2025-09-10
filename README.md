# Telegram Reminder Bot - Cloud Run Edition

A robust Telegram bot for sending scheduled reminders, optimized for Google Cloud Run with TiDB Cloud Serverless database integration.

## 🌟 Features

- ⏰ **Scheduled Reminders**: Automated reminders via GitHub Actions cron jobs
- 🇹🇭 **Thai Timezone Support**: Full Asia/Bangkok timezone handling
- 📱 **Telegram Integration**: Rich bot interactions and notifications
- 🗄️ **TiDB Cloud**: Serverless database with SSL security
- ☁️ **Google Cloud Run**: Serverless deployment with 99.95% SLA
- 📊 **Structured Logging**: Cloud Operations compatible JSON logs
- 🔒 **Security**: Authentication for cron endpoints and secure database connections
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
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxyz

# Get chat ID by messaging your bot and visiting:
# https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
TELEGRAM_CHAT_ID=-1001234567890
ADMIN_CHAT_ID=123456789

# TiDB Cloud Serverless connection (free tier)
TIDB_HOST=gateway01.ap-southeast-1.prod.aws.tidbcloud.com
TIDB_USER=your_username
TIDB_PASSWORD=your_password
TIDB_DATABASE=telegram_bot

# Generate with: openssl rand -hex 32
CRON_SECRET=your_32_character_random_string_here
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
   - Send morning reminder at 7:25 AM Thai time
   - Send afternoon message at 8:25 AM Thai time
   - Send evening reminder at 3:25 PM Thai time
   - Send evening message at 4:25 PM Thai time

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
- **Validation**: Database, Telegram API, webhook status
- **Cloud Run Metadata**: Service, revision, region information

### Logging

- **Development**: Human-readable format with file logging
- **Production**: Structured JSON for Cloud Operations
- **Thai Timezone**: All timestamps in Asia/Bangkok
- **Log Levels**: DEBUG, INFO, WARN, ERROR

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
| `TELEGRAM_BOT_TOKEN` | Bot API token from @BotFather | `123456789:ABC...` |
| `TELEGRAM_CHAT_ID` | Target chat for notifications | `-1001234567890` |
| `TIDB_HOST` | TiDB Cloud serverless endpoint | `gateway01.ap-southeast-1...` |
| `TIDB_USER` | Database username | `username.root` |
| `TIDB_PASSWORD` | Database password | `your_password` |
| `CRON_SECRET` | Authentication for cron endpoints | `random_32_char_string` |

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

### Authentication

- **Cron Endpoints**: Bearer token authentication
- **Database**: SSL/TLS encrypted connections
- **Secrets**: Environment variable isolation

### Best Practices

- Rotate secrets regularly
- Monitor access logs
- Use principle of least privilege
- Enable audit logging

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

#### Missing Reminders
1. Check GitHub Actions execution logs
2. Verify Thai timezone calculations
3. Test cron endpoint manually:
```bash
curl -X POST https://your-service-url.a.run.app/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"type":"morning","time":"07:25"}'
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

- **4 daily reminders × 30 days = 120 requests/month**
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

- **Requests**: Up to 2M/month on free tier
- **Instances**: 0-10 auto-scaling
- **Memory**: 256Mi per instance
- **Concurrent**: 80 requests per instance

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Test locally with `npm run dev`
4. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- [Google Cloud Run](https://cloud.google.com/run) for serverless hosting
- [TiDB Cloud](https://tidbcloud.com/) for serverless database
- [Telegram Bot API](https://core.telegram.org/bots/api) for bot functionality
- [GitHub Actions](https://github.com/features/actions) for cron scheduling