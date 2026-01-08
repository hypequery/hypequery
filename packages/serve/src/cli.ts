#!/usr/bin/env node
import { access, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

import { serveDev } from "./dev";
import { generateSdkClient } from "./sdk-generator";

const printHelp = () => {
  console.log(`Usage: hypequery-serve <command> [options]

Commands:
  init      Scaffold a new serve API file (default: src/hypequery.ts)
  dev       Run the dev server for an existing API module
  sdk       Generate a TypeScript SDK from an OpenAPI document
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
    const file = flags.file || flags.f || "src/hypequery.ts";
    await scaffoldApiFile(file);
    return;
  }

  if (command === "dev") {
    const modulePath = flags.module || flags.m || "./src/hypequery.js";
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

const scaffoldApiFile = async (file: string) => {
  const resolved = path.resolve(process.cwd(), file);
  const dir = path.dirname(resolved);
  await mkdir(dir, { recursive: true });

  try {
    await access(resolved);
    console.error(`Refusing to overwrite existing file at ${file}`);
    process.exit(1);
    return;
  } catch {
    // file does not exist, continue
  }

  const template = `import { defineServe } from "@hypequery/serve";

export const api = defineServe({
  context: () => ({}),
  queries: {
    exampleMetric: {
      description: "Example metric that always returns true",
      query: async () => ({ ok: true }),
    },
  },
});

/**
 * Embedded usage:
 *   await api.execute("exampleMetric");
 *
 * Optional dev server:
 *   npx hypequery-serve dev ${file}
 */
`;

  await writeFile(resolved, template, "utf8");
  console.log(`Created ${file}`);
};

const runDevServer = async (modulePath: string, flags: Record<string, string>) => {
  const api = await loadApiModule(modulePath);
  const port = flags.port ? Number(flags.port) : undefined;
  const hostname = flags.hostname;
  const quiet = flags.quiet === "true" || flags.q === "true";

  const server = await serveDev(api, { port, hostname, quiet });

  const shutdown = async () => {
    if (!quiet) {
      console.log("Shutting down dev server...");
    }
    await server.stop();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

const loadApiModule = async (modulePath: string) => {
  const resolved = path.resolve(process.cwd(), modulePath);
  const mod = await import(pathToFileURL(resolved).href);
  const api = mod.api ?? mod.default;

  if (!api || typeof api.handler !== "function") {
    throw new Error(
      `Module at ${modulePath} does not export a serve API. Export your defineServe result as 'api'.`
    );
  }

  return api;
};
