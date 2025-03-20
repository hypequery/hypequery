#!/usr/bin/env node

/**
 * Simple script to ensure core files exist.
 * This is a minimal version that only creates essential files needed for the CLI.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const distDir = path.join(rootDir, 'dist');
const coreDir = path.join(distDir, 'core');

console.log('Ensuring core files exist...');

// Create core directory if it doesn't exist
if (!fs.existsSync(coreDir)) {
  console.log('Creating core directory...');
  fs.mkdirSync(coreDir, { recursive: true });
}

// Create connection.js (required by CLI)
const connectionJsPath = path.join(coreDir, 'connection.js');
if (!fs.existsSync(connectionJsPath)) {
  console.log('Creating connection.js...');
  const connectionJsContent = `import { createClient } from '@clickhouse/client-web';

/**
 * Manages the connection to the ClickHouse database
 */
export class ClickHouseConnection {
  static client;
  static config;

  /**
   * Initialize the connection with configuration
   */
  static initialize(config) {
    this.config = config;
    this.client = createClient({
      host: config.host,
      username: config.username,
      password: config.password,
      database: config.database,
    });
    return this;
  }

  /**
   * Get the ClickHouse client instance
   */
  static getClient() {
    if (!this.client) {
      throw new Error('ClickHouse connection not initialized. Call ClickHouseConnection.initialize() first.');
    }
    return this.client;
  }

  /**
   * Get the current configuration
   */
  static getConfig() {
    return this.config;
  }
}`;
  fs.writeFileSync(connectionJsPath, connectionJsContent);
}

console.log('Core files created successfully!'); 