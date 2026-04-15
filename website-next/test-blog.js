#!/usr/bin/env node

/**
 * Test script for blog functionality
 * Run this locally to verify blog routes work correctly
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'blue');
  console.log('='.repeat(60));
}

async function testBlogCMS() {
  logSection('Testing Blog CMS Functionality');

  // Test 1: Check if blog-cms module exists
  log('\n1. Checking if blog-cms module exists...', 'yellow');
  const blogCmsPath = path.join(__dirname, 'src/lib/blog-cms.ts');
  if (!fs.existsSync(blogCmsPath)) {
    log('   ✗ blog-cms.ts not found', 'red');
    return false;
  }
  log('   ✓ blog-cms.ts found', 'green');

  // Test 2: Check if content/blog directory exists
  log('\n2. Checking if content/blog directory exists...', 'yellow');
  const contentDir = path.join(__dirname, 'content/blog');
  if (!fs.existsSync(contentDir)) {
    log('   ✗ content/blog directory not found', 'red');
    log('   → Creating content/blog directory', 'yellow');
    fs.mkdirSync(contentDir, { recursive: true });
    log('   ✓ Directory created', 'green');
  } else {
    log('   ✓ content/blog directory found', 'green');

    // List blog files
    const files = fs.readdirSync(contentDir).filter(f => f.endsWith('.md') || f.endsWith('.mdx'));
    log(`   → Found ${files.length} blog post(s)`, 'blue');
    files.forEach(file => {
      log(`     - ${file}`, 'blue');
    });
  }

  // Test 3: Check environment configuration
  log('\n3. Checking environment configuration...', 'yellow');
  const hasBlobToken = !!process.env.BLOB_READ_WRITE_TOKEN;
  if (hasBlobToken) {
    log('   ✓ BLOB_READ_WRITE_TOKEN is set (Vercel Blob mode)', 'green');
  } else {
    log('   ℹ BLOB_READ_WRITE_TOKEN not set (Local SQLite mode)', 'blue');
  }

  // Test 4: Check Next.js configuration
  log('\n4. Checking Next.js configuration...', 'yellow');
  const nextConfigPath = path.join(__dirname, 'next.config.ts');
  if (!fs.existsSync(nextConfigPath)) {
    log('   ✗ next.config.ts not found', 'red');
    return false;
  }
  log('   ✓ next.config.ts found', 'green');

  // Test 5: Check blog pages
  log('\n5. Checking blog page routes...', 'yellow');
  const blogIndexPath = path.join(__dirname, 'src/app/blog/page.tsx');
  const blogSlugPath = path.join(__dirname, 'src/app/blog/[slug]/page.tsx');

  if (!fs.existsSync(blogIndexPath)) {
    log('   ✗ src/app/blog/page.tsx not found', 'red');
    return false;
  }
  log('   ✓ src/app/blog/page.tsx found', 'green');

  if (!fs.existsSync(blogSlugPath)) {
    log('   ✗ src/app/blog/[slug]/page.tsx not found', 'red');
    return false;
  }
  log('   ✓ src/app/blog/[slug]/page.tsx found', 'green');

  return true;
}

async function testBuildConfiguration() {
  logSection('Testing Build Configuration');

  // Test 1: Check package.json
  log('\n1. Checking package.json...', 'yellow');
  const packageJsonPath = path.join(__dirname, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    log('   ✗ package.json not found', 'red');
    return false;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  log('   ✓ package.json found', 'green');
  log(`   → Name: ${packageJson.name}`, 'blue');
  log(`   → Next.js version: ${packageJson.dependencies?.next || 'not found'}`, 'blue');

  // Test 2: Check for required dependencies
  log('\n2. Checking required dependencies...', 'yellow');
  const requiredDeps = ['gray-matter', '@vercel/blob'];
  let allDepsFound = true;

  for (const dep of requiredDeps) {
    if (packageJson.dependencies?.[dep]) {
      log(`   ✓ ${dep} is installed`, 'green');
    } else {
      log(`   ✗ ${dep} is missing`, 'red');
      allDepsFound = false;
    }
  }

  if (!allDepsFound) {
    log('\n→ Run: npm install', 'yellow');
    return false;
  }

  return true;
}

function provideInstructions() {
  logSection('Instructions for Testing Blog Routes');

  log('\n1. Local Development Testing:', 'yellow');
  log('   Run: npm run dev', 'blue');
  log('   Then visit:', 'blue');
  log('   - http://localhost:3000/blog', 'blue');
  log('   - http://localhost:3000/blog/your-post-slug', 'blue');

  log('\n2. Production Build Testing:', 'yellow');
  log('   Run: npm run build', 'blue');
  log('   Then: npm start', 'blue');
  log('   Visit the same URLs as above', 'blue');

  log('\n3. Environment Setup:', 'yellow');
  log('   For Vercel deployment, ensure BLOB_READ_WRITE_TOKEN is set', 'blue');
  log('   For local development, the blog will use SQLite database', 'blue');

  log('\n4. Adding Blog Posts:', 'yellow');
  log('   Create .md or .mdx files in content/blog/', 'blue');
  log('   Example: content/blog/2024-01-01-my-first-post.md', 'blue');
  log('   With frontmatter like:', 'blue');
  log('   ---', 'blue');
  log('   title: My First Post', 'blue');
  log('   description: This is my first blog post', 'blue');
  log('   date: 2024-01-01', 'blue');
  log('   status: published', 'blue');
  log('   tags: ["clickhouse", "analytics"]', 'blue');
  log('   ---', 'blue');

  log('\n5. Common Issues:', 'yellow');
  log('   If you see "Cannot create data directory in production"', 'blue');
  log('   → Set BLOB_READ_WRITE_TOKEN environment variable', 'blue');
  log('   If you see "Blog CMS requires BLOB_READ_WRITE_TOKEN"', 'blue');
  log('   → Same solution as above', 'blue');
}

async function main() {
  log('\n📝 Blog Route Test Script', 'blue');
  log('Testing your hypequery blog configuration...\n');

  const cmsTest = await testBlogCMS();
  const buildTest = await testBuildConfiguration();

  logSection('Test Results Summary');

  if (cmsTest && buildTest) {
    log('\n✓ All basic checks passed!', 'green');
    provideInstructions();
    process.exit(0);
  } else {
    log('\n✗ Some checks failed. Please fix the issues above.', 'red');
    process.exit(1);
  }
}

main().catch(error => {
  log(`\n✗ Error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
