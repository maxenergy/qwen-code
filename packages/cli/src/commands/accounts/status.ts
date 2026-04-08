/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import { getSavedAccounts } from './utils.js';
import { writeStdoutLine } from '../../utils/stdioHelpers.js';

export const statusCommand: CommandModule = {
  command: 'status',
  describe: 'Show the current default Qwen OAuth account',
  handler: async () => {
    const accounts = await getSavedAccounts();
    const current =
      accounts.find((item) => item.isGlobalDefault) || accounts[0];

    if (!current) {
      writeStdoutLine('No saved Qwen OAuth accounts.');
      return;
    }

    writeStdoutLine(
      `Default account: #${current.index} ${current.account.label}`,
    );
    writeStdoutLine(
      `Requests today: ${current.account.usage.successfulRequests}`,
    );
  },
};
