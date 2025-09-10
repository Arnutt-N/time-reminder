# 🔒 Secure Deployment Guide

## Security Best Practices

### ⚠️ NEVER commit secrets to git!

The deployment script has been updated to **NOT read secrets from local files** for security reasons.

## Deployment Steps

### 1. Set Environment Variables

Before running the deployment script, export your secrets:

```bash
# Required secrets - set these before deployment
export TELEGRAM_BOT_TOKEN="your_bot_token_here"
export TIDB_HOST="your-tidb-host.tidbcloud.com"
export TIDB_USER="your-username.root"
export TIDB_PASSWORD="your-secure-password"
export TIDB_DATABASE="telegram_bot"
export ADMIN_CHAT_ID="your_admin_chat_id"
export CRON_SECRET="$(openssl rand -hex 32)"

# Optional variables (have defaults)
export TELEGRAM_CHAT_ID="your_chat_id"  # defaults to ADMIN_CHAT_ID
export TIDB_PORT="4000"                 # defaults to 4000
export APP_URL="https://your-service.a.run.app"  # auto-generated if not set
```

### 2. Run Deployment

```bash
cd deploy
./deploy-to-cloud-run.sh
```

## Alternative: Use Google Secret Manager

For production environments, consider using Google Secret Manager:

```bash
# Store secrets in Secret Manager
gcloud secrets create telegram-bot-token --data-file=-
gcloud secrets create tidb-password --data-file=-

# Update Cloud Run to use secrets
gcloud run services update telegram-reminder-bot \
  --update-secrets TELEGRAM_BOT_TOKEN=telegram-bot-token:latest \
  --update-secrets TIDB_PASSWORD=tidb-password:latest \
  --region asia-southeast1
```

## Security Checklist

- [ ] Secrets are NOT in git repository
- [ ] Environment variables are set in secure shell session
- [ ] Local .env.production file is deleted after deployment
- [ ] Shell history is cleared after setting secrets
- [ ] Consider using Google Secret Manager for production

## Clear Secrets After Deployment

```bash
# Clear environment variables
unset TELEGRAM_BOT_TOKEN TIDB_PASSWORD CRON_SECRET
# Clear shell history
history -c
```