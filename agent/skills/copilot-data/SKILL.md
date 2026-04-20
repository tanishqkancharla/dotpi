---
name: copilot-data
description: Locate and inspect local data for the Copilot personal finance macOS app. Use when the user wants to find Copilot app data, inspect budgets, transactions, balances, or explain why the budget view differs from cash leaving a bank account.
---

# Copilot Data

Use this skill when the user asks about the Copilot personal finance app on macOS and wants to inspect local app data.

Treat all financial data as sensitive. Prefer read-only inspection, summarize only what the user asked for, and avoid copying large amounts of raw transaction data unless requested.

## Known Local Data Locations

Check these first:

- App bundle: `/Applications/Copilot.app`
- Main app container: `~/Library/Containers/com.copilot.production`
- Group container: `~/Library/Group Containers/group.com.copilot.production`
- Main SQLite database: `~/Library/Group Containers/group.com.copilot.production/database/CopilotDB.sqlite`
- Widget snapshots: `~/Library/Group Containers/group.com.copilot.production/widget-data`

Useful files inside the group container:

- `database/CopilotDB.sqlite`
- `widget-data/widgets-transactions-recent_transactions.json`
- `widget-data/widgets-budget-monthly_spending_budgets.json`
- `widget-data/widgets-category-default_categories.json`
- `widget-data/widgets-account-credit_accounts.json`
- `widget-data/widgets-account-other_accounts.json`

Useful but usually secondary:

- `~/Library/Containers/com.copilot.production/Data/Library/Preferences/com.copilot.production.plist`
- `~/Library/Group Containers/group.com.copilot.production/Library/Preferences/group.com.copilot.production.plist`

## Quick Inspection Workflow

Start with discovery if needed:

```bash
ls -1 /Applications | rg -i 'copilot'
find ~/Library/Containers -maxdepth 2 -iname '*copilot*'
find ~/Library/Group\ Containers -maxdepth 2 -iname '*copilot*'
```

Confirm the app bundle metadata:

```bash
defaults read /Applications/Copilot.app/Contents/Info CFBundleIdentifier
defaults read /Applications/Copilot.app/Contents/Info CFBundleName
defaults read /Applications/Copilot.app/Contents/Info CFBundleShortVersionString
```

List database tables:

```bash
sqlite3 ~/Library/Group\ Containers/group.com.copilot.production/database/CopilotDB.sqlite '.tables'
```

Inspect schema:

```bash
sqlite3 -header -column ~/Library/Group\ Containers/group.com.copilot.production/database/CopilotDB.sqlite "PRAGMA table_info(Transactions);"
sqlite3 -header -column ~/Library/Group\ Containers/group.com.copilot.production/database/CopilotDB.sqlite "PRAGMA table_info(accountDailyBalance);"
```

Preview recent transactions from JSON snapshots:

```bash
python3 - <<'PY'
import json, pathlib
base = pathlib.Path.home() / 'Library/Group Containers/group.com.copilot.production/widget-data'
for name in [
    'widgets-transactions-recent_transactions.json',
    'widgets-budget-monthly_spending_budgets.json',
    'widgets-category-default_categories.json',
]:
    p = base / name
    print(f'--- {name} ---')
    print(json.dumps(json.loads(p.read_text()), indent=2)[:4000])
PY
```

## What the Main Database Contains

Known tables:

- `Transactions`
- `accountDailyBalance`
- `grdb_migrations`

The `Transactions` table includes fields such as:

- `id`
- `account_id`
- `name`
- `amount`
- `date`
- `type`
- `category_id`
- `user_reviewed`
- `pending`

The `accountDailyBalance` table includes fields such as:

- `date`
- `account_id`
- `available_balance`
- `current_balance`
- `limit`

## Interpreting the Data

Do not assume the budget screen equals cash flow.

In Copilot data, a common pattern is:

