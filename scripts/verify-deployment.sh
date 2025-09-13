#!/bin/bash

# Deployment Verification Script
# Checks that all deployment components are properly configured

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

function log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

function log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

function log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

function log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

function check_gcloud_auth() {
    log_info "Checking Google Cloud authentication..."
    if gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1 > /dev/null; then
        local account=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1)
        log_success "Authenticated as: $account"
    else
        log_error "Not authenticated with Google Cloud. Run 'gcloud auth login'"
        return 1
    fi
}

function check_project() {
    log_info "Checking Google Cloud project..."
    local project=$(gcloud config get-value project 2>/dev/null)
    if [ -z "$project" ]; then
        log_error "No project set. Run 'gcloud config set project YOUR_PROJECT_ID'"
        return 1
    else
        log_success "Project set to: $project"
        export PROJECT_ID="$project"
    fi
}

function check_service_exists() {
    log_info "Checking if Cloud Run service exists..."
    if gcloud run services describe telegram-reminder-bot --region=us-central1 --format="value(metadata.name)" >/dev/null 2>&1; then
        local url=$(gcloud run services describe telegram-reminder-bot --region=us-central1 --format="value(status.url)")
        log_success "Service exists: $url"
        export SERVICE_URL="$url"
    else
        log_warning "Cloud Run service 'telegram-reminder-bot' not found. Deploy first."
        return 1
    fi
}

function check_service_health() {
    if [ -z "$SERVICE_URL" ]; then
        log_warning "Skipping health check - service URL not available"
        return 1
    fi

    log_info "Checking service health..."
    if curl -f -s "$SERVICE_URL/health" >/dev/null; then
        log_success "Service health check passed"
    else
        log_error "Service health check failed. Check service logs."
        return 1
    fi
}

function check_environment_variables() {
    log_info "Checking Cloud Run environment variables..."
    local vars=$(gcloud run services describe telegram-reminder-bot --region=us-central1 --format="value(spec.template.spec.template.spec.containers[0].env[].name)")

    local required_vars=("NODE_ENV" "TELEGRAM_BOT_TOKEN" "TIDB_HOST" "TIDB_PASSWORD" "CRON_SECRET")
    local missing_vars=()

    for var in "${required_vars[@]}"; do
        if echo "$vars" | grep -q "^$var$"; then
            log_success "Environment variable set: $var"
        else
            missing_vars+=("$var")
        fi
    done

    if [ ${#missing_vars[@]} -gt 0 ]; then
        log_error "Missing environment variables: ${missing_vars[*]}"
        log_info "Set them with: gcloud run services update telegram-reminder-bot --region=us-central1 --set-env-vars VAR=value"
        return 1
    fi
}

function check_github_secrets() {
    log_info "Checking GitHub repository secrets..."

    if command -v gh >/dev/null; then
        local secrets=$(gh secret list --json name -q '.[].name' 2>/dev/null || echo "")

        if echo "$secrets" | grep -q "CLOUD_RUN_URL"; then
            log_success "GitHub secret set: CLOUD_RUN_URL"
        else
            log_warning "GitHub secret missing: CLOUD_RUN_URL"
        fi

        if echo "$secrets" | grep -q "CRON_SECRET"; then
            log_success "GitHub secret set: CRON_SECRET"
        else
            log_warning "GitHub secret missing: CRON_SECRET"
        fi
    else
        log_warning "GitHub CLI not installed. Cannot check GitHub secrets."
        log_info "Install with: curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg"
    fi
}

function check_cron_endpoint() {
    if [ -z "$SERVICE_URL" ]; then
        log_warning "Skipping cron endpoint check - service URL not available"
        return 1
    fi

    log_info "Testing cron endpoint (without auth - should return 401)..."
    local response=$(curl -s -w "%{http_code}" -o /dev/null "$SERVICE_URL/api/cron" -X POST -H "Content-Type: application/json" -d '{"type":"test","time":"12:00"}')

    if [ "$response" = "401" ]; then
        log_success "Cron endpoint properly protected (returns 401 without auth)"
    else
        log_warning "Cron endpoint returned $response instead of 401. Check authentication."
    fi
}

function check_webhook_info() {
    if [ -z "$SERVICE_URL" ]; then
        log_warning "Skipping webhook check - service URL not available"
        return 1
    fi

    log_info "Checking webhook configuration..."
    if curl -f -s "$SERVICE_URL/webhook-info" >/dev/null; then
        log_success "Webhook info endpoint accessible"
    else
        log_warning "Webhook info endpoint not accessible"
    fi
}

function main() {
    echo "🔍 Deployment Verification Script"
    echo "=================================="
    echo

    local checks_passed=0
    local total_checks=8

    check_gcloud_auth && ((checks_passed++)) || true
    check_project && ((checks_passed++)) || true
    check_service_exists && ((checks_passed++)) || true
    check_service_health && ((checks_passed++)) || true
    check_environment_variables && ((checks_passed++)) || true
    check_github_secrets && ((checks_passed++)) || true
    check_cron_endpoint && ((checks_passed++)) || true
    check_webhook_info && ((checks_passed++)) || true

    echo
    echo "=================================="
    echo "Verification Summary: $checks_passed/$total_checks checks passed"

    if [ $checks_passed -eq $total_checks ]; then
        log_success "🎉 All deployment checks passed! Your deployment is properly configured."
        exit 0
    elif [ $checks_passed -ge 6 ]; then
        log_warning "⚠️  Most checks passed. Review warnings above."
        exit 0
    else
        log_error "❌ Multiple deployment issues found. See DEPLOYMENT_GUIDE.md for fixes."
        exit 1
    fi
}

main "$@"