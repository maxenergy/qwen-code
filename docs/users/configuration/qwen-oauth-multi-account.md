# Qwen OAuth Multi-Account

Qwen Code can store multiple Qwen OAuth accounts and rotate between them automatically.

This is useful when:

- You have multiple free Qwen OAuth accounts.
- You want one terminal session per account.
- You want Qwen Code to switch accounts automatically before a daily quota is exhausted.

## How It Works

When you authenticate with **Qwen OAuth** more than once, Qwen Code adds each login to a local account pool instead of replacing the previous account.

Each running `qwen` process can:

- start from a specific account index
- switch to another saved account manually
- rotate to the next saved account automatically when the current one approaches its local daily threshold

Automatic rotation uses local request tracking:

- default daily request limit: `1000`
- default switch threshold: `95%`

You can override these defaults with environment variables:

```bash
export QWEN_OAUTH_DAILY_REQUEST_LIMIT=1000
export QWEN_OAUTH_ROTATION_THRESHOLD=0.95
```

> [!note]
>
> The rotation threshold is based on local usage tracking in this machine and this Qwen Code installation. If the same account is used elsewhere, the local estimate may be lower than the real server-side usage.

## Add Multiple Accounts

Run `/auth` inside Qwen Code and select **Qwen OAuth**. Repeat the login flow for each account you want to add.

```text
/auth
```

Or authenticate from the terminal:

```bash
qwen auth qwen-oauth
```

Each successful Qwen OAuth login is saved as another account in the pool.

## View Accounts

Inside an interactive session:

```text
/accounts
```

From the terminal:

```bash
qwen accounts list
qwen accounts status
```

## Switch Accounts Manually

Inside an interactive session, switch the current running process to account 2:

```text
/accounts 2
```

From the terminal, change the default account for future sessions:

```bash
qwen accounts switch 2
```

## Start a Session From a Specific Account

Use `--account-index` to bind a process to a specific saved account when it starts:

```bash
qwen --account-index 1
qwen --account-index 2
qwen --account-index 3
```

This is useful when you run multiple Qwen Code sessions in parallel and want each terminal to begin from a different account.

## Automatic Rotation

During a session, Qwen Code will try to move to the next available saved account when:

- the current account reaches the configured local threshold, or
- the current account returns a quota-exceeded response

If no other saved account is available, Qwen Code continues to report the quota error.

## Command Summary

| Command                  | Purpose                                                  |
| ------------------------ | -------------------------------------------------------- |
| `/auth`                  | add another Qwen OAuth account in an interactive session |
| `/accounts`              | list saved accounts for the current session              |
| `/accounts 2`            | switch the current session to account 2                  |
| `qwen auth qwen-oauth`   | add a Qwen OAuth account from the terminal               |
| `qwen accounts list`     | list saved accounts                                      |
| `qwen accounts status`   | show the default account                                 |
| `qwen accounts switch 2` | set the default account for future sessions              |
| `qwen --account-index 2` | start this process from account 2                        |
