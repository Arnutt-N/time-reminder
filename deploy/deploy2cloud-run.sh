#!/usr/bin/env bash
# =============================================================================
# Telegram Time-Reminder - Secure Cloud Run Deployment Script
# =============================================================================
# Modes:
#   MODE=dev  : light checks, DB optional, NODE_ENV=development
#   MODE=prod : require DB env, NODE_ENV=production, adds DB secrets
#
# Usage (dev):
#   export GOOGLE_CLOUD_PROJECT=your-google-cloud-project-id
#   export TELEGRAM_BOT_TOKEN=xxxx:yyyy
#   export ADMIN_CHAT_ID=123456789
#   MODE=dev bash deploy.sh
#
# Usage (prod):
#   export TELEGRAM_BOT_TOKEN=xxxx:yyyy
#   export ADMIN_CHAT_ID=123456789
#   export TIDB_HOST=...
#   export TIDB_USER=...
#   export TIDB_PASSWORD=...
#   export TIDB_DATABASE=telegram_bot
#   # (optional) set CRON_SECRET, otherwise script will generate one
#   MODE=prod bash deploy.sh
# =============================================================================
set -euo pipefail

# ------------------------- Config --------------------------------------------
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-your-google-cloud-project-id}"
REGION="${REGION:-asia-southeast1}"
SERVICE_NAME="${SERVICE_NAME:-telegram-reminder-bot}"
REPO_NAME="${REPO_NAME:-time-reminder}"      # Artifact Registry (docker) repo
MODE="${MODE:-dev}"                          # dev | prod
CPU="${CPU:-1}"
MEMORY="${MEMORY:-256Mi}"
TIMEOUT="${TIMEOUT:-300}"                    # seconds
MAX_INSTANCES="${MAX_INSTANCES:-5}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
CONCURRENCY="${CONCURRENCY:-80}"
EXEC_ENV="${EXEC_ENV:-gen2}"                 # gen1 | gen2

# Image tagging
IMAGE_BASENAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"
IMAGE_TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
IMAGE_NAME="${IMAGE_BASENAME}:${IMAGE_TAG}"

# Service Account (dedicated for this service)
SA_NAME="${SERVICE_NAME}-sa"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Secrets (names in Secret Manager)
SM_TG_TOKEN="TELEGRAM_BOT_TOKEN"
SM_TIDB_PASSWORD="TIDB_PASSWORD"
SM_CRON_SECRET="CRON_SECRET"
SM_WEBHOOK_SECRET="TELEGRAM_WEBHOOK_SECRET"

# ------------------------- Pretty logs ---------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info(){  echo -e "${GREEN}[INFO]${NC} $*"; }
warn(){  echo -e "${YELLOW}[WARN]${NC} $*"; }
err(){   echo -e "${RED}[ERROR]${NC} $*"; }

# ------------------------- Helpers -------------------------------------------
ensure_gcloud() {
  info "Checking gcloud & auth..."
  command -v gcloud >/dev/null || { err "gcloud not found"; exit 1; }
  if ! gcloud auth list --filter="status:ACTIVE" --format="value(account)" | grep -q .; then
    err "No active gcloud account. Run: gcloud auth login"; exit 1
  fi
  gcloud config set project "$PROJECT_ID" >/dev/null
  gcloud config set run/region "$REGION" >/dev/null || true
  info "Project: $(gcloud config get-value project) | Region: $(gcloud config get-value run/region)"
}

enable_apis_and_repo() {
  info "Enabling APIs: run, cloudbuild, artifactregistry..."
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com containerregistry.googleapis.com

  if ! gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" >/dev/null 2>&1; then
    info "Creating Artifact Registry repo: $REPO_NAME ($REGION)"
    gcloud artifacts repositories create "$REPO_NAME" \
      --repository-format=docker \
      --location="$REGION" \
      --description="Time Reminder images"
  else
    info "Artifact Registry repo exists: $REPO_NAME"
  fi
}

ensure_service_account() {
  info "Ensuring service account: $SA_EMAIL"
  if ! gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$SA_NAME" --display-name "$SERVICE_NAME runtime SA"
  else
    info "Service account exists."
  fi
  # Minimal: allow reading secrets *we will grant per-secret later*
  # Cloud Run writes logs without extra roles; no broad roles needed here.
}

rand_token_safe() {
  # A–Z a–z 0–9 _ -
  python3 - <<'PY'
import secrets, string
alphabet = string.ascii_letters + string.digits + '_-'
print(''.join(secrets.choice(alphabet) for _ in range(48)))
PY
}

