/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuthType,
  QwenOAuthAccountPool,
  SharedTokenManager,
} from '@qwen-code/qwen-code-core';
import type {
  MessageActionReturn,
  SlashCommand,
  CommandContext,
} from './types.js';
import { CommandKind } from './types.js';
import { t } from '../../i18n/index.js';

function formatAccountsList(
  accounts: Awaited<ReturnType<QwenOAuthAccountPool['getAccounts']>>,
): string {
  if (accounts.length === 0) {
    return t(
      'No saved Qwen OAuth accounts. Run /auth and choose Qwen OAuth to add one.',
    );
  }

  const lines = [t('Saved Qwen OAuth accounts:')];
  for (const item of accounts) {
    const markers = [
      item.isSelected ? t('current') : null,
      item.isGlobalDefault ? t('default') : null,
    ].filter(Boolean);
    const markerSuffix = markers.length > 0 ? ` [${markers.join(', ')}]` : '';
    lines.push(
      `${item.index}. ${item.account.label}${markerSuffix} - ${item.account.usage.successfulRequests} req today`,
    );
  }
  lines.push('');
  lines.push(
    t('Use /accounts <index> to switch this process to another account.'),
  );
  return lines.join('\n');
}

export const accountsCommand: SlashCommand = {
  name: 'accounts',
  get description() {
    return t('List or switch saved Qwen OAuth accounts for this process');
  },
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext): Promise<MessageActionReturn> => {
    const pool = new QwenOAuthAccountPool();
    const args = context.invocation?.args?.trim() ?? '';
    const accounts = await pool.getAccounts();

    if (!args || args === 'list' || args === 'status') {
      return {
        type: 'message',
        messageType: 'info',
        content: formatAccountsList(accounts),
      };
    }

    const requestedIndex = Number(args);
    if (!Number.isInteger(requestedIndex) || requestedIndex <= 0) {
      return {
        type: 'message',
        messageType: 'error',
        content: t('Usage: /accounts [list|status|<index>]'),
      };
    }

    const switched = await pool.switchProcessAccountByIndex(requestedIndex);
    if (!switched) {
      return {
        type: 'message',
        messageType: 'error',
        content: t('Account index {{index}} is out of range.', {
          index: String(requestedIndex),
        }),
      };
    }

    SharedTokenManager.getInstance().clearCache();
    const config = context.services.config;
    const authType = config?.getContentGeneratorConfig()?.authType;
    if (config && authType === AuthType.QWEN_OAUTH) {
      await config.refreshAuth(AuthType.QWEN_OAUTH);
    }

    return {
      type: 'message',
      messageType: 'info',
      content: t(
        'Switched this process to Qwen OAuth account #{{index}} ({{label}}).',
        {
          index: String(requestedIndex),
          label: switched.label,
        },
      ),
    };
  },
};
