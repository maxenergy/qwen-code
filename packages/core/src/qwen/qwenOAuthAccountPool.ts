/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import * as os from 'os';
import { randomUUID, createHash } from 'node:crypto';
import type { QwenCredentials } from './qwenOAuth2.js';
import { createDebugLogger } from '../utils/debugLogger.js';

const debugLogger = createDebugLogger('QWEN_OAUTH_POOL');

const QWEN_DIR = '.qwen';
const QWEN_ACTIVE_CREDENTIAL_FILENAME = 'oauth_creds.json';
const QWEN_ACCOUNT_POOL_FILENAME = 'oauth_accounts.json';
const QWEN_ACCOUNT_CACHE_DIR = 'oauth-accounts';
const DEFAULT_DAILY_REQUEST_LIMIT = 1000;
const DEFAULT_ROTATION_THRESHOLD = 0.95;
const PROCESS_ACCOUNT_ID_ENV = 'QWEN_OAUTH_ACCOUNT_ID';
const PROCESS_ACCOUNT_INDEX_ENV = 'QWEN_OAUTH_ACCOUNT_INDEX';

export interface QwenOAuthAccountUsage {
  date: string;
  successfulRequests: number;
  quotaExceeded?: boolean;
  lastUsedAt?: number;
}

export interface QwenOAuthAccountRecord extends QwenCredentials {
  accountId: string;
  label: string;
  createdAt: number;
  lastAuthenticatedAt: number;
  usage: QwenOAuthAccountUsage;
}

interface QwenOAuthAccountPoolFile {
  version: 1;
  activeAccountId?: string;
  accounts: QwenOAuthAccountRecord[];
}

export interface RotationConfig {
  dailyRequestLimit: number;
  threshold: number;
}

export interface QwenOAuthAccountListItem {
  index: number;
  isSelected: boolean;
  isGlobalDefault: boolean;
  account: QwenOAuthAccountRecord;
}

function toLocalDateKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDefaultUsage(): QwenOAuthAccountUsage {
  return {
    date: toLocalDateKey(),
    successfulRequests: 0,
  };
}

function normalizeUsage(
  usage: QwenOAuthAccountUsage | undefined,
): QwenOAuthAccountUsage {
  if (!usage) {
    return getDefaultUsage();
  }

  const today = toLocalDateKey();
  if (usage.date !== today) {
    return {
      date: today,
      successfulRequests: 0,
      quotaExceeded: false,
    };
  }

  return {
    date: usage.date,
    successfulRequests: usage.successfulRequests || 0,
    quotaExceeded: usage.quotaExceeded === true,
    lastUsedAt: usage.lastUsedAt,
  };
}

function getCredentialIdentity(credentials: QwenCredentials): string | null {
  if (credentials.refresh_token) {
    return `refresh:${credentials.refresh_token}`;
  }
  if (credentials.access_token) {
    return `access:${credentials.access_token}`;
  }
  return null;
}

function deriveAccountLabel(
  credentials: QwenCredentials,
  accountId: string,
): string {
  const source =
    credentials.refresh_token ||
    credentials.access_token ||
    credentials.id_token ||
    accountId;
  const suffix = createHash('sha256').update(source).digest('hex').slice(0, 8);
  return `qwen-${suffix}`;
}

function toActiveCredentials(account: QwenOAuthAccountRecord): QwenCredentials {
  return {
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    id_token: account.id_token,
    expiry_date: account.expiry_date,
    token_type: account.token_type,
    resource_url: account.resource_url,
  };
}

export class QwenOAuthAccountPool {
  static getProcessSelectedAccountId(): string | undefined {
    return process.env[PROCESS_ACCOUNT_ID_ENV] || undefined;
  }

  static setProcessSelectedAccountId(accountId: string | null): void {
    if (accountId) {
      process.env[PROCESS_ACCOUNT_ID_ENV] = accountId;
    } else {
      delete process.env[PROCESS_ACCOUNT_ID_ENV];
    }
  }

