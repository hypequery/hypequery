import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { generateSdkClient } from "./sdk-generator";

const SAMPLE_SPEC = {
  openapi: "3.1.0",
  info: { title: "Test API", version: "1.0.0" },
  paths: {
    "/hello": {
      get: {
        operationId: "getHello",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

describe("generateSdkClient", () => {
  it("writes TypeScript client files based on the OpenAPI spec", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "hq-sdk-"));
    const specPath = join(tmp, "spec.json");
    await writeFile(specPath, JSON.stringify(SAMPLE_SPEC), "utf8");

    const outputDir = join(tmp, "sdk");
    await generateSdkClient({
      input: specPath,
      output: outputDir,
      clientName: "AcmeClient",
    });

    const clientSource = await readFile(join(outputDir, "client.ts"), "utf8");
    const typesSource = await readFile(join(outputDir, "types.ts"), "utf8");

    expect(clientSource).toContain("class AcmeClient");
    expect(typesSource).toContain("paths");
  });
});
