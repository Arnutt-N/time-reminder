# 📚 Git Bash User Manual for Telegram Reminder Bot Project

**Complete guide for managing your Telegram Reminder Bot using Git Bash**

---

## 📁 **Project Structure Overview**

```
D:/hrProject/time-reminder/
├── 📄 index.js              # Main bot application
├── 📄 config.js             # Configuration management
├── 📄 logger.js             # Logging system
├── 📄 tidb-connection.js    # Database operations
├── 📄 cloudbuild.yaml       # Cloud Build deployment config
├── 📄 package.json          # Node.js dependencies
├── 📄 Dockerfile           # Container configuration
├── 📂 env/                 # Environment variables (development)
│   ├── .env.example
│   ├── .env.development
│   └── .env.production
├── 📂 src/secrets/         # Secret management (production)
│   ├── secret-manager.js
│   └── secret-validator.js
├── 📂 scripts/             # Utility scripts
│   ├── setup-secrets.sh
│   └── validate-secrets.js
└── 📂 PRPs/                # Project requirements
    └── secret-manager-integration.md
```

---

## 🚀 **Getting Started**

### **1. Open Git Bash**
```bash
# Navigate to project directory
cd /d/hrProject/time-reminder

# Verify you're in the right place
pwd
# Expected output: /d/hrProject/time-reminder

# List project files
ls -la
```

### **2. Initial Setup**
```bash
# Check Node.js and npm
node --version
npm --version

# Install dependencies if needed
npm install

# Verify gcloud CLI
gcloud --version
gcloud auth list
gcloud config get project
```

---

## 🔧 **Daily Development Commands**

### **Environment Management**
```bash
# Check current environment configuration
npm run check-env

# Verify configuration loads correctly
npm run verify-env

# Check what environment variables are set
printenv | grep -E "(NODE_ENV|TELEGRAM|TIDB)" | sort
```

### **Development Server**
```bash
# Start development server with auto-restart
npm run dev

# Start production mode locally
npm run prod

# Start test mode
npm run test

# Regular start
npm start
```

### **Testing & Validation**
```bash
# Test database connection
node test-connection.js

# Test TiDB specific functions
node test-tidb.js

# Test SQL operations
node test-sql-tidb.js

# Run secret manager validation
node scripts/validate-secrets.js

# Check configuration integrity
node -e "const config = require('./config'); console.log('Config OK:', !!config.env);"
```

---

## ☁️ **Google Cloud Operations**

### **Authentication & Project Setup**
```bash
# Login to Google Cloud
gcloud auth login

# Set your project
gcloud config set project your-project-id

# Verify authentication and project
gcloud auth list
gcloud config get project

# List available projects
gcloud projects list
```

### **Cloud Build Operations**
```bash
# List existing triggers
gcloud builds triggers list --format="table(name,id,github.name,github.branch)"

# Describe specific trigger
gcloud builds triggers describe [TRIGGER_ID]

# Update trigger with substitution variables
gcloud builds triggers update [TRIGGER_ID] \
  --substitutions="_TELEGRAM_BOT_TOKEN=your_token,\
_TELEGRAM_CHAT_ID=your_chat_id,\
_ADMIN_CHAT_ID=your_admin_chat_id,\
_TELEGRAM_WEBHOOK_SECRET=your_webhook_secret,\
_CRON_SECRET=your_cron_secret,\
_TIDB_HOST=your_tidb_host,\
_TIDB_USER=your_tidb_user,\
_TIDB_PASSWORD=your_tidb_password"

# Submit build manually
gcloud builds submit --config cloudbuild.yaml

# Monitor build progress
gcloud builds list --limit=5
gcloud builds log --stream [BUILD_ID]

# Cancel a running build
gcloud builds cancel [BUILD_ID]
```

### **Cloud Run Operations**
```bash
# List Cloud Run services
gcloud run services list --region=asia-southeast1

# Describe your service
gcloud run services describe telegram-reminder-bot --region=asia-southeast1

# Get service URL
SERVICE_URL=$(gcloud run services describe telegram-reminder-bot \
  --region=asia-southeast1 --format="value(status.url)")
echo "Service URL: $SERVICE_URL"

# View real-time logs
gcloud run services logs tail telegram-reminder-bot --region=asia-southeast1

# View recent logs
gcloud run services logs read telegram-reminder-bot \
  --region=asia-southeast1 --limit=50

# Update service configuration
gcloud run services update telegram-reminder-bot \
  --region=asia-southeast1 \
  --memory=512Mi \
  --cpu=1 \
  --max-instances=10
```

