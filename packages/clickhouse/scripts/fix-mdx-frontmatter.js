#!/usr/bin/env node

/**
 * Script to fix the YAML frontmatter in MDX files generated from TypeDoc.
 * This script:
 * 1. Reads all MDX files in the API reference directory
 * 2. Fixes YAML frontmatter formatting issues
 * 3. Saves the files back with correct frontmatter
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

// Target directory for MDX files
const mdxDir = path.join(rootDir, 'website/src/pages/docs/reference/api');

console.log(`Fixing frontmatter in MDX files at: ${mdxDir}`);

// Process all MDX files in a directory and its subdirectories
function processDirectory(dirPath) {
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      // Recursively process subdirectories
      processDirectory(fullPath);
    } else if (file.endsWith('.mdx')) {
      // Process MDX file
      fixFrontMatter(fullPath);
    }
  }
}

// Fix frontmatter in a single MDX file
function fixFrontMatter(filePath) {
  console.log(`Processing: ${path.relative(rootDir, filePath)}`);

  let content = fs.readFileSync(filePath, 'utf8');

  // Check if the file starts with frontmatter
  if (content.startsWith('---')) {
    // Extract the title from the file
    let title = 'API Reference';
    const titleMatch = content.match(/title:\s*(.*)/);
    if (titleMatch) {
      title = titleMatch[1].trim();

      // Replace colons with hyphens in the title to avoid YAML parsing issues
      title = title.replace(/:/g, ' -');
    }

    // Find the end of frontmatter marker
    const endOfFrontmatter = content.indexOf('---', 4);
    if (endOfFrontmatter !== -1) {
      // Calculate the relative path to the layouts directory
      let layoutPath = '../../layouts/DocsLayout.astro';

      // Check nesting depth of the file
      const relativePath = path.relative(path.join(rootDir, 'website/src/pages/docs'), filePath);
      const depth = relativePath.split(path.sep).length - 1;

      // Add one "../" for each level of nesting
      for (let i = 0; i < depth; i++) {
        layoutPath = '../' + layoutPath;
      }

      // Get the content after frontmatter
      let contentAfterFrontmatter = content.substring(endOfFrontmatter + 3);

      // Clean up the content:
      // 1. Remove the HypeQuery ClickHouse API links
      contentAfterFrontmatter = contentAfterFrontmatter.replace(/\[\*\*HypeQuery ClickHouse API\*\*\]\(\/docs\/reference\/api\/\.\.\/README\)/g, '');
      contentAfterFrontmatter = contentAfterFrontmatter.replace(/\[HypeQuery ClickHouse API\]\(\/docs\/reference\/api\/\.\.\/globals\) \/ /g, '');

      // 2. Remove the > decorators from function signatures
      contentAfterFrontmatter = contentAfterFrontmatter.replace(/^> /gm, '');

      // 3. Remove extra asterisks and horizontal rules
      contentAfterFrontmatter = contentAfterFrontmatter.replace(/^\*\*\*$/gm, '');

      // 4. Remove the "Defined in:" lines which aren't needed for documentation readers
      contentAfterFrontmatter = contentAfterFrontmatter.replace(/^Defined in:.*$/gm, '');

      // Replace the frontmatter section with a correct one
      const newFrontmatter = `---
layout: ${layoutPath}
title: ${title}
description: API documentation for HypeQuery ClickHouse library
---`;

      // Combine the new frontmatter with the cleaned content
      content = newFrontmatter + contentAfterFrontmatter;

      // Remove excessive blank lines
      content = content.replace(/\n{3,}/g, '\n\n');

      // Write the file back
      fs.writeFileSync(filePath, content);
      console.log(`✅ Fixed frontmatter in: ${path.relative(rootDir, filePath)}`);
    }
  }
}

// Process the entire API reference directory
try {
  processDirectory(mdxDir);
  console.log('\n✅ All MDX frontmatter has been fixed successfully!');
} catch (error) {
  console.error(`❌ Error processing MDX files: ${error.message}`);
  process.exit(1);
} 