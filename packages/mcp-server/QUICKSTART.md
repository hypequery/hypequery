# MCP Server Quick Start

Get the Hypequery MCP server running with Claude Desktop in under 5 minutes.

## Option 1: Instant Test (No Setup Required)

Use ClickHouse's built-in `system.numbers` table:

```bash
# 1. Build the MCP server
cd packages/mcp-server
pnpm install
pnpm build

# 2. Test standalone
node dist/bin.js --config examples/system-numbers-config.js
```

You should see: `Hypequery MCP Server started`

Press Ctrl+C to stop.

## Option 2: Connect to Claude Desktop

### Step 1: Get the absolute paths

```bash
cd packages/mcp-server
pwd
# Copy this output, you'll need it below
```

### Step 2: Configure Claude Desktop

Edit your Claude Desktop config:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hypequery": {
      "command": "node",
      "args": [
        "/YOUR/ABSOLUTE/PATH/packages/mcp-server/dist/bin.js",
        "--config",
        "/YOUR/ABSOLUTE/PATH/packages/mcp-server/examples/system-numbers-config.js"
      ]
    }
  }
}
```

**Replace `/YOUR/ABSOLUTE/PATH` with the output from Step 1!**

### Step 3: Restart Claude Desktop

Quit completely and relaunch.

### Step 4: Test

Ask Claude:
```
List all datasets
```

You should see:
```json
{
  "datasets": [
    {
      "name": "numbers",
      "dimensionCount": 1,
      "metricCount": 4
    }
  ]
}
```

Then try:
```
What is the sum of the first 100 numbers?
```

Expected: `4950`

## Next Steps

1. **Use Your Own Data** - Copy `examples/mcp-config.js` and modify for your schema
2. **Auto-Generate Datasets** - Use `npx hypequery generate:datasets` (once CLI builds)
3. **Read Full Guide** - See `TESTING.md` for comprehensive instructions

## Troubleshooting

**Server not connecting?**
- Check absolute paths (no `~` or `..`)
- Restart Claude Desktop completely
- Check logs: `~/Library/Logs/Claude/mcp*.log` (macOS)

**Queries failing?**
- Ensure ClickHouse is running (`clickhouse-client`)
- Check credentials in config
- Try the `system.numbers` example first

**Need help?**
- See `TESTING.md` for detailed troubleshooting
- Check `README.md` for full documentation