---

## 🔐 **Secret & Configuration Management**

### **Setup Scripts**
```bash
# Make setup script executable
chmod +x scripts/setup-secrets.sh

# Show help
./scripts/setup-secrets.sh --help

# Check current configuration status
./scripts/setup-secrets.sh --check-only

# Run full setup (if using Secret Manager)
./scripts/setup-secrets.sh

# Use specific project
./scripts/setup-secrets.sh -p your-project-id
```

### **Environment Testing**
```bash
# Test with development environment
NODE_ENV=development npm run verify-env

# Test with production environment (using substitution variables)
NODE_ENV=production \
_TELEGRAM_BOT_TOKEN=test123 \
_TIDB_HOST=testhost \
npm run verify-env

# Test secret manager loading
NODE_ENV=production \
SKIP_SECRET_MANAGER=true \
_TELEGRAM_BOT_TOKEN=test123 \
node scripts/validate-secrets.js
```

### **Health Checks**
```bash
# Local health check (if server is running)
curl -s http://localhost:3000/health | jq .

# Production health check
curl -s "$SERVICE_URL/health" | jq .

# Check webhook status
curl -s "$SERVICE_URL/webhook-info" | jq .

# Test API endpoint
curl -s "$SERVICE_URL/api/validate-secrets" | jq .
```

---

## 🚀 **Deployment Workflow**

### **Pre-deployment Checklist**
```bash
# 1. Run syntax validation
node --check src/secrets/secret-manager.js
node --check src/secrets/secret-validator.js
node --check config.js

# 2. Test environment configuration
npm run check-env
npm run verify-env

# 3. Validate secrets (if using Secret Manager)
node scripts/validate-secrets.js

# 4. Check git status
git status
git log --oneline -5
```

### **Deploy to Production**
```bash
# Method 1: Trigger build via git push (recommended)
git add .
git commit -m "feat: update bot configuration"
git push origin main

# Method 2: Manual build submission
gcloud builds submit --config cloudbuild.yaml

# Method 3: Build with specific tag
gcloud builds submit --tag gcr.io/your-project/telegram-reminder-bot:v1.2.0
```

### **Post-deployment Verification**
```bash
# Check build status
gcloud builds list --limit=1

# Verify service is running
gcloud run services list --region=asia-southeast1

# Test health endpoint
SERVICE_URL=$(gcloud run services describe telegram-reminder-bot \
  --region=asia-southeast1 --format="value(status.url)")
curl -s "$SERVICE_URL/health" | jq .

# Monitor logs for errors
gcloud run services logs tail telegram-reminder-bot \
  --region=asia-southeast1 | head -20

# Test bot functionality (send /start to your Telegram bot)
```

---

## 🐛 **Troubleshooting Guide**

### **Common Issues & Solutions**

**1. "gcloud command not found"**
```bash
# Install Google Cloud CLI
# Download from: https://cloud.google.com/sdk/docs/install
# After installation, restart Git Bash

# Verify installation
which gcloud
gcloud --version
```

**2. "Authentication required"**
```bash
# Login again
gcloud auth login

# Set application default credentials
gcloud auth application-default login

# Verify authentication
gcloud auth list
```

**3. "Permission denied" errors**
```bash
# Make scripts executable
chmod +x scripts/setup-secrets.sh
chmod +x scripts/validate-secrets.js

# Check file permissions
ls -la scripts/
```

**4. "Module not found" errors**
```bash
# Reinstall dependencies
rm -rf node_modules
npm install

# Check for missing dependencies
npm audit
npm ls --depth=0
```

**5. "Build failed" errors**
```bash
# Check build logs
gcloud builds log [BUILD_ID]

# Common fixes:
# - Verify cloudbuild.yaml syntax
# - Check substitution variables are set
# - Ensure Docker build context is correct

# Test local Docker build
docker build -t test-image .
```

**6. "Service deployment failed"**
```bash
# Check Cloud Run logs
gcloud run services logs read telegram-reminder-bot --region=asia-southeast1

# Common fixes:
# - Verify environment variables
# - Check database connectivity
# - Ensure proper health check endpoints
```

