#!/bin/bash

# Load environment variables from .env.test if it exists
if [ -f .env.test ]; then
  echo "Loading environment variables from .env.test..."
  export $(cat .env.test | grep -v '#' | xargs)
fi

# Stop any existing test containers
echo "Stopping any existing test containers..."
docker-compose -f docker-compose.test.yml down

# Start ClickHouse container
echo "Starting ClickHouse container..."
docker-compose -f docker-compose.test.yml up -d

# Wait for ClickHouse to be ready
echo "Waiting for ClickHouse to be ready..."
# Increase wait time to 30 seconds
sleep 30

# Test connection to ClickHouse
echo "Testing connection to ClickHouse..."
curl -s "http://localhost:8123/?user=default&password=hypequery_test" --data "SELECT 1"
if [ $? -ne 0 ]; then
  echo "Connection to ClickHouse failed. Check container logs with: docker logs hypequery-test-clickhouse"
  exit 1
fi

# Run integration tests
echo "Running integration tests..."
CLICKHOUSE_TEST_HOST="http://localhost:8123" \
CLICKHOUSE_TEST_USER="default" \
CLICKHOUSE_TEST_PASSWORD="hypequery_test" \
CLICKHOUSE_TEST_DB="test_db" \
npm run test:integration

# Stop and remove container
echo "Stopping ClickHouse container..."
docker-compose -f docker-compose.test.yml down 