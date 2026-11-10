# The governed MCP server as a container: `docker run -i` speaks MCP over stdio.
# Build from the folder `npx hypequery create mcp-agent-analytics` made:
#   docker build -t hypequery-mcp-agent-analytics .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY analytics ./analytics
COPY src ./src
RUN npx tsc --project tsconfig.json && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
# TENANT_ID and CLICKHOUSE_* come from `docker run -e`, set by the MCP client's config.
ENTRYPOINT ["node", "dist/src/server.js"]
