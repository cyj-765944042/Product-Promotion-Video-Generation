#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

PORT=5000
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"


start_service() {
    cd "${COZE_WORKSPACE_PATH}"
    
    # Create local storage directories for video generation (production uses /tmp)
    TEMP_DIR="/tmp/video-generation"
    mkdir -p "${TEMP_DIR}/audio" "${TEMP_DIR}/video"
    echo "Local storage directories created at ${TEMP_DIR}"
    
    echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
    NODE_OPTIONS='--no-deprecation' PORT=${DEPLOY_RUN_PORT} node dist/server.js
}

echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
start_service
