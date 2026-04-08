/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { switchCommand } from './switch.js';
import { writeStdoutLine } from '../../utils/stdioHelpers.js';

vi.mock('@qwen-code/qwen-code-core', async () => {
  const actual = await vi.importActual('@qwen-code/qwen-code-core');
  return {
    ...actual,
    QwenOAuthAccountPool: class {
      async setDefaultAccountByIndex(index: number) {
        if (index === 2) {
          return {
            accountId: 'account-2',
            label: 'qwen-b',
          };
        }
        return null;
      }
    },
  };
});

vi.mock('../../utils/stdioHelpers.js', () => ({
  writeStdoutLine: vi.fn(),
  writeStderrLine: vi.fn(),
}));

describe('accounts switch command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switches the default account when index is valid', async () => {
    await switchCommand.handler!({ index: 2, _: [], $0: 'qwen' });

    expect(writeStdoutLine).toHaveBeenCalledWith(
      'Default Qwen OAuth account set to #2 (qwen-b).',
    );
  });
});
