#!/bin/bash
set -e

# Define colors for better output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Print message with timestamp
log() {
  echo -e "${GREEN}$(date '+%Y-%m-%d %H:%M:%S')${NC} $1"
}

error() {
  echo -e "${RED}$(date '+%Y-%m-%d %H:%M:%S') ERROR:${NC} $1"
}

warn() {
  echo -e "${YELLOW}$(date '+%Y-%m-%d %H:%M:%S') WARNING:${NC} $1"
}

# Load environment variables from .env.test if it exists
if [ -f .env.test ]; then
  log "Loading environment variables from .env.test..."
  set -a
  source .env.test
  set +a
fi

# Check if Docker is installed and running
if ! docker info > /dev/null 2>&1; then
  error "Docker is not running or not installed. Please start Docker and try again."
  exit 1
fi

# Check for docker-compose or docker compose
DOCKER_COMPOSE_CMD=""
if command -v docker-compose > /dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker-compose"
elif docker compose version > /dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker compose"
else
  error "Neither docker-compose nor docker compose plugin is available. Please install one of them."
  exit 1
fi

# Set the default environment variables if not already set
export CLICKHOUSE_TEST_HOST="${CLICKHOUSE_TEST_HOST:-http://localhost:8123}"
export CLICKHOUSE_TEST_USER="${CLICKHOUSE_TEST_USER:-default}"
export CLICKHOUSE_TEST_PASSWORD="${CLICKHOUSE_TEST_PASSWORD:-hypequery_test}"
export CLICKHOUSE_TEST_DB="${CLICKHOUSE_TEST_DB:-test_db}"

log "Using ClickHouse connection settings:"
log "  Host: ${CLICKHOUSE_TEST_HOST}"
log "  User: ${CLICKHOUSE_TEST_USER}"
log "  Database: ${CLICKHOUSE_TEST_DB}"

# Check if the container is already running
CONTAINER_ID=$(docker ps -q -f name=hypequery-test-clickhouse)
if [ -n "$CONTAINER_ID" ]; then
  warn "ClickHouse container is already running with ID: $CONTAINER_ID"
  read -p "Do you want to stop it and start a fresh container? (y/N): " STOP_CONTAINER
  if [[ "$STOP_CONTAINER" =~ ^[Yy]$ ]]; then
    log "Stopping existing ClickHouse container..."
    $DOCKER_COMPOSE_CMD -f docker-compose.test.yml down
  else
    log "Using existing container..."
  fi
else
  # Start ClickHouse container
  log "Starting ClickHouse container..."
  $DOCKER_COMPOSE_CMD -f docker-compose.test.yml up -d
fi

# Wait for ClickHouse to be ready
log "Waiting for ClickHouse to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0

until $(curl --output /dev/null --silent --head --fail "${CLICKHOUSE_TEST_HOST}/ping"); do
  if [ ${RETRY_COUNT} -eq ${MAX_RETRIES} ]; then
    error "Failed to connect to ClickHouse after ${MAX_RETRIES} attempts. Aborting."
    $DOCKER_COMPOSE_CMD -f docker-compose.test.yml logs clickhouse
    $DOCKER_COMPOSE_CMD -f docker-compose.test.yml down
    exit 1
  fi
  
  RETRY_COUNT=$((RETRY_COUNT+1))
  warn "Waiting for ClickHouse to be ready... (${RETRY_COUNT}/${MAX_RETRIES})"
  sleep 2
done

log "ClickHouse is ready!"

# Test connection to ClickHouse
log "Testing connection to ClickHouse..."
RESPONSE=$(curl -s "${CLICKHOUSE_TEST_HOST}/ping")
if [ "$RESPONSE" != "Ok." ]; then
  error "Connection to ClickHouse failed. Response: $RESPONSE"
  $DOCKER_COMPOSE_CMD -f docker-compose.test.yml logs clickhouse
  $DOCKER_COMPOSE_CMD -f docker-compose.test.yml down
  exit 1
fi
log "ClickHouse connection successful!"

# Create test database if it doesn't exist
log "Ensuring test database exists..."
curl -s -X POST "${CLICKHOUSE_TEST_HOST}/?user=${CLICKHOUSE_TEST_USER}&password=${CLICKHOUSE_TEST_PASSWORD}" \
  --data-binary "CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_TEST_DB}"

# Run integration tests
log "Running integration tests..."
npm run test:integration

# Ask if container should be kept running
read -p "Do you want to keep the ClickHouse container running? (y/N): " KEEP_CONTAINER
if [[ ! "$KEEP_CONTAINER" =~ ^[Yy]$ ]]; then
  log "Stopping ClickHouse container..."
  $DOCKER_COMPOSE_CMD -f docker-compose.test.yml down
  log "Container stopped."
else
  log "ClickHouse container is still running. You can stop it later with:"
  echo "  $DOCKER_COMPOSE_CMD -f docker-compose.test.yml down"
fi

log "Integration tests completed!" 