  static getProcessSelectedAccountIndex(): number | undefined {
    const value = process.env[PROCESS_ACCOUNT_INDEX_ENV];
    if (!value) {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return undefined;
    }
    return parsed;
  }

  static setProcessSelectedAccountIndex(index: number | null): void {
    if (index && Number.isInteger(index) && index > 0) {
      process.env[PROCESS_ACCOUNT_INDEX_ENV] = String(index);
    } else {
      delete process.env[PROCESS_ACCOUNT_INDEX_ENV];
    }
  }

  getRotationConfig(): RotationConfig {
    const parsedLimit = Number(process.env['QWEN_OAUTH_DAILY_REQUEST_LIMIT']);
    const parsedThreshold = Number(
      process.env['QWEN_OAUTH_ROTATION_THRESHOLD'],
    );

    return {
      dailyRequestLimit:
        Number.isFinite(parsedLimit) && parsedLimit > 0
          ? Math.floor(parsedLimit)
          : DEFAULT_DAILY_REQUEST_LIMIT,
      threshold:
        Number.isFinite(parsedThreshold) &&
        parsedThreshold > 0 &&
        parsedThreshold <= 1
          ? parsedThreshold
          : DEFAULT_ROTATION_THRESHOLD,
    };
  }

  getPoolFilePath(): string {
    return path.join(os.homedir(), QWEN_DIR, QWEN_ACCOUNT_POOL_FILENAME);
  }

  getActiveCredentialsPath(): string {
    return path.join(os.homedir(), QWEN_DIR, QWEN_ACTIVE_CREDENTIAL_FILENAME);
  }

  getAccountCredentialsDir(): string {
    return path.join(os.homedir(), QWEN_DIR, QWEN_ACCOUNT_CACHE_DIR);
  }

  getAccountCredentialsPath(accountId: string): string {
    return path.join(this.getAccountCredentialsDir(), `${accountId}.json`);
  }

  getProcessSelectedAccountCacheKey(): string {
    return QwenOAuthAccountPool.getProcessSelectedAccountId() || 'default';
  }

  getSelectedAccountCredentialsPath(): string {
    const selectedAccountId =
      QwenOAuthAccountPool.getProcessSelectedAccountId();
    if (selectedAccountId) {
      return this.getAccountCredentialsPath(selectedAccountId);
    }
    return this.getActiveCredentialsPath();
  }

  getSelectedAccountLockPath(): string {
    return path.join(
      os.homedir(),
      QWEN_DIR,
      `oauth_creds.${this.getProcessSelectedAccountCacheKey()}.lock`,
    );
  }

  async initializeProcessSelection(): Promise<QwenOAuthAccountRecord | null> {
    const pool = await this.loadPool();
    const selected = this.findSelectedAccount(pool);
    if (selected) {
      QwenOAuthAccountPool.setProcessSelectedAccountId(selected.accountId);
      await this.writeActiveCredentialsFile(toActiveCredentials(selected));
      return selected;
    }
    QwenOAuthAccountPool.setProcessSelectedAccountId(null);
    return null;
  }

  async ensureActiveAccountMirrored(): Promise<void> {
    const pool = await this.loadPool();
    await this.ensureActiveMirror(pool);
  }

  async upsertAuthenticatedAccount(
    credentials: QwenCredentials,
  ): Promise<QwenOAuthAccountRecord> {
    const pool = await this.loadPool();
    const identity = getCredentialIdentity(credentials);
    const now = Date.now();

    let account = identity
      ? pool.accounts.find(
          (candidate) => getCredentialIdentity(candidate) === identity,
        )
      : undefined;

    if (!account) {
      account = {
        accountId: randomUUID(),
        label: deriveAccountLabel(credentials, randomUUID()),
        createdAt: now,
        lastAuthenticatedAt: now,
        usage: getDefaultUsage(),
      };
      pool.accounts.push(account);
    }

    Object.assign(account, credentials);
    account.lastAuthenticatedAt = now;
    account.usage = normalizeUsage(account.usage);
    account.label = deriveAccountLabel(credentials, account.accountId);
    pool.activeAccountId = account.accountId;
    QwenOAuthAccountPool.setProcessSelectedAccountId(account.accountId);

    await this.savePool(pool);
    await this.writeAccountCredentialsFile(account.accountId, credentials);
    await this.writeActiveCredentialsFile(toActiveCredentials(account));

    return account;
  }

