---
name: get-pi-cost
description: Check how much has been spent on Pi sessions for a given day, broken down by model and project. Use when the user asks about Pi costs, spending, or token usage.
---

# Get Pi Cost

Use this skill when the user asks about Pi session costs, spending, or token usage.

## Usage

Run the Python script at `pi-cost.py` (resolve relative to this skill directory):

```bash
# Today's costs
python3 <skill-dir>/pi-cost.py today

# Yesterday's costs
python3 <skill-dir>/pi-cost.py yesterday

# Specific date
python3 <skill-dir>/pi-cost.py 2026-04-03

# JSON output for programmatic use
python3 <skill-dir>/pi-cost.py today --json
```

The script reads session files from `~/.pi/agent/sessions/` and reports:

- **Cost by model** — with input, output, and cache-read token counts
- **Cost by project** — derived from the session directory name
- **Top sessions** — the 10 most expensive sessions that day
