# Troubleshooting Guide - Telegram Reminder Bot

This guide helps you diagnose and fix common issues with the Telegram Reminder Bot on Google Cloud Run.

## 🔍 Quick Diagnostics

### 1. Health Check First
Always start with the health endpoint:
```bash
curl https://your-service-url.a.run.app/health
```

Expected response:
```json
{
  "status": "ok",
  "platform": "google-cloud-run",
  "service": "telegram-reminder-bot",
  "checks": {
    "bot_initialized": true,
    "database": "connected",
    "telegram_api": "ok",
    "webhook": "configured",
    "timezone": "2024-01-15T12:30:00+07:00"
  }
}
```

### 2. Check Cloud Run Logs
```bash
# Real-time logs
gcloud logs tail --project=YOUR-PROJECT-ID

# Recent errors only
gcloud logs read "resource.type=cloud_run_revision AND severity>=ERROR" --limit=20

# Specific time range
gcloud logs read "resource.type=cloud_run_revision" --since="1h"
```

## 🚨 Common Issues

### Bot Not Receiving Messages

**Symptoms:**
- Health check shows webhook as "not_configured"
- No response to Telegram messages

**Diagnosis:**
```bash
# Check webhook status
curl -X GET "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo"
```

**Solutions:**

1. **Set webhook manually:**
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-service-url.a.run.app/api/telegram"}'
```

2. **Check bot token:**
```bash
# Test bot token
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getMe"
```

3. **Verify service is public:**
```bash
gcloud run services describe telegram-reminder-bot \
  --region=us-central1 --format="value(spec.traffic[0].percent)"
# Should return 100
```

### Database Connection Failures

**Symptoms:**
- Health check shows database as "failed" or "disconnected"
- Errors in logs about connection timeouts

**Diagnosis:**
```bash
# Test connection locally
node test-connection.js

# Check TiDB cluster status
curl -X GET "https://tidbcloud.com/console/clusters"
```

**Solutions:**

1. **SSL Certificate Issues:**
```javascript
// Verify SSL configuration in config.js
database: {
  ssl: process.env.TIDB_ENABLE_SSL === "true", // Should be true
  // ... other settings
}
```

2. **Connection Limits:**
```bash
# Check current connections
gcloud logs read 'resource.type=cloud_run_revision AND "connection"' --limit=10
```

3. **Firewall/Network:**
```bash
# Test connectivity from Cloud Shell
gcloud cloud-shell ssh
# Then test: telnet YOUR_TIDB_HOST 4000
```

### Cron Jobs Not Triggering

**Symptoms:**
- Scheduled reminders not being sent
- GitHub Actions showing failures

**Diagnosis:**

1. **Check GitHub Actions:**
```bash
# View workflow runs
gh run list --workflow=scheduled-reminders.yml

# View specific run details
gh run view <RUN_ID>
```

2. **Test cron endpoint manually:**
```bash
curl -X POST https://your-service-url.a.run.app/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"type":"test","time":"manual"}'
```

**Solutions:**

1. **Verify GitHub Secrets:**
```bash
# In your GitHub repository settings/secrets/actions
CLOUD_RUN_URL=https://your-service-url.a.run.app
CRON_SECRET=your_32_character_secret
```

2. **Check cron authentication:**
```bash
# Look for 401/403 errors in Cloud Run logs
gcloud logs read 'resource.type=cloud_run_revision AND "/api/cron"' --limit=10
```

3. **Timezone Issues:**
```bash
# Verify GitHub Actions cron times
# 25 0 * * 1-5  # 7:25 AM Thai (00:25 UTC)
# 25 1 * * 1-5  # 8:25 AM Thai (01:25 UTC)
```

### Memory or CPU Limits

**Symptoms:**
- Service becoming unresponsive
- 503 errors
- "Instance terminated" in logs

**Diagnosis:**
```bash
# Check resource usage
gcloud monitoring metrics list --filter="resource.type=cloud_run_revision"
```

**Solutions:**

1. **Increase Memory:**
```bash
gcloud run services update telegram-reminder-bot \
  --memory=512Mi --region=us-central1
```

2. **Adjust CPU:**
```bash
gcloud run services update telegram-reminder-bot \
  --cpu=1 --region=us-central1
```

3. **Check for Memory Leaks:**
```bash
# Monitor memory usage over time
gcloud monitoring metrics-descriptors list --filter="memory"
```

## 🔧 Environment Issues

### Configuration Problems

**Check environment variables:**
```bash
# List all env vars
gcloud run services describe telegram-reminder-bot \
  --region=us-central1 --format="value(spec.template.spec.template.spec.containers[0].env[].name)"

# Get specific variable
gcloud run services describe telegram-reminder-bot \
  --region=us-central1 --format="value(spec.template.spec.template.spec.containers[0].env[?name='NODE_ENV'].value)"
```

**Update environment variables:**
```bash
gcloud run services update telegram-reminder-bot \
  --update-env-vars NODE_ENV=production,LOG_LEVEL=DEBUG \
  --region=us-central1