  async getActiveAccount(): Promise<QwenOAuthAccountRecord | null> {
    const pool = await this.loadPool();
    const active = this.findSelectedAccount(pool);
    return active ?? null;
  }

  async getActiveAccountId(): Promise<string | null> {
    const active = await this.getActiveAccount();
    return active?.accountId || null;
  }

  async rotateActiveAccountIfNeeded(): Promise<QwenOAuthAccountRecord | null> {
    const pool = await this.loadPool();
    const active = this.findSelectedAccount(pool);
    if (!active) {
      await this.ensureActiveMirror(pool);
      return null;
    }

    if (!this.isRotationThresholdReached(active)) {
      await this.ensureActiveMirror(pool);
      return active;
    }

    const next = this.findNextAvailableAccount(pool, active.accountId);
    if (!next) {
      await this.ensureActiveMirror(pool);
      return active;
    }

    QwenOAuthAccountPool.setProcessSelectedAccountId(next.accountId);
    await this.savePool(pool);
    await this.writeAccountCredentialsFile(
      next.accountId,
      toActiveCredentials(next),
    );
    await this.writeActiveCredentialsFile(toActiveCredentials(next));
    debugLogger.info(
      `Rotated Qwen OAuth account from ${active.label} to ${next.label} after reaching local threshold.`,
    );
    return next;
  }

  async rotateToNextAvailableAccount(
    excludeAccountId?: string,
  ): Promise<QwenOAuthAccountRecord | null> {
    const pool = await this.loadPool();
    const next = this.findNextAvailableAccount(pool, excludeAccountId);
    if (!next) {
      await this.ensureActiveMirror(pool);
      return null;
    }

    QwenOAuthAccountPool.setProcessSelectedAccountId(next.accountId);
    await this.savePool(pool);
    await this.writeAccountCredentialsFile(
      next.accountId,
      toActiveCredentials(next),
    );
    await this.writeActiveCredentialsFile(toActiveCredentials(next));
    debugLogger.info(`Switched active Qwen OAuth account to ${next.label}.`);
    return next;
  }

  async getAccounts(): Promise<QwenOAuthAccountListItem[]> {
    const pool = await this.loadPool();
    const selectedId =
      QwenOAuthAccountPool.getProcessSelectedAccountId() ||
      pool.activeAccountId;
    return pool.accounts.map((account, index) => ({
      index: index + 1,
      isSelected: account.accountId === selectedId,
      isGlobalDefault: account.accountId === pool.activeAccountId,
      account: {
        ...account,
        usage: normalizeUsage(account.usage),
      },
    }));
  }

  async switchProcessAccountByIndex(
    index: number,
  ): Promise<QwenOAuthAccountRecord | null> {
    const pool = await this.loadPool();
    if (
      !Number.isInteger(index) ||
      index <= 0 ||
      index > pool.accounts.length
    ) {
      return null;
    }

    const account = pool.accounts[index - 1] || null;
    if (!account) {
      return null;
    }

    QwenOAuthAccountPool.setProcessSelectedAccountId(account.accountId);
    QwenOAuthAccountPool.setProcessSelectedAccountIndex(index);
    await this.writeAccountCredentialsFile(
      account.accountId,
      toActiveCredentials(account),
    );
    await this.writeActiveCredentialsFile(toActiveCredentials(account));
    return account;
  }

