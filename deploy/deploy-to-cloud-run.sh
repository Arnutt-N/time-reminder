#!/bin/bash

# Cloud Run Deployment Script for Telegram Reminder Bot
# This script automates the deployment process to Google Cloud Run

set -e
echo "🚀 Starting deployment to Google Cloud Run..."

# =============================================================================
# Configuration
# =============================================================================

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-your-google-cloud-project-id}"
SERVICE_NAME="telegram-reminder-bot"
REGION="asia-southeast1"
REPO_NAME="time-reminder"
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"

# =============================================================================
# Colors for output
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# =============================================================================
# Helper functions
# =============================================================================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# =============================================================================
# Check prerequisites
# =============================================================================

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if gcloud is installed
    if ! command -v gcloud &> /dev/null; then
        log_error "Google Cloud CLI is not installed. Please install it first."
        exit 1
    fi

    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install it first."
        exit 1
    fi

    # Check if logged in to gcloud
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1 > /dev/null; then
        log_error "Not authenticated with Google Cloud. Run 'gcloud auth login' first."
        exit 1
    fi

    # Set project if provided
    if [ ! -z "$PROJECT_ID" ] && [ "$PROJECT_ID" != "asia-southeast1" ]; then
        gcloud config set project $PROJECT_ID
        log_info "Set project to: $PROJECT_ID"
    else
        PROJECT_ID=$(gcloud config get-value project)
        if [ -z "$PROJECT_ID" ]; then
            log_error "No project set. Please provide GOOGLE_CLOUD_PROJECT environment variable or set default project."
            exit 1
        fi
        log_info "Using current project: $PROJECT_ID"
    fi
}

# =============================================================================
# Enable required APIs
# =============================================================================

enable_apis() {
    log_info "Enabling required Google Cloud APIs..."
    gcloud services enable cloudbuild.googleapis.com
    gcloud services enable run.googleapis.com
    gcloud services enable containerregistry.googleapis.com
    gcloud services enable artifactregistry.googleapis.com
    log_info "APIs enabled successfully"
}

# =============================================================================
# Build and push Docker image
# =============================================================================

build_and_push() {
    log_info "Building and pushing Docker image to Artifact Registry..."
    
    # The gcloud builds submit command builds the image from the Dockerfile and pushes it to Artifact Registry
    gcloud builds submit . --tag $IMAGE_NAME:latest
    
    log_info "Image built and pushed successfully to: $IMAGE_NAME:latest"
}

# =============================================================================
# Deploy to Cloud Run
# =============================================================================

deploy_service() {
    log_info "Deploying to Cloud Run..."
    
    # Security Note: Environment variables should be set via Cloud Run console or gcloud commands
    # Do NOT read secrets from local files for security reasons
    
    log_info "Setting essential environment variables for Cloud Run..."
    
    # Required environment variables that should be set externally:
    # TELEGRAM_BOT_TOKEN, TIDB_HOST, TIDB_USER, TIDB_PASSWORD, etc.
    
    # Check if required environment variables are available
    REQUIRED_VARS=(
        "TELEGRAM_BOT_TOKEN"
        "TIDB_HOST" 
        "TIDB_USER"
        "TIDB_PASSWORD"
        "TIDB_DATABASE"
        "ADMIN_CHAT_ID"
        "CRON_SECRET"
    )
    
    MISSING_VARS=()
    for var in "${REQUIRED_VARS[@]}"; do
        if [ -z "${!var}" ]; then
            MISSING_VARS+=("$var")
        fi
    done
    
    if [ ${#MISSING_VARS[@]} -ne 0 ]; then
        log_error "Missing required environment variables: ${MISSING_VARS[*]}"
        log_error "Please set these variables before deployment:"
        for var in "${MISSING_VARS[@]}"; do
            echo "  export $var=your_value_here"
        done
        exit 1
    fi
    
    # Use multiple --set-env-vars flags to handle special characters properly
    log_info "Deploying with environment variables..."

    # Deploy the service with environment variables using multiple --set-env-vars flags
    gcloud run deploy $SERVICE_NAME \
        --image $IMAGE_NAME:latest \
        --platform managed \
        --region $REGION \
        --allow-unauthenticated \
        --port 8080 \
        --memory 256Mi \
        --cpu 1 \
        --max-instances 10 \
        --min-instances 0 \
        --timeout 300 \
        --concurrency 80 \
        --set-env-vars "NODE_ENV=production" \
        --set-env-vars "TZ=Asia/Bangkok" \
        --set-env-vars "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN" \
        --set-env-vars "TIDB_HOST=$TIDB_HOST" \
        --set-env-vars "TIDB_PORT=${TIDB_PORT:-4000}" \
        --set-env-vars "TIDB_USER=$TIDB_USER" \
        --set-env-vars "TIDB_PASSWORD=$TIDB_PASSWORD" \
        --set-env-vars "TIDB_DATABASE=$TIDB_DATABASE" \
        --set-env-vars "ADMIN_CHAT_ID=$ADMIN_CHAT_ID" \
        --set-env-vars "TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-$ADMIN_CHAT_ID}" \
        --set-env-vars "CRON_SECRET=$CRON_SECRET" \
        --set-env-vars "APP_URL=${APP_URL:-https://$SERVICE_NAME-$PROJECT_ID.a.run.app}" \
        --set-env-vars "TIDB_ENABLE_SSL=true" \
        --set-env-vars "LOG_LEVEL=INFO" \
        --set-env-vars "LOG_TO_FILE=false"

    log_info "Service deployed successfully"
}

# =============================================================================
# Get service URL
# =============================================================================

get_service_url() {
    SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")
    log_info "Service URL: $SERVICE_URL"
    echo "🌐 Your Telegram bot is now running at: $SERVICE_URL"
    echo "🔍 Health check: $SERVICE_URL/health"
}

# =============================================================================
# Test deployment
# =============================================================================

test_deployment() {
    log_info "Testing deployment..."
    SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

    # Test health endpoint
    if curl -f -s "$SERVICE_URL/health" > /dev/null; then
        log_info "✅ Health check passed"
    else
        log_error "❌ Health check failed"
        exit 1
    fi
}

# =============================================================================
# Setup GitHub Secrets (optional)
# =============================================================================

setup_github_secrets() {
    if [ "$1" = "--setup-github" ]; then
        log_info "Setting up GitHub repository secrets..."
        SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")
        echo ""
        echo "📋 Add these secrets to your GitHub repository:"
        echo "   CLOUD_RUN_URL: $SERVICE_URL"
        echo "   CRON_SECRET: $CRON_SECRET"
        echo ""
        echo "Go to: https://github.com/Arnutt-N/time-reminder/settings/secrets/actions"
    fi
}

# =============================================================================
# Main execution
# =============================================================================

main() {
    echo "🤖 Telegram Reminder Bot - Cloud Run Deployment"
    echo "==============================================="
    
    check_prerequisites
    enable_apis
    build_and_push
    deploy_service
    get_service_url
    test_deployment
    setup_github_secrets "$1"

    echo ""
    echo "🎉 Deployment completed successfully!"
    echo "📝 Next steps:"
    echo "   1. Set up GitHub repository secrets for cron jobs"
    echo "   2. Test the bot functionality"
    echo "   3. Monitor logs: gcloud logs tail --project=$PROJECT_ID"
}

# =============================================================================
# Run main function with all arguments
# =============================================================================

main "$@"