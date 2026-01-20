#!/usr/bin/env node

import 'dotenv/config';
import { program } from '../cli.js';

program.parse(process.argv);
