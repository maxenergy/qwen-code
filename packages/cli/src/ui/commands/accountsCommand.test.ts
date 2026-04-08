/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthType, SharedTokenManager } from '@qwen-code/qwen-code-core';
import { accountsCommand } from './accountsCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext } from './types.js';

vi.mock('@qwen-code/qwen-code-core', async () => {
  const actual = await vi.importActual('@qwen-code/qwen-code-core');
  return {
    ...actual,
    QwenOAuthAccountPool: class {
      async getAccounts() {
        return [
          {
            index: 1,
            isSelected: true,
            isGlobalDefault: true,
            account: {
              accountId: 'account-1',
              label: 'qwen-a',
              usage: { date: '2026-04-08', successfulRequests: 10 },
            },
          },
          {
            index: 2,
            isSelected: false,
            isGlobalDefault: false,
            account: {
              accountId: 'account-2',
              label: 'qwen-b',
              usage: { date: '2026-04-08', successfulRequests: 2 },
            },
          },
        ];
      }

      async switchProcessAccountByIndex(index: number) {
        if (index === 2) {
          return {
            accountId: 'account-2',
            label: 'qwen-b',
          };
        }
        return null;
      }
    },
    SharedTokenManager: {
      getInstance: vi.fn().mockReturnValue({
        clearCache: vi.fn(),
      }),
    },
  };
});

describe('accountsCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockCommandContext({
      services: {
        config: {
          getContentGeneratorConfig: vi.fn().mockReturnValue({
            authType: AuthType.QWEN_OAUTH,
          }),
          refreshAuth: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
  });

  it('lists saved accounts when no argument is provided', async () => {
    mockContext.invocation = {
      raw: '/accounts',
      name: 'accounts',
      args: '',
    };

    const result = await accountsCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining('Saved Qwen OAuth accounts:'),
    });
  });

  it('switches the current process account by index', async () => {
    mockContext.invocation = {
      raw: '/accounts 2',
      name: 'accounts',
      args: '2',
    };

    const result = await accountsCommand.action!(mockContext, '2');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'Switched this process to Qwen OAuth account #2 (qwen-b).',
    });
    expect(SharedTokenManager.getInstance).toHaveBeenCalled();
    expect(mockContext.services.config?.refreshAuth).toHaveBeenCalledWith(
      AuthType.QWEN_OAUTH,
    );
  });

  it('returns an error for an invalid account index', async () => {
    mockContext.invocation = {
      raw: '/accounts 9',
      name: 'accounts',
      args: '9',
    };

    const result = await accountsCommand.action!(mockContext, '9');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Account index 9 is out of range.',
    });
  });
});