  async setDefaultAccountByIndex(
    index: number,
  ): Promise<QwenOAuthAccountRecord | null> {
    const pool = await this.loadPool();
    if (
      !Number.isInteger(index) ||
      index <= 0 ||
      index > pool.accounts.length
    ) {
      return null;
    }

    const account = pool.accounts[index - 1] || null;
    if (!account) {
      return null;
    }

    pool.activeAccountId = account.accountId;
    await this.savePool(pool);
    await this.writeAccountCredentialsFile(
      account.accountId,
      toActiveCredentials(account),
    );
    await this.writeActiveCredentialsFile(toActiveCredentials(account));
    return account;
  }

  async recordSuccessfulRequest(accountId?: string): Promise<void> {
    const pool = await this.loadPool();
    const account = this.findAccount(pool, accountId);
    if (!account) {
      return;
    }

    account.usage = normalizeUsage(account.usage);
    account.usage.successfulRequests += 1;
    account.usage.lastUsedAt = Date.now();

    await this.savePool(pool);
  }

  async markQuotaExceeded(accountId?: string): Promise<void> {
    const pool = await this.loadPool();
    const account = this.findAccount(pool, accountId);
    if (!account) {
      return;
    }

    account.usage = normalizeUsage(account.usage);
    account.usage.quotaExceeded = true;
    account.usage.lastUsedAt = Date.now();
    await this.savePool(pool);
  }

  async removeActiveAccount(): Promise<void> {
    const pool = await this.loadPool();
    const active = this.findSelectedAccount(pool);
    if (!active) {
      await this.removeActiveCredentialsFile();
      return;
    }

    pool.accounts = pool.accounts.filter(
      (account) => account.accountId !== active.accountId,
    );
    if (pool.activeAccountId === active.accountId) {
      pool.activeAccountId = undefined;
    }
    await this.removeAccountCredentialsFile(active.accountId);
    const replacement = this.findNextAvailableAccount(pool, active.accountId);
    if (replacement) {
      if (!pool.activeAccountId) {
        pool.activeAccountId = replacement.accountId;
      }
      QwenOAuthAccountPool.setProcessSelectedAccountId(replacement.accountId);
    } else {
      QwenOAuthAccountPool.setProcessSelectedAccountId(null);
    }

    await this.savePool(pool);
    await this.ensureActiveMirror(pool);
  }

  private isRotationThresholdReached(account: QwenOAuthAccountRecord): boolean {
    const usage = normalizeUsage(account.usage);
    if (usage.quotaExceeded) {
      return true;
    }

    const { dailyRequestLimit, threshold } = this.getRotationConfig();
    return usage.successfulRequests >= Math.ceil(dailyRequestLimit * threshold);
  }

  private isAccountAvailable(account: QwenOAuthAccountRecord): boolean {
    const usage = normalizeUsage(account.usage);
    if (usage.quotaExceeded) {
      return false;
    }

    const { dailyRequestLimit, threshold } = this.getRotationConfig();
    return usage.successfulRequests < Math.ceil(dailyRequestLimit * threshold);
  }

  private findAccount(
    pool: QwenOAuthAccountPoolFile,
    accountId?: string,
  ): QwenOAuthAccountRecord | undefined {
    if (accountId) {
      return pool.accounts.find((account) => account.accountId === accountId);
    }
    return this.findSelectedAccount(pool) ?? undefined;
  }

  private findActiveAccount(
    pool: QwenOAuthAccountPoolFile,
  ): QwenOAuthAccountRecord | null {
    if (pool.activeAccountId) {
      const active = pool.accounts.find(
        (account) => account.accountId === pool.activeAccountId,
      );
      if (active) {
        return active;
      }
    }

    return pool.accounts[0] || null;
  }

