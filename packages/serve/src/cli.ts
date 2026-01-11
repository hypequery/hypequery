#!/usr/bin/env node
import { access, mkdir, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

import { serveDev } from "./dev.js";
import { generateSdkClient } from "./sdk-generator.js";

const printHelp = () => {
  console.log(`Usage: hypequery <command> [options]

Commands:
  init      Scaffold a new serve API file (default: hypequery.ts)
  dev       Run the dev server for an existing API module (default: hypequery.ts)
  sdk       Generate a TypeScript SDK from an OpenAPI document

Options:
  init:
    --file, -f <path>         Path for the API file (default: hypequery.ts)

  dev:
    --module, -m <path>       Path to your API module (default: hypequery.ts)
    --port <number>           Port to run the server on (default: 4000)
    --hostname <host>         Hostname to bind to (default: localhost)
    --watch, -w               Watch for file changes and auto-reload
    --quiet, -q               Suppress startup messages

  sdk:
    --input, -i <path>        Path to OpenAPI document (required)
    --output, -o <path>       Output path for SDK (required)
    --clientName <name>       Name for the generated client

Examples:
  npx hypequery init
  npx hypequery init --file src/api.ts
  npx hypequery dev
  npx hypequery dev --port 3000
  npx hypequery sdk --input openapi.json --output ./sdk/client.ts
`);
};

const parseFlags = (argv: string[]) => {
  const flags: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      flags[key] = value;
      i += 1;
    } else {
      flags[key] = "true";
    }
  }

  return flags;
};

const scaffoldApiFile = async (file: string) => {
  const resolved = path.resolve(process.cwd(), file);
  const dir = path.dirname(resolved);
  await mkdir(dir, { recursive: true });

  try {
    await access(resolved);
    console.error(`Refusing to overwrite existing file at ${file}`);
    process.exit(1);
  } catch {
    // file does not exist, continue
  }

  const template = `import { defineServe } from "@hypequery/serve";

const api = defineServe({
  context: () => ({}),
  queries: {
    exampleMetric: {
      description: "Example metric that always returns true",
      query: async () => ({ ok: true }),
    },
  },
});

// Register routes
api.route("/exampleMetric", api.queries.exampleMetric);

export { api };

/**
 * Embedded usage:
 *   await api.execute("exampleMetric");
 *
 * Dev server:
 *   npx hypequery dev
 */
`;

  await writeFile(resolved, template, "utf8");
  console.log(`Created ${file}`);
};

const loadApiModule = async (modulePath: string) => {
  const resolved = path.resolve(process.cwd(), modulePath);
  // Add cache busting for module reloading in watch mode
  const moduleUrl = `${pathToFileURL(resolved).href}?t=${Date.now()}`;

  // If it's a .ts file, try to use tsx to load it
  if (resolved.endsWith('.ts')) {
    try {
      // Try to dynamically import tsx
      // @ts-ignore - tsx is an optional peer dependency
      const tsx = await import('tsx/esm/api') as any;
      const unregister = tsx.register();
      const mod = await import(moduleUrl);
      unregister();
      const api = mod.api ?? mod.default;

      if (!api || typeof api.handler !== "function") {
        throw new Error(
          `Module at ${modulePath} does not export a serve API. Export your defineServe result as 'api'.`
        );
      }

      return api;
    } catch (error: any) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('tsx')) {
        throw new Error(
          `To run TypeScript files directly, install tsx:\n  npm install -D tsx\n\nOr compile your TypeScript first:\n  tsc ${modulePath}`
        );
      }
      throw error;
    }
  }

  // For .js files, use regular import
  const mod = await import(moduleUrl);
  const api = mod.api ?? mod.default;

  if (!api || typeof api.handler !== "function") {
    throw new Error(
      `Module at ${modulePath} does not export a serve API. Export your defineServe result as 'api'.`
    );
  }

  return api;
};

const runDevServer = async (modulePath: string, flags: Record<string, string>) => {
  const port = flags.port ? Number(flags.port) : undefined;
  const hostname = flags.hostname;
  const quiet = flags.quiet === "true" || flags.q === "true";
  const shouldWatch = flags.watch === "true" || flags.w === "true";

  let currentServer: Awaited<ReturnType<typeof serveDev>> | null = null;

  const startServer = async () => {
    try {
      const api = await loadApiModule(modulePath);
      currentServer = await serveDev(api, { port, hostname, quiet });
    } catch (error) {
      console.error("Failed to start server:", error instanceof Error ? error.message : error);
      if (!shouldWatch) {
        process.exit(1);
      }
    }
  };

  const restartServer = async () => {
    if (currentServer) {
      if (!quiet) {
        console.log("\nRestarting server...");
      }
      await currentServer.stop();
    }
    await startServer();
  };

  const shutdown = async () => {
    if (!quiet) {
      console.log("Shutting down dev server...");
    }
    if (currentServer) {
      await currentServer.stop();
    }
    process.exit(0);
  };

  await startServer();

  if (shouldWatch) {
    const resolved = path.resolve(process.cwd(), modulePath);
    const watchDir = path.dirname(resolved);

    if (!quiet) {
      console.log(`Watching for changes in ${watchDir}...`);
    }

    let debounceTimer: NodeJS.Timeout | null = null;

    const watcher = watch(watchDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      // Only watch .ts and .js files
      if (!filename.endsWith('.ts') && !filename.endsWith('.js')) {
        return;
      }

      // Debounce file changes
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(async () => {
        if (!quiet) {
          console.log(`\nFile changed: ${filename}`);
        }
        await restartServer();
      }, 100);
    });

    process.once("SIGINT", () => {
      watcher.close();
      shutdown();
    });
    process.once("SIGTERM", () => {
      watcher.close();
      shutdown();
    });
  } else {
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
};

const main = async () => {
  const [, , command, ...rest] = process.argv;

  if (!command || command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  const flags = parseFlags(rest);

  if (command === "sdk") {
    const input = flags.input || flags.i;
    const output = flags.output || flags.o;
    const clientName = flags.clientName || flags.client;

    if (!input || !output) {
      console.error("--input and --output are required for the sdk command");
      process.exitCode = 1;
      return;
    }

    await generateSdkClient({
      input,
      output,
      clientName,
    });

    console.log(`SDK generated at ${output}`);
    return;
  }

  if (command === "init") {
    const file = flags.file || flags.f || "hypequery.ts";
    await scaffoldApiFile(file);
    return;
  }

  if (command === "dev") {
    const modulePath = flags.module || flags.m || "./hypequery.ts";
    await runDevServer(modulePath, flags);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
