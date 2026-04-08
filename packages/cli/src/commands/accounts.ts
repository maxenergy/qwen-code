/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Argv, CommandModule } from 'yargs';
import { listCommand } from './accounts/list.js';
import { statusCommand } from './accounts/status.js';
import { switchCommand } from './accounts/switch.js';

export const accountsCommand: CommandModule = {
  command: 'accounts',
  describe: 'Manage saved Qwen OAuth accounts',
  builder: (yargs: Argv) =>
    yargs
      .command(listCommand)
      .command(statusCommand)
      .command(switchCommand)
      .demandCommand(1, 'You need at least one command before continuing.')
      .version(false),
  handler: () => {},
};