  private findSelectedAccount(
    pool: QwenOAuthAccountPoolFile,
  ): QwenOAuthAccountRecord | null {
    const selectedId = QwenOAuthAccountPool.getProcessSelectedAccountId();
    if (selectedId) {
      const selected = pool.accounts.find(
        (account) => account.accountId === selectedId,
      );
      if (selected) {
        return selected;
      }
    }

    const selectedIndex = QwenOAuthAccountPool.getProcessSelectedAccountIndex();
    if (
      selectedIndex &&
      selectedIndex > 0 &&
      selectedIndex <= pool.accounts.length
    ) {
      const selected = pool.accounts[selectedIndex - 1] || null;
      if (selected) {
        QwenOAuthAccountPool.setProcessSelectedAccountId(selected.accountId);
        return selected;
      }
    }

    return this.findActiveAccount(pool);
  }

  private findNextAvailableAccount(
    pool: QwenOAuthAccountPoolFile,
    excludeAccountId?: string,
  ): QwenOAuthAccountRecord | null {
    if (pool.accounts.length === 0) {
      return null;
    }

    const activeIndex = pool.activeAccountId
      ? pool.accounts.findIndex(
          (account) => account.accountId === pool.activeAccountId,
        )
      : -1;

    for (let offset = 1; offset <= pool.accounts.length; offset++) {
      const index =
        activeIndex >= 0
          ? (activeIndex + offset) % pool.accounts.length
          : offset - 1;
      const candidate = pool.accounts[index];
      if (!candidate) {
        continue;
      }
      if (excludeAccountId && candidate.accountId === excludeAccountId) {
        continue;
      }
      if (this.isAccountAvailable(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async loadPool(): Promise<QwenOAuthAccountPoolFile> {
    try {
      const filePath = this.getPoolFilePath();
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<QwenOAuthAccountPoolFile>;
      const accounts = Array.isArray(parsed.accounts)
        ? parsed.accounts.map((account) => ({
            ...account,
            usage: normalizeUsage(account.usage),
          }))
        : [];

      return {
        version: 1,
        activeAccountId: parsed.activeAccountId,
        accounts,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return {
          version: 1,
          accounts: [],
        };
      }

      debugLogger.warn('Failed to load Qwen OAuth account pool:', error);
      return {
        version: 1,
        accounts: [],
      };
    }
  }

  private async savePool(pool: QwenOAuthAccountPoolFile): Promise<void> {
    const filePath = this.getPoolFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(pool, null, 2), {
      mode: 0o600,
    });
  }

  private async ensureActiveMirror(
    pool: QwenOAuthAccountPoolFile,
  ): Promise<void> {
    const active = this.findActiveAccount(pool);
    if (!active) {
      await this.removeActiveCredentialsFile();
      return;
    }

    if (pool.activeAccountId !== active.accountId) {
      pool.activeAccountId = active.accountId;
      await this.savePool(pool);
    }

    await this.writeAccountCredentialsFile(
      active.accountId,
      toActiveCredentials(active),
    );
    await this.writeActiveCredentialsFile(toActiveCredentials(active));
  }

  private async writeAccountCredentialsFile(
    accountId: string,
    credentials: QwenCredentials,
  ): Promise<void> {
    const filePath = this.getAccountCredentialsPath(accountId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    });
  }

  private async writeActiveCredentialsFile(
    credentials: QwenCredentials,
  ): Promise<void> {
    const filePath = this.getActiveCredentialsPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    });
  }

  private async removeActiveCredentialsFile(): Promise<void> {
    try {
      await fs.unlink(this.getActiveCredentialsPath());
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      ) {
        debugLogger.warn(
          'Failed to remove active Qwen OAuth credentials file:',
          error,
        );
      }
    }
  }

  private async removeAccountCredentialsFile(accountId: string): Promise<void> {
    try {
      await fs.unlink(this.getAccountCredentialsPath(accountId));
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      ) {
        debugLogger.warn(
          `Failed to remove Qwen OAuth credentials file for account ${accountId}:`,
          error,
        );
      }
    }
  }
}
