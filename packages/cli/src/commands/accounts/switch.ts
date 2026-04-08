/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Argv, CommandModule } from 'yargs';
import { QwenOAuthAccountPool } from '@qwen-code/qwen-code-core';
import { writeStdoutLine, writeStderrLine } from '../../utils/stdioHelpers.js';

export const switchCommand: CommandModule = {
  command: 'switch <index>',
  describe: 'Set the default Qwen OAuth account by saved account index',
  builder: (yargs: Argv) =>
    yargs.positional('index', {
      type: 'number',
      describe: 'Saved account index (1-based)',
    }),
  handler: async (argv) => {
    const pool = new QwenOAuthAccountPool();
    const rawIndex = argv['index'];
    const index = typeof rawIndex === 'number' ? rawIndex : Number(rawIndex);

    if (!index || !Number.isInteger(index) || index <= 0) {
      writeStderrLine('Account index must be a positive integer.');
      process.exit(1);
    }

    const account = await (
      pool as QwenOAuthAccountPool & {
        setDefaultAccountByIndex: (
          index: number,
        ) => Promise<{ label: string } | null>;
      }
    ).setDefaultAccountByIndex(index);
    if (!account) {
      writeStderrLine(`Account index ${index} is out of range.`);
      process.exit(1);
    }

    writeStdoutLine(
      `Default Qwen OAuth account set to #${index} (${account.label}).`,
    );
  },
};
