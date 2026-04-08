/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'os';
import path from 'node:path';
import {
  QwenOAuthAccountPool,
  type QwenOAuthAccountRecord,
} from './qwenOAuthAccountPool.js';

describe('QwenOAuthAccountPool', () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-oauth-pool-'));
    originalHome = process.env['HOME'];
    process.env['HOME'] = tempDir;
    delete process.env['QWEN_OAUTH_DAILY_REQUEST_LIMIT'];
    delete process.env['QWEN_OAUTH_ROTATION_THRESHOLD'];
    delete process.env['QWEN_OAUTH_ACCOUNT_ID'];
    delete process.env['QWEN_OAUTH_ACCOUNT_INDEX'];
  });

  afterEach(async () => {
    if (originalHome) {
      process.env['HOME'] = originalHome;
    } else {
      delete process.env['HOME'];
    }
    delete process.env['QWEN_OAUTH_ACCOUNT_ID'];
    delete process.env['QWEN_OAUTH_ACCOUNT_INDEX'];
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('stores multiple authenticated accounts and mirrors the active one', async () => {
    const pool = new QwenOAuthAccountPool();

    const firstAccount = await pool.upsertAuthenticatedAccount({
      access_token: 'token-1',
      refresh_token: 'refresh-1',
      token_type: 'Bearer',
      resource_url: 'https://endpoint-1.example.com',
      expiry_date: Date.now() + 60_000,
    });
    const secondAccount = await pool.upsertAuthenticatedAccount({
      access_token: 'token-2',
      refresh_token: 'refresh-2',
      token_type: 'Bearer',
      resource_url: 'https://endpoint-2.example.com',
      expiry_date: Date.now() + 60_000,
    });

    expect(firstAccount.accountId).not.toBe(secondAccount.accountId);

    const poolFile = JSON.parse(
      await fs.readFile(pool.getPoolFilePath(), 'utf-8'),
    ) as {
      activeAccountId: string;
      accounts: QwenOAuthAccountRecord[];
    };
    expect(poolFile.accounts).toHaveLength(2);
    expect(poolFile.activeAccountId).toBe(secondAccount.accountId);

    const activeMirror = JSON.parse(
      await fs.readFile(pool.getActiveCredentialsPath(), 'utf-8'),
    ) as { refresh_token: string };
    expect(activeMirror.refresh_token).toBe('refresh-2');
  });

  it('rotates to the next account once the local usage threshold is reached', async () => {
    const pool = new QwenOAuthAccountPool();
    process.env['QWEN_OAUTH_DAILY_REQUEST_LIMIT'] = '10';
    process.env['QWEN_OAUTH_ROTATION_THRESHOLD'] = '0.5';

    const firstAccount = await pool.upsertAuthenticatedAccount({
      access_token: 'token-1',
      refresh_token: 'refresh-1',
      token_type: 'Bearer',
      resource_url: 'https://endpoint-1.example.com',
      expiry_date: Date.now() + 60_000,
    });
    const secondAccount = await pool.upsertAuthenticatedAccount({
      access_token: 'token-2',
      refresh_token: 'refresh-2',
      token_type: 'Bearer',
      resource_url: 'https://endpoint-2.example.com',
      expiry_date: Date.now() + 60_000,
    });

    await pool.rotateToNextAvailableAccount(secondAccount.accountId);
    for (let i = 0; i < 5; i++) {
      await pool.recordSuccessfulRequest(firstAccount.accountId);
    }

    const rotated = await pool.rotateActiveAccountIfNeeded();

    expect(rotated?.accountId).toBe(secondAccount.accountId);
    const activeMirror = JSON.parse(
      await fs.readFile(pool.getActiveCredentialsPath(), 'utf-8'),
    ) as { refresh_token: string };
    expect(activeMirror.refresh_token).toBe('refresh-2');
  });

  it('removes the active account and falls back to the next available account', async () => {
    const pool = new QwenOAuthAccountPool();

    await pool.upsertAuthenticatedAccount({
      access_token: 'token-1',
      refresh_token: 'refresh-1',
      token_type: 'Bearer',
      resource_url: 'https://endpoint-1.example.com',
      expiry_date: Date.now() + 60_000,
    });
    const secondAccount = await pool.upsertAuthenticatedAccount({
      access_token: 'token-2',
      refresh_token: 'refresh-2',
      token_type: 'Bearer',
      resource_url: 'https://endpoint-2.example.com',
      expiry_date: Date.now() + 60_000,
    });

    await pool.removeActiveAccount();

    const active = await pool.getActiveAccount();
    expect(active?.accountId).not.toBe(secondAccount.accountId);

    const activeMirror = JSON.parse(
      await fs.readFile(pool.getActiveCredentialsPath(), 'utf-8'),
    ) as { refresh_token: string };
    expect(activeMirror.refresh_token).toBe('refresh-1');
  });
});