### **Debug Commands**
```bash
# Check environment variables in production
gcloud run services describe telegram-reminder-bot \
  --region=asia-southeast1 \
  --format="export" | grep env

# Test database connection locally
node -e "
const { initializeDatabase } = require('./tidb-connection');
initializeDatabase().then(() => console.log('✅ DB OK')).catch(console.error);
"

# Test secret loading
node -e "
const { initializeSecretManager } = require('./src/secrets/secret-manager');
initializeSecretManager().then(s => console.log('✅ Secrets OK:', Object.keys(s).length)).catch(console.error);
"
```

---

## 📊 **Monitoring & Maintenance**

### **Log Monitoring**
```bash
# Real-time logs with filtering
gcloud run services logs tail telegram-reminder-bot \
  --region=asia-southeast1 \
  --filter="severity>=ERROR"

# Export logs to file
gcloud run services logs read telegram-reminder-bot \
  --region=asia-southeast1 \
  --format="value(timestamp,severity,textPayload)" > bot-logs.txt

# Search logs for specific patterns
gcloud run services logs read telegram-reminder-bot \
  --region=asia-southeast1 \
  --filter="textPayload:\"error\"" \
  --limit=10
```

### **Performance Monitoring**
```bash
# Check service metrics
gcloud run services describe telegram-reminder-bot \
  --region=asia-southeast1 \
  --format="table(status.conditions[].type,status.conditions[].status)"

# Monitor resource usage
gcloud run services describe telegram-reminder-bot \
  --region=asia-southeast1 \
  --format="value(spec.template.spec.containers[].resources)"

# Check revision status
gcloud run revisions list \
  --service=telegram-reminder-bot \
  --region=asia-southeast1
```

### **Maintenance Tasks**
```bash
# Update dependencies
npm update
npm audit fix

# Clean up old revisions (keep last 3)
gcloud run revisions list \
  --service=telegram-reminder-bot \
  --region=asia-southeast1 \
  --format="value(metadata.name)" | \
  tail -n +4 | \
  xargs -I {} gcloud run revisions delete {} --region=asia-southeast1

# Backup configuration
mkdir -p backups/$(date +%Y-%m-%d)
cp cloudbuild.yaml backups/$(date +%Y-%m-%d)/
cp package.json backups/$(date +%Y-%m-%d)/
```

---

## 📝 **Quick Reference Commands**

### **Essential One-Liners**
```bash
# Quick health check
curl -s $(gcloud run services describe telegram-reminder-bot --region=asia-southeast1 --format="value(status.url)")/health | jq .status

# Quick deploy
git add . && git commit -m "update" && git push

# Quick logs
gcloud run services logs tail telegram-reminder-bot --region=asia-southeast1 --limit=10

# Quick service status
gcloud run services list --filter="metadata.name=telegram-reminder-bot"

# Quick build status
gcloud builds list --limit=1 --format="table(id,status,createTime)"
```

### **Emergency Commands**
```bash
# Stop all traffic (emergency)
gcloud run services update telegram-reminder-bot \
  --region=asia-southeast1 \
  --no-allow-unauthenticated

# Restore traffic
gcloud run services update telegram-reminder-bot \
  --region=asia-southeast1 \
  --allow-unauthenticated

# Rollback to previous revision
PREV_REVISION=$(gcloud run revisions list --service=telegram-reminder-bot --region=asia-southeast1 --format="value(metadata.name)" | sed -n 2p)
gcloud run services update-traffic telegram-reminder-bot \
  --region=asia-southeast1 \
  --to-revisions=$PREV_REVISION=100
```

---

## 🎯 **Best Practices**

### **Git Bash Usage**
```bash
# Always use forward slashes for paths
cd /d/hrProject/time-reminder  # ✅ Correct
cd D:\hrProject\time-reminder   # ❌ Might cause issues

# Use tab completion
cd /d/hr<TAB>  # Auto-completes to /d/hrProject/

# Use history and aliases
history | grep gcloud
alias deploy="gcloud builds submit --config cloudbuild.yaml"
```

### **Security**
```bash
# Never commit real secrets
git status
git diff  # Check before committing

# Use environment variables for sensitive data
export TELEGRAM_TOKEN="your-token"
echo $TELEGRAM_TOKEN

# Clear sensitive variables when done
unset TELEGRAM_TOKEN
```

