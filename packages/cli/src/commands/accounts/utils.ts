/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  QwenOAuthAccountPool,
  type QwenOAuthAccountListItem,
} from '@qwen-code/qwen-code-core';
import { writeStdoutLine } from '../../utils/stdioHelpers.js';

export async function getSavedAccounts(): Promise<
  QwenOAuthAccountListItem[]
> {
  const pool = new QwenOAuthAccountPool();
  return pool.getAccounts();
}

export function renderAccounts(
  accounts: QwenOAuthAccountListItem[],
): string[] {
  if (accounts.length === 0) {
    return [
      'No saved Qwen OAuth accounts.',
      'Run `qwen auth qwen-oauth` to add your first account.',
    ];
  }

  return accounts.map((item) => {
    const tags = [
      item.isSelected ? 'current-process' : null,
      item.isGlobalDefault ? 'default' : null,
    ].filter(Boolean);
    const suffix = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
    return `${item.index}. ${item.account.label}${suffix} - ${item.account.usage.successfulRequests} req today`;
  });
}

export function printAccounts(accounts: QwenOAuthAccountListItem[]): void {
  for (const line of renderAccounts(accounts)) {
    writeStdoutLine(line);
  }
}
