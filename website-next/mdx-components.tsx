import defaultMdxComponents from "fumadocs-ui/mdx";
import * as CodeblockComponents from "fumadocs-ui/components/codeblock";
import type { MDXComponents } from "mdx/types";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...CodeblockComponents,
    ...defaultMdxComponents,
    ...components,
  };
}