```

### Secrets Management Issues

**Rotate secrets:**
```bash
# Generate new cron secret
openssl rand -hex 32

# Update GitHub secret
gh secret set CRON_SECRET --body "new_secret_here"

# Update Cloud Run
gcloud run services update telegram-reminder-bot \
  --update-env-vars CRON_SECRET=new_secret_here \
  --region=us-central1
```

## 📊 Performance Issues

### Slow Response Times

**Check metrics:**
```bash
gcloud monitoring metrics list --filter="response_latencies"
```

**Solutions:**

1. **Enable Cloud CDN:**
```bash
gcloud compute backend-services create telegram-bot-backend \
  --global --enable-cdn
```

2. **Increase concurrency:**
```bash
gcloud run services update telegram-reminder-bot \
  --concurrency=100 --region=us-central1
```

3. **Connection pooling:**
```javascript
// Verify in tidb-connection.js
connectionLimit: 20, // Increase if needed
```

### Cold Starts

**Symptoms:**
- First request takes >5 seconds
- Timeout errors on GitHub Actions

**Solutions:**

1. **Minimum instances:**
```bash
gcloud run services update telegram-reminder-bot \
  --min-instances=1 --region=us-central1
```

2. **Warm-up requests:**
```yaml
# Add to GitHub Actions
- name: Warm up service
  run: curl -f https://your-service-url.a.run.app/health
```

## 🛠️ Development Issues

### Local Development Problems

**Docker issues:**
```bash
# Build locally
docker build -t telegram-bot-test .

# Run with environment
docker run --env-file .env.development -p 8080:8080 telegram-bot-test

# Debug container
docker run -it --entrypoint /bin/sh telegram-bot-test
```

**Node.js issues:**
```bash
# Check Node version
node --version  # Should be 18.x

# Install dependencies
npm install

# Clear cache
npm cache clean --force
```

### Testing Locally

**Environment setup:**
```bash
# Copy production config
cp .env.production.example .env.development

# Use local database settings
# Set TIDB_HOST=localhost if running TiDB locally
```

**Database testing:**
```bash
# Test each connection script
node test-connection.js
node test-connection-pool.js
node test-sql-tidb.js
node test-tidb.js
node check-tidb.js
```

## 🔍 Advanced Debugging

### Enable Debug Logging

**Temporarily enable debug mode:**
```bash
gcloud run services update telegram-reminder-bot \
  --update-env-vars LOG_LEVEL=DEBUG \
  --region=us-central1
```

**Watch debug logs:**
```bash
gcloud logs read 'resource.type=cloud_run_revision AND severity=DEBUG' --follow
```

### Traffic Analysis

**View request patterns:**
```bash
gcloud logs read 'resource.type=cloud_run_revision AND httpRequest.requestMethod="POST"' \
  --format="value(httpRequest.requestUrl, timestamp)"
```

**Check error rates:**
```bash
gcloud logs read 'resource.type=cloud_run_revision AND httpRequest.status>=400' \
  --limit=50
```

### Database Query Analysis

**Enable query logging:**
```javascript
// In tidb-connection.js, temporarily add:
const connection = mysql.createConnection({
  // ... other config
  debug: process.env.LOG_LEVEL === 'DEBUG',
  trace: true
})
```

## 📞 Support Resources

### Documentation Links
- [Cloud Run Troubleshooting](https://cloud.google.com/run/docs/troubleshooting)
- [TiDB Cloud Support](https://docs.pingcap.com/tidbcloud/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

### Useful Commands

**Service Information:**
```bash
# Get service details
gcloud run services describe telegram-reminder-bot --region=us-central1

# List revisions
gcloud run revisions list --service=telegram-reminder-bot --region=us-central1

# Get service URL
gcloud run services describe telegram-reminder-bot --region=us-central1 --format="value(status.url)"
```

**Monitoring:**
```bash
# Service metrics
gcloud run services describe telegram-reminder-bot --region=us-central1 --format="value(status.conditions)"

# Error budget
gcloud logging metrics list --filter="name:error"
```

### Emergency Recovery

**Rollback to previous revision:**
```bash
# List revisions
gcloud run revisions list --service=telegram-reminder-bot --region=us-central1

# Rollback
gcloud run services update-traffic telegram-reminder-bot \
  --to-revisions=telegram-reminder-bot-00001-abc=100 \
  --region=us-central1
```

**Complete redeployment:**
```bash
# Redeploy with Cloud Build
gcloud builds submit --config cloudbuild.yaml

# Or use deployment script
./deploy/deploy-to-cloud-run.sh
```

## 🔔 When to Get Help

Contact support when:
- Issues persist after following this guide
- Service shows sustained errors >1 hour
- Data integrity concerns
- Security incidents
- Billing anomalies

Include in your support request:
- Service URL and project ID
- Error messages from logs
- Steps you've already tried
- Timeline of when issues started