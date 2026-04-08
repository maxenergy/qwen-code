/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import { getSavedAccounts, printAccounts } from './utils.js';

export const listCommand: CommandModule = {
  command: 'list',
  describe: 'List saved Qwen OAuth accounts',
  handler: async () => {
    const accounts = await getSavedAccounts();
    printAccounts(accounts);
  },
};
