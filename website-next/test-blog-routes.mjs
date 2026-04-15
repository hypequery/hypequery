#!/usr/bin/env node

/**
 * Advanced blog route testing script
 * Tests the actual blog CMS functionality
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(70));
  log(title, 'cyan');
  console.log('='.repeat(70));
}

async function importBlogCMS() {
  try {
    // We need to transpile TypeScript first, so let's check the file structure
    const blogCmsPath = join(__dirname, 'src/lib/blog-cms.ts');

    if (!existsSync(blogCmsPath)) {
      log('✗ blog-cms.ts not found', 'red');
      return null;
    }

    log('✓ blog-cms.ts found', 'green');
    return blogCmsPath;
  } catch (error) {
    log(`✗ Error importing blog CMS: ${error.message}`, 'red');
    return null;
  }
}

async function testBlogPostStructure() {
  logSection('Testing Blog Post Structure');

  const contentDir = join(__dirname, 'content/blog');

  if (!existsSync(contentDir)) {
    log('✗ content/blog directory not found', 'red');
    return false;
  }

  log('✓ content/blog directory exists', 'green');

  const fs = await import('fs');
  const files = fs.readdirSync(contentDir).filter(f => f.endsWith('.md') || f.endsWith('.mdx'));

  log(`\nFound ${files.length} blog post(s)`, 'blue');

  let allValid = true;

  for (const file of files) {
    const filePath = join(contentDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check for frontmatter
    const hasFrontmatter = content.startsWith('---');
    const hasTitle = /title:\s*["']?[^"'\n]+["']?/.test(content);
    const hasStatus = /status:\s*(draft|review|published)/.test(content);

    log(`\n  ${file}:`, 'yellow');
    log(`    Frontmatter: ${hasFrontmatter ? '✓' : '✗'}`, hasFrontmatter ? 'green' : 'red');
    log(`    Title: ${hasTitle ? '✓' : '✗'}`, hasTitle ? 'green' : 'red');
    log(`    Status: ${hasStatus ? '✓' : '✗'}`, hasStatus ? 'green' : 'red');

    if (!hasFrontmatter || !hasTitle || !hasStatus) {
      allValid = false;
    }
  }

  return allValid;
}

async function testEnvironmentConfiguration() {
  logSection('Testing Environment Configuration');

  const hasBlobToken = !!process.env.BLOB_READ_WRITE_TOKEN;
  const isProduction = process.env.NODE_ENV === 'production';

  log(`\nEnvironment: ${isProduction ? 'Production' : 'Development'}`, 'blue');
  log(`Blob Storage: ${hasBlobToken ? 'Configured' : 'Not configured'}`, hasBlobToken ? 'green' : 'yellow');

  if (isProduction && !hasBlobToken) {
    log('\n⚠ Warning: Running in production without BLOB_READ_WRITE_TOKEN', 'yellow');
    log('  This will cause the blog to fail in production!', 'red');
    log('  Solution: Set BLOB_READ_WRITE_TOKEN environment variable', 'yellow');
    return false;
  }

  log('\n✓ Environment configuration is valid', 'green');
  return true;
}

async function testBuildArtifacts() {
  logSection('Testing Build Artifacts');

  const nextDir = join(__dirname, '.next');

  if (!existsSync(nextDir)) {
    log('\n✗ .next directory not found', 'red');
    log('  Run: npm run build', 'yellow');
    return false;
  }

  log('✓ .next directory exists', 'green');

  // Check for blog route artifacts
  const blogServerDir = join(nextDir, 'server/app/blog');
  const hasBlogIndex = existsSync(join(blogServerDir, 'page.js'));
  const hasBlogSlug = existsSync(join(blogServerDir, '[slug]', 'page.js'));

  log(`\nBlog index route: ${hasBlogIndex ? '✓' : '✗'}`, hasBlogIndex ? 'green' : 'red');
  log(`Blog slug route: ${hasBlogSlug ? '✓' : '✗'}`, hasBlogSlug ? 'green' : 'red');

  return hasBlogIndex && hasBlogSlug;
}

async function testDependencies() {
  logSection('Testing Dependencies');

  const packageJsonPath = join(__dirname, 'package.json');

  if (!existsSync(packageJsonPath)) {
    log('\n✗ package.json not found', 'red');
    return false;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const dependencies = packageJson.dependencies || {};

  const requiredDeps = [
    'gray-matter',
    '@vercel/blob',
    'next',
    'react',
    'react-dom',
    'react-markdown',
  ];

  let allFound = true;

  log('\nChecking required dependencies:');
  for (const dep of requiredDeps) {
    const found = !!dependencies[dep];
    log(`  ${dep}: ${found ? '✓' : '✗'}`, found ? 'green' : 'red');
    if (!found) allFound = false;
  }

  return allFound;
}

function provideNextSteps() {
  logSection('Next Steps');

  log('\n1. Test blog routes locally:', 'yellow');
  log('   npm run dev', 'blue');
  log('   Then visit: http://localhost:3000/blog', 'blue');

  log('\n2. Test production build:', 'yellow');
  log('   npm run build', 'blue');
  log('   npm start', 'blue');
  log('   Then visit: http://localhost:3000/blog', 'blue');

  log('\n3. For Vercel deployment:', 'yellow');
  log('   - Ensure BLOB_READ_WRITE_TOKEN is set in Vercel environment variables', 'blue');
  log('   - The blog will use Vercel Blob Storage in production', 'blue');
  log('   - If blob storage fails, it falls back to seed posts', 'blue');

  log('\n4. Monitor server logs for:', 'yellow');
  log('   - "Failed to read from blob storage" errors', 'blue');
  log('   - "Blog CMS requires BLOB_READ_WRITE_TOKEN" errors', 'blue');
  log('   - Any exceptions during blog post retrieval', 'blue');
}

async function main() {
  log('\n🔍 Advanced Blog Route Testing', 'cyan');
  log('Testing blog functionality and configuration...\n');

  const results = {
    blogPosts: await testBlogPostStructure(),
    environment: await testEnvironmentConfiguration(),
    buildArtifacts: await testBuildArtifacts(),
    dependencies: await testDependencies(),
  };

  logSection('Test Results');

  const allPassed = Object.values(results).every(r => r === true);

  for (const [test, passed] of Object.entries(results)) {
    const status = passed ? '✓' : '✗';
    const color = passed ? 'green' : 'red';
    log(`${status} ${test}`, color);
  }

  if (allPassed) {
    log('\n✓ All tests passed!', 'green');
    provideNextSteps();
    process.exit(0);
  } else {
    log('\n✗ Some tests failed', 'red');
    provideNextSteps();
    process.exit(1);
  }
}

main().catch(error => {
  log(`\n✗ Error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
