#!/usr/bin/env node

/**
 * Script to process TypeDoc Markdown files and convert them to MDX format
 * for integration with the Astro website.
 * 
 * This script:
 * 1. Reads TypeDoc generated Markdown files from website/public/api-reference
 * 2. Converts them to MDX with proper frontmatter
 * 3. Places them in website/src/pages/docs/reference/api structure
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

// Source and destination directories
const sourceDir = path.join(rootDir, 'website/public/api-reference');
const destinationDir = path.join(rootDir, 'website/src/pages/docs/reference/api');

// Ensure the destination directory exists
if (!fs.existsSync(destinationDir)) {
  fs.mkdirSync(destinationDir, { recursive: true });
  console.log(`Created destination directory: ${destinationDir}`);
}

// Function to create the API sidebar data
function createSidebarData(files) {
  const sidebarItems = [];

  // Group files by type (modules, classes, interfaces, etc.)
  const groupedFiles = {};

  for (const file of files) {
    // Skip index.md and README.md
    if (file === 'index.md' || file === 'README.md') continue;

    let group = 'Other';
    if (file.startsWith('classes/')) group = 'Classes';
    else if (file.startsWith('interfaces/')) group = 'Interfaces';
    else if (file.startsWith('modules/')) group = 'Modules';
    else if (file.startsWith('types/')) group = 'Types';

    if (!groupedFiles[group]) groupedFiles[group] = [];
    groupedFiles[group].push(file);
  }

  // Create sidebar data structure
  Object.keys(groupedFiles).sort().forEach(group => {
    const items = groupedFiles[group].map(file => {
      const basename = path.basename(file, '.md');
      const fileDir = path.dirname(file);
      const link = fileDir === '.' ? basename : `${fileDir}/${basename}`;
      return {
        text: basename,
        link: `/docs/reference/api/${link}`
      };
    });

    sidebarItems.push({
      text: group,
      items
    });
  });

  return sidebarItems;
}

// Function to process a single file
function processFile(file, baseDir, relativePath = '') {
  const sourcePath = path.join(baseDir, relativePath, file);
  const stats = fs.statSync(sourcePath);

  if (stats.isDirectory()) {
    // Create the corresponding directory in destination
    const newDir = path.join(destinationDir, relativePath, file);
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
    }

    // Process all files in the directory
    const dirFiles = fs.readdirSync(sourcePath);
    for (const dirFile of dirFiles) {
      processFile(dirFile, baseDir, path.join(relativePath, file));
    }
  } else if (file.endsWith('.md')) {
    // Convert Markdown file to MDX
    let content = fs.readFileSync(sourcePath, 'utf8');

    // Get title from markdown file (usually the first # heading)
    let title = 'API Reference';
    const titleMatch = content.match(/^# (.*)/m);
    if (titleMatch) {
      title = titleMatch[1];

      // Replace colons with hyphens in the title to avoid YAML parsing issues
      title = title.replace(/:/g, ' -');
    }

    // Calculate the relative path to the layouts directory based on the file's depth
    let layoutPath = '../../layouts/DocsLayout.astro';

    // Add "../" for each subdirectory level
    const depth = file.split('/').length - 1;
    for (let i = 0; i < depth; i++) {
      layoutPath = '../' + layoutPath;
    }

    // Add frontmatter with correct layout path - NO INDENTATION in YAML frontmatter
    const frontmatter = `---
layout: ${layoutPath}
title: ${title}
description: API documentation for HypeQuery ClickHouse library
---

`;

    // Process links to make them work in the MDX context
    content = content.replace(/\]\(([^)]+)\.md\)/g, '](/docs/reference/api/$1)');

    // Handle relative links to other API documents
    content = content.replace(/\]\(\.\.\/([^)]+)\.md\)/g, '](/docs/reference/api/$1)');

    // Remove the HTML comments that TypeDoc adds
    content = content.replace(/<!-- -->/g, '');

    // Final content with frontmatter
    const finalContent = frontmatter + content;

    // Remove excessive blank lines
    const cleanContent = finalContent.replace(/\n{3,}/g, '\n\n');

    // Write to destination
    const destPath = path.join(destinationDir, relativePath, file.replace('.md', '.mdx'));
    fs.writeFileSync(destPath, cleanContent);
    console.log(`Processed: ${relativePath}/${file} -> ${destPath}`);
  }
}

// Process all files in the source directory
console.log(`Processing TypeDoc Markdown files from ${sourceDir} to ${destinationDir}`);

// Get all files recursively
function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      fileList = getAllFiles(filePath, fileList);
    } else if (file.endsWith('.md')) {
      const relativePath = path.relative(sourceDir, filePath);
      fileList.push(relativePath);
    }
  });

  return fileList;
}

// Get all Markdown files
const allFiles = getAllFiles(sourceDir);

// First ensure all directories exist
const directories = new Set();
allFiles.forEach(file => {
  const dir = path.dirname(file);
  if (dir !== '.') {
    directories.add(dir);
  }
});

// Create directories in sorted order (parents before children)
[...directories].sort().forEach(dir => {
  const destDir = path.join(destinationDir, dir);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    console.log(`Created directory: ${destDir}`);
  }
});

// Process each file
allFiles.forEach(file => {
  const sourcePath = path.join(sourceDir, file);
  let content = fs.readFileSync(sourcePath, 'utf8');

  // Get title from markdown file (usually the first # heading)
  let title = 'API Reference';
  const titleMatch = content.match(/^# (.*)/m);
  if (titleMatch) {
    title = titleMatch[1];

    // Replace colons with hyphens in the title to avoid YAML parsing issues
    title = title.replace(/:/g, ' -');
  }

  // Calculate the relative path to the layouts directory based on the file's depth
  let layoutPath = '../../layouts/DocsLayout.astro';

  // Add "../" for each subdirectory level
  const depth = file.split('/').length - 1;
  for (let i = 0; i < depth; i++) {
    layoutPath = '../' + layoutPath;
  }

  // Add frontmatter with correct layout path - NO INDENTATION in YAML frontmatter
  const frontmatter = `---
layout: ${layoutPath}
title: ${title}
description: API documentation for HypeQuery ClickHouse library
---

`;

  // Process links to make them work in the MDX context
  content = content.replace(/\]\(([^)]+)\.md\)/g, '](/docs/reference/api/$1)');

  // Handle relative links to other API documents
  content = content.replace(/\]\(\.\.\/([^)]+)\.md\)/g, '](/docs/reference/api/$1)');

  // Remove the HTML comments that TypeDoc adds
  content = content.replace(/<!-- -->/g, '');

  // Clean up the content:
  // 1. Remove the TypeDoc navigation links that create clutter
  content = content.replace(/\[\*\*HypeQuery ClickHouse API\*\*\]\(.*?\)/g, '');
  content = content.replace(/\[HypeQuery ClickHouse API\]\(.*?\) \/ /g, '');

  // 2. Remove the > decorators from function signatures
  content = content.replace(/^> /gm, '');

  // 3. Remove extra asterisks and horizontal rules
  content = content.replace(/^\*\*\*$/gm, '');

  // 4. Remove the "Defined in:" lines which aren't needed for documentation readers
  content = content.replace(/^Defined in:.*$/gm, '');

  // Final content with frontmatter
  const finalContent = frontmatter + content;

  // Remove excessive blank lines
  const cleanContent = finalContent.replace(/\n{3,}/g, '\n\n');

  // Write to destination
  const destPath = path.join(destinationDir, file.replace('.md', '.mdx'));
  fs.writeFileSync(destPath, cleanContent);
  console.log(`Processed: ${file} -> ${destPath}`);
});

// Create an index.mdx file for the API reference with appropriate layout path
const indexContent = `---
layout: ../../../layouts/DocsLayout.astro
title: API Reference
description: Complete API reference for the HypeQuery ClickHouse library
---

# HypeQuery ClickHouse API Reference

This comprehensive API reference documents all public classes, methods, and types available in the HypeQuery ClickHouse library.

## API Documentation Sections

The API reference is organized into the following sections:

### Classes

These are the main classes you'll interact with:

- [ClickHouseConnection](/docs/reference/api/classes/ClickHouseConnection) - Main connection class for ClickHouse
- [CrossFilter](/docs/reference/api/classes/CrossFilter) - Cross-filtering functionality
- [JoinRelationships](/docs/reference/api/classes/JoinRelationships) - Define and manage join relationships

### Functions

Utility functions for working with ClickHouse:

- [createQueryBuilder](/docs/reference/api/functions/createQueryBuilder) - Create a query builder
- [datePart](/docs/reference/api/functions/datePart) - Extract parts from date values
- [formatDateTime](/docs/reference/api/functions/formatDateTime) - Format date and time values
- [raw](/docs/reference/api/functions/raw) - Create raw SQL expressions

### Interfaces

Type definitions for objects used throughout the library:

- [QueryConfig](/docs/reference/api/interfaces/QueryConfig) - Query configuration options
- [PaginationOptions](/docs/reference/api/interfaces/PaginationOptions) - Pagination configuration
- [JoinPath](/docs/reference/api/interfaces/JoinPath) - Join path configuration

### Type Aliases

Common type definitions:

- [ColumnType](/docs/reference/api/type-aliases/ColumnType) - Column type definition
- [DatabaseSchema](/docs/reference/api/type-aliases/DatabaseSchema) - Database schema definition

## How to Use This Reference

This reference is automatically generated from the source code and is intended to be a comprehensive resource for developers using the HypeQuery ClickHouse library.

For each component, you'll find:

- Method signatures with parameter and return types
- Type definitions
- JSDoc comments explaining functionality
- Example code where available

If you're new to the library, we recommend starting with the [Introduction](/docs/introduction) and [Quick Start](/docs/installation) guides before diving into the API reference.
`;

fs.writeFileSync(path.join(destinationDir, 'index.mdx'), indexContent);
console.log(`Created index.mdx in ${destinationDir}`);

console.log('\nAPI Reference MDX files have been successfully generated!');
console.log(`You can now access them at: https://your-site.com/docs/reference/api/`); 