- `regular`: budgetable spending
- `internal_transfer`: money moving between accounts or card payments
- `income`: inflows, credits, payroll, interest, and similar entries

Important: cash can leave checking because of `internal_transfer` entries while the user still appears under budget. This is the main thing to explain when the app says spending is under budget but the bank balance keeps dropping.

Also watch for these patterns:

- credit card autopay transactions
- returned payments
- NSF or overdraft-related retries
- Venmo or Apple Cash transfers
- Fidelity or other brokerage transfers

## High-Value Queries

Current month totals by type:

```bash
sqlite3 -header -column ~/Library/Group\ Containers/group.com.copilot.production/database/CopilotDB.sqlite "
SELECT type,
       COUNT(*) AS count,
       ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 2) AS positive_sum,
       ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 2) AS negative_sum
FROM Transactions
WHERE date >= date('now','start of month')
GROUP BY type
ORDER BY negative_sum DESC, positive_sum DESC;"
```

Current month spending by category for regular transactions:

```bash
sqlite3 -header -column ~/Library/Group\ Containers/group.com.copilot.production/database/CopilotDB.sqlite "
SELECT category_id,
       ROUND(SUM(amount), 2) AS amount,
       COUNT(*) AS count
FROM Transactions
WHERE date >= date('now','start of month')
  AND type = 'regular'
  AND amount > 0
GROUP BY category_id
ORDER BY amount DESC;"
```

Search for suspicious cash-movement patterns:

```bash
sqlite3 -header -column ~/Library/Group\ Containers/group.com.copilot.production/database/CopilotDB.sqlite "
SELECT date(date) AS day, account_id, type, amount, name
FROM Transactions
WHERE UPPER(name) LIKE '%AUTOPAY%'
   OR UPPER(name) LIKE '%RETURNED%'
   OR UPPER(name) LIKE '%NSF%'
   OR UPPER(name) LIKE '%VENMO%'
ORDER BY date DESC;"
```

Daily balances for an account:

```bash
sqlite3 -header -column ~/Library/Group\ Containers/group.com.copilot.production/database/CopilotDB.sqlite "
SELECT date(date) AS day, available_balance, current_balance
FROM accountDailyBalance
WHERE account_id = '<ACCOUNT_ID>'
ORDER BY date DESC
LIMIT 30;"
```

## Mapping IDs to Human Names

The database uses opaque `account_id` and `category_id` values. Map them using widget snapshot files:

- accounts: `widget-data/widgets-account-credit_accounts.json`
- accounts: `widget-data/widgets-account-other_accounts.json`
- categories: `widget-data/widgets-category-categories.json`
- categories: `widget-data/widgets-category-default_categories.json`

Example:

```bash
python3 - <<'PY'
import json, pathlib
base = pathlib.Path.home() / 'Library/Group Containers/group.com.copilot.production/widget-data'
for name in [
    'widgets-account-credit_accounts.json',
    'widgets-account-other_accounts.json',
    'widgets-category-categories.json',
]:
    p = base / name
    print(f'--- {name} ---')
    print(json.dumps(json.loads(p.read_text()), indent=2))
PY
```

## How to Answer the User

When reporting findings:

1. Say where the local data lives.
2. Distinguish budget spending from transfers and payments.
3. Call out large outflows from checking that are not counted as budget spending.
4. Mention returned-payment or retry patterns if present.
5. Offer one of these next steps:
   - monthly cash-flow summary
   - list of bank-account outflows not counted in budget
   - export of readable recent transactions

## Preferred Framing

Use language like this when appropriate:

- "Copilot is storing readable local data in a SQLite database and JSON widget snapshots."
- "The budget view is not the same as cash flow."
- "Transfers, credit card payments, and retries can reduce checking without increasing the budget spend total."

## Do Not Do This Automatically

- Do not modify Copilot data files.
- Do not bulk dump the entire database unless the user asks.
- Do not share sensitive numbers beyond what is needed for the answer.
