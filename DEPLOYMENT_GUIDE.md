# 🚀 Secure Deployment Guide

**CRITICAL**: After secret removal, deployment processes need proper configuration to work correctly.

## 🚨 Required Actions Before Any Deployment

### 1. **Set Up Google Cloud Build Substitution Variables**

In your Cloud Build trigger, configure these substitution variables:

```yaml
# Required Substitution Variables for cloudbuild.yaml
_TELEGRAM_BOT_TOKEN: "YOUR_ACTUAL_BOT_TOKEN"
_TELEGRAM_CHAT_ID: "YOUR_ACTUAL_CHAT_ID"
_ADMIN_CHAT_ID: "YOUR_ACTUAL_ADMIN_CHAT_ID"
_TIDB_HOST: "YOUR_ACTUAL_TIDB_HOST"
_TIDB_USER: "YOUR_ACTUAL_TIDB_USER"
_TIDB_PASSWORD: "YOUR_ACTUAL_TIDB_PASSWORD"
_CRON_SECRET: "YOUR_ACTUAL_CRON_SECRET"
```

### 2. **Set Up GitHub Actions Secrets**

Configure these secrets in your GitHub repository:

```yaml
# Required GitHub Secrets for scheduled-reminders.yml
CLOUD_RUN_URL: "https://your-actual-service-url.a.run.app"
CRON_SECRET: "YOUR_ACTUAL_CRON_SECRET"
```

## 🔧 Deployment Methods

### Method 1: Cloud Build (Recommended)

1. **Configure Cloud Build Trigger**:
   ```bash
   # Create trigger with proper substitutions
   gcloud builds triggers create github \
     --repo-name=time-reminder \
     --repo-owner=YOUR_GITHUB_USERNAME \
     --branch-pattern="^main$" \
     --build-config=cloudbuild.yaml \
     --substitutions=_TELEGRAM_BOT_TOKEN="YOUR_TOKEN",_TIDB_PASSWORD="YOUR_PASSWORD"
   ```

2. **The fixed cloudbuild.yaml will**:
   - ✅ Build Docker image dynamically
   - ✅ Deploy to Cloud Run with correct environment variables
   - ✅ Perform dynamic health check (no hardcoded URLs)
   - ✅ Handle traffic routing automatically

### Method 2: Manual Deployment Scripts

**Option A: Using deploy2cloud-run.sh** (Recommended)
```bash
# Set required environment variables
export GOOGLE_CLOUD_PROJECT="your-actual-project-id"
export TELEGRAM_BOT_TOKEN="your-actual-token"
export ADMIN_CHAT_ID="your-actual-chat-id"
export TIDB_PASSWORD="your-actual-password"
export CRON_SECRET="your-actual-secret"

# Run deployment
MODE=prod bash deploy/deploy2cloud-run.sh
```

**Option B: Using deploy-to-cloud-run.sh**
```bash
# Set environment variables first
export GOOGLE_CLOUD_PROJECT="your-actual-project-id"
# ... (all other required vars)

bash deploy/deploy-to-cloud-run.sh
```

## 🛡️ Secret Management Best Practices

### Development Environment
```bash
# Create local .env files (gitignored)
cp env/.env.example env/.env.development
# Edit with your development values
```

### Production Environment
```bash
# Use Google Secret Manager
gcloud secrets create telegram-bot-token --data-file=token.txt
gcloud secrets create tidb-password --data-file=password.txt
gcloud secrets create cron-secret --data-file=secret.txt

# Grant Cloud Run access
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 🔍 Post-Deployment Verification

### 1. **Health Check**
```bash
# Get your service URL
SERVICE_URL=$(gcloud run services describe telegram-reminder-bot \
  --region=us-central1 --format="value(status.url)")

# Test health endpoint
curl "$SERVICE_URL/health"
```

### 2. **Cron Endpoint Test**
```bash
# Test with your actual cron secret
curl -X POST "$SERVICE_URL/api/cron" \
  -H "Authorization: Bearer YOUR_ACTUAL_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"type":"morning","time":"07:25"}'
```

### 3. **Webhook Verification**
```bash
# Check webhook status
curl "$SERVICE_URL/webhook-info"
```

## 🚨 Troubleshooting Deployment Issues

### Problem: "Health check failed"
**Cause**: Service not responding or misconfigured environment variables
**Solution**:
```bash
# Check service logs
gcloud logs read "resource.type=cloud_run_revision" --limit=50

# Verify environment variables are set
gcloud run services describe telegram-reminder-bot --region=us-central1
```

### Problem: "Cron endpoint returns 401"
**Cause**: CRON_SECRET mismatch between GitHub Actions and Cloud Run
**Solution**:
```bash
# Update GitHub secret
gh secret set CRON_SECRET --body "your-actual-secret"

# Update Cloud Run environment
gcloud run services update telegram-reminder-bot \
  --region=us-central1 \
  --set-env-vars CRON_SECRET="your-actual-secret"
```

### Problem: "Telegram bot not responding"
**Cause**: Invalid TELEGRAM_BOT_TOKEN or webhook misconfiguration
**Solution**:
```bash
# Test bot token locally
curl "https://api.telegram.org/botYOUR_TOKEN/getMe"

# Reset webhook via API
curl -X POST "$SERVICE_URL/reset-webhook" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## 📋 Pre-Deployment Checklist

- [ ] **Cloud Build substitution variables configured**
- [ ] **GitHub Actions secrets set**
- [ ] **Google Cloud project ID updated in scripts**
- [ ] **All placeholder values replaced with actual credentials**
- [ ] **Cloud Run service account has Secret Manager access**
- [ ] **Telegram bot token is valid and active**
- [ ] **TiDB database is accessible and credentials are correct**
- [ ] **CRON_SECRET matches between GitHub and Cloud Run**

## 🔒 Security Verification

### Before Committing
```bash
# Scan for any remaining secrets
grep -r "bot[0-9]*:" . --exclude-dir=.git
grep -r "telegram-reminder-bot-471714" . --exclude-dir=.git
grep -r "5875921382\|nzVobpS1LMBuyQuK" . --exclude-dir=.git
```

### After Deployment
```bash
# Verify no secrets in logs
gcloud logs read "resource.type=cloud_run_revision" --filter="textPayload:bot"
```

## 📞 Emergency Procedures

### If Deployment Fails Completely
1. **Rollback to previous revision**:
   ```bash
   gcloud run services update-traffic telegram-reminder-bot \
     --to-revisions=PREVIOUS_REVISION=100 --region=us-central1
   ```

2. **Check service status**:
   ```bash
   gcloud run services describe telegram-reminder-bot --region=us-central1
   ```

3. **Debug with local container**:
   ```bash
   docker build -t test-bot .
   docker run -p 8080:8080 --env-file .env.production test-bot
   ```

---

**⚠️ CRITICAL REMINDER**: Never commit actual secrets to the repository. Always use the secure methods described above.