### **Development Workflow**
```bash
# Test locally before deploying
npm run dev
# Test your changes
# Then deploy

# Use meaningful commit messages
git commit -m "feat: add user notification preferences"
git commit -m "fix: resolve database connection timeout"
git commit -m "docs: update API documentation"
```

---

## 🔥 **Advanced Git Bash Tips**

### **Aliases & Shortcuts**
```bash
# Add these to your ~/.bashrc file
alias ll="ls -la"
alias gst="git status"
alias glog="git log --oneline -10"
alias deploy="gcloud builds submit --config cloudbuild.yaml"
alias logs="gcloud run services logs tail telegram-reminder-bot --region=asia-southeast1"
alias health="curl -s \$(gcloud run services describe telegram-reminder-bot --region=asia-southeast1 --format=\"value(status.url)\")/health | jq ."

# Reload aliases
source ~/.bashrc
```

### **Environment Variables**
```bash
# Set up common variables for your session
export PROJECT_ID="your-project-id"
export REGION="asia-southeast1"
export SERVICE_NAME="telegram-reminder-bot"

# Use variables in commands
gcloud run services describe $SERVICE_NAME --region=$REGION
```

### **History & Search**
```bash
# Search command history
history | grep gcloud

# Reverse search (Ctrl+R)
# Type Ctrl+R, then type part of a previous command

# Execute previous command
!!

# Execute command from history by number
!123  # Execute command #123 from history
```

---

## 📋 **Cheat Sheet**

### **Most Used Commands**
| Task | Command |
|------|---------|
| Navigate to project | `cd /d/hrProject/time-reminder` |
| Start development | `npm run dev` |
| Deploy to production | `git add . && git commit -m "update" && git push` |
| Check logs | `gcloud run services logs tail telegram-reminder-bot --region=asia-southeast1` |
| Health check | `curl -s "$SERVICE_URL/health" \| jq .` |
| List builds | `gcloud builds list --limit=5` |
| Update trigger | `gcloud builds triggers update [ID] --substitutions="..."` |

### **File Shortcuts**
| File | Purpose | Quick Edit |
|------|---------|------------|
| `config.js` | Configuration | `code config.js` |
| `index.js` | Main bot logic | `code index.js` |
| `cloudbuild.yaml` | Deployment | `code cloudbuild.yaml` |
| `package.json` | Dependencies | `code package.json` |
| `.env.example` | Env template | `code env/.env.example` |

### **Git Bash Shortcuts**
| Shortcut | Action |
|----------|--------|
| `Tab` | Auto-complete |
| `Ctrl+C` | Cancel command |
| `Ctrl+R` | Search history |
| `Ctrl+L` | Clear screen |
| `↑/↓` | Navigate history |
| `Ctrl+A` | Go to line start |
| `Ctrl+E` | Go to line end |

---

## 🆘 **Emergency Procedures**

### **If Bot Stops Working**
```bash
# 1. Check service status
gcloud run services describe telegram-reminder-bot --region=asia-southeast1

# 2. Check recent logs for errors
gcloud run services logs read telegram-reminder-bot --region=asia-southeast1 --limit=20

# 3. Check health endpoint
curl -s "$SERVICE_URL/health"

# 4. If needed, rollback to previous version
PREV_REVISION=$(gcloud run revisions list --service=telegram-reminder-bot --region=asia-southeast1 --format="value(metadata.name)" | sed -n 2p)
gcloud run services update-traffic telegram-reminder-bot --region=asia-southeast1 --to-revisions=$PREV_REVISION=100
```

### **If Build Fails**
```bash
# 1. Check build logs
gcloud builds list --limit=1
gcloud builds log [BUILD_ID]

# 2. Check syntax locally
node --check config.js
node --check index.js

# 3. Test Docker build locally
docker build -t test-bot .

# 4. Check trigger configuration
gcloud builds triggers describe [TRIGGER_ID]
```

### **If Database Issues**
```bash
# 1. Test database connection
node test-connection.js

# 2. Check database configuration
npm run verify-env

# 3. Test with debug logging
DEBUG=* node test-connection.js

# 4. Check TiDB Cloud status
# Visit: https://tidbcloud.com/console
```

---

**🚀 Happy coding with Git Bash!** This manual covers all the essential commands you'll need for managing your Telegram Reminder Bot project.

**📧 Need help?** Reference this manual or check the project's GitHub issues for common problems and solutions.

**🔄 Keep this manual updated** as you add new features and workflows to your project.