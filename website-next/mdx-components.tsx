import defaultMdxComponents from "fumadocs-ui/mdx";
import * as CodeblockComponents from "fumadocs-ui/components/codeblock";

export function getMDXComponents(components?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...CodeblockComponents,
    ...defaultMdxComponents,
    ...components,
  };
}