ensure_secret() {
  local name="$1"
  local value="${2:-}"
  local create_if_missing="${3:-true}"  # true|false
  if ! gcloud secrets describe "$name" >/dev/null 2>&1; then
    if [[ "$create_if_missing" != "true" ]]; then
      err "Secret $name not found and create_if_missing=false"
      exit 1
    fi
    info "Creating secret: $name"
    gcloud secrets create "$name" --replication-policy="automatic" >/dev/null
  fi
  if [[ -n "${value:-}" ]]; then
    info "Adding new version to secret: $name"
    printf "%s" "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  fi
}

grant_secret_access() {
  local name="$1"
  info "Granting Secret Accessor for $name to $SA_EMAIL"
  gcloud secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
}

validate_env_by_mode() {
  info "Validating env for MODE=$MODE"
  if [[ "$MODE" == "prod" ]]; then
    local need=( TELEGRAM_BOT_TOKEN ADMIN_CHAT_ID TIDB_HOST TIDB_USER TIDB_PASSWORD TIDB_DATABASE )
  else
    local need=( TELEGRAM_BOT_TOKEN ADMIN_CHAT_ID )
  fi
  local missing=()
  for k in "${need[@]}"; do [[ -n "${!k:-}" ]] || missing+=("$k"); done
  if (( ${#missing[@]} )); then
    err "Missing env: ${missing[*]}"; for k in "${missing[@]}"; do echo "  export $k=..."; done; exit 1
  fi
}

prepare_secrets() {
  info "Preparing secrets in Secret Manager..."

  # 1) Telegram Bot Token (required)
  ensure_secret "$SM_TG_TOKEN" "${TELEGRAM_BOT_TOKEN}"

  # 2) CRON_SECRET (optional env; otherwise generate)
  if [[ -z "${CRON_SECRET:-}" ]]; then
    CRON_SECRET="$(rand_token_safe)"
    info "Generated CRON_SECRET"
  fi
  ensure_secret "$SM_CRON_SECRET" "${CRON_SECRET}"

  # 3) Webhook secret (dedicated for Telegram webhook)
  if [[ -z "${TELEGRAM_WEBHOOK_SECRET:-}" ]]; then
    TELEGRAM_WEBHOOK_SECRET="$(rand_token_safe)"
    info "Generated TELEGRAM_WEBHOOK_SECRET"
  fi
  ensure_secret "$SM_WEBHOOK_SECRET" "${TELEGRAM_WEBHOOK_SECRET}"

  # 4) DB password only in prod
  if [[ "$MODE" == "prod" ]]; then
    ensure_secret "$SM_TIDB_PASSWORD" "${TIDB_PASSWORD}"
  fi

  # Grant runtime SA access only to required secrets
  grant_secret_access "$SM_TG_TOKEN"
  grant_secret_access "$SM_CRON_SECRET"
  grant_secret_access "$SM_WEBHOOK_SECRET"
  if [[ "$MODE" == "prod" ]]; then
    grant_secret_access "$SM_TIDB_PASSWORD"
  fi
}

build_image() {
  info "Building image: ${IMAGE_NAME}"
  gcloud builds submit . --tag "${IMAGE_NAME}"
  info "Image pushed."
}

deploy_service() {
  info "Deploying Cloud Run service: ${SERVICE_NAME}"
  local NODE_ENV_VALUE="development"; [[ "$MODE" == "prod" ]] && NODE_ENV_VALUE="production"

  # Base deploy (no APP_URL yet)
  gcloud run deploy "${SERVICE_NAME}" \
    --image "${IMAGE_NAME}" \
    --region "${REGION}" \
    --platform managed \
    --allow-unauthenticated \
    --service-account "${SA_EMAIL}" \
    --execution-environment "${EXEC_ENV}" \
    --ingress all \
    --port 8080 \
    --cpu "${CPU}" \
    --memory "${MEMORY}" \
    --max-instances "${MAX_INSTANCES}" \
    --min-instances "${MIN_INSTANCES}" \
    --timeout "${TIMEOUT}" \
    --concurrency "${CONCURRENCY}" \
    --set-env-vars "NODE_ENV=${NODE_ENV_VALUE},TZ=Asia/Bangkok,ADMIN_CHAT_ID=${ADMIN_CHAT_ID},TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-$ADMIN_CHAT_ID},TIDB_ENABLE_SSL=true,LOG_LEVEL=INFO,LOG_TO_FILE=false" \
    --set-secrets "TELEGRAM_BOT_TOKEN=${SM_TG_TOKEN}:latest" \
    --set-secrets "CRON_SECRET=${SM_CRON_SECRET}:latest"

  # Add DB config in prod
  if [[ "$MODE" == "prod" ]]; then
    gcloud run services update "${SERVICE_NAME}" --region "${REGION}" \
      --set-env-vars "TIDB_HOST=${TIDB_HOST},TIDB_PORT=${TIDB_PORT:-4000},TIDB_USER=${TIDB_USER},TIDB_DATABASE=${TIDB_DATABASE}" \
      --set-secrets "TIDB_PASSWORD=${SM_TIDB_PASSWORD}:latest"
  fi
}

set_app_url() {
  SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"
  if [[ -z "${SERVICE_URL}" ]]; then
    warn "Service URL empty, routing to latest and retrying..."
    gcloud run services update-traffic "${SERVICE_NAME}" --region "${REGION}" --to-latest
    SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format='value(status.url)')"
  fi
  [[ -n "${SERVICE_URL}" ]] || { err "Cannot get service URL"; exit 1; }
  info "Service URL: ${SERVICE_URL}"
  gcloud run services update "${SERVICE_NAME}" --region "${REGION}" \
    --set-env-vars "APP_URL=${SERVICE_URL}"
}

health_and_webhook() {
  info "Probing /ping and /health"
  curl -fsS "${SERVICE_URL}/ping" >/dev/null 2>&1 && info "/ping OK" || warn "/ping failed (not critical)"
  curl -fsS "${SERVICE_URL}/health" >/dev/null 2>&1 && info "/health OK" || { err "/health failed"; exit 1; }

  # Webhook (use secret_token)
  info "Configuring Telegram webhook with secret_token"
  curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook" >/dev/null
  curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
    -d "url=${SERVICE_URL}/bot${TELEGRAM_BOT_TOKEN}" \
    -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" >/dev/null

  info "Webhook info:"
  curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | jq . || true

  cat <<'NOTE'

✅ สำคัญ: เพื่อใช้ secret_token ให้ปลอดภัยจริง
   เพิ่มการตรวจ header ใน route /bot${token} ในโค้ดของคุณ (index.js):

   // ใน app.post(`/bot${token}`, ...)
   const hdr = req.get('X-Telegram-Bot-Api-Secret-Token')
   if (!hdr || hdr !== process.env.TELEGRAM_WEBHOOK_SECRET) {
     return res.sendStatus(401)
   }

แล้วตั้งค่า ENV TELEGRAM_WEBHOOK_SECRET ถูกผูกผ่าน Secret Manager แล้วจากสคริปต์นี้
NOTE
}

next_steps() {
  echo
  echo "🎉 Done. Service URL: ${SERVICE_URL}"
  echo "   Health: ${SERVICE_URL}/health"
  echo
  echo "🔐 Secrets stored in Secret Manager and mounted via --set-secrets"
  echo "   - ${SM_TG_TOKEN}"
  echo "   - ${SM_WEBHOOK_SECRET}"
  if [[ "$MODE" == "prod" ]]; then
    echo "   - ${SM_TIDB_PASSWORD}"
    echo "   - ${SM_CRON_SECRET}"
  else
    echo "   - ${SM_CRON_SECRET}"
  fi
  echo
  echo "📜 Logs (tail):"
  echo "  gcloud logs tail --region='${REGION}' --project='${PROJECT_ID}' --service='${SERVICE_NAME}'"
  echo
  if [[ "$MODE" == "prod" ]]; then
    echo "⚙️ Running in PRODUCTION"
  else
    echo "🧪 Running in DEVELOPMENT"
  fi
  echo
  echo "💡 แนะนำ:"
  echo "  - ใช้ .dockerignore เพื่อลดขนาดอิมเมจ"
  echo "  - หมุนเวียน (rotate) secrets เป็นระยะด้วย: gcloud secrets versions add"
}

main() {
  echo "🤖 Secure Deploy (${MODE^^}) → ${SERVICE_NAME} @ ${PROJECT_ID}/${REGION}"
  ensure_gcloud
  enable_apis_and_repo
  ensure_service_account
  validate_env_by_mode
  prepare_secrets
  build_image
  deploy_service
  set_app_url
  health_and_webhook
  next_steps
}

main "$@"
