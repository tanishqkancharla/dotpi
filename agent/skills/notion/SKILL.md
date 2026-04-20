---
name: notion
description: Search, create, and manage pages in the Saffron Health Notion workspace. Use when the user asks about Notion tasks, notes, projects, or wants to interact with Notion databases.
---

# Notion Workspace — Saffron Health

Use the `ntn` CLI. Run `ntn --help`, `ntn api --help`, `ntn api ls`, and `ntn api <endpoint> --docs` to learn usage — it's self-documenting.

## Databases & Data Sources

All databases live under "Saffron HQ".

### Notes

- **Database ID:** `207ac9fb-35f1-818b-8f6f-ed189367b5f6`
- **Data source ID:** `207ac9fb-35f1-8164-9dd0-000b3edd46f3`

| Property    | Type         | Values                                                                                                      |
| ----------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| Name        | title        |                                                                                                             |
| Type        | select       | New product idea, External meeting, Venture Capital, Planning cycle, Hypothesis to test, Engineering review |
| Tags        | multi_select | Company feedback, Progress meeting                                                                          |
| Importance  | select       | Very                                                                                                        |
| People      | relation     | → People database                                                                                           |
| Pinned      | checkbox     |                                                                                                             |
| Manual time | date         |                                                                                                             |

**Templates:** Planning cycle, Meeting, Intro Sales Call

### Tasks

- **Database ID:** `31aac9fb-35f1-80ae-8b5f-c5f67589045b`
- **Data source ID:** `31aac9fb-35f1-8018-a5ce-000bb568a02b`

| Property                | Type           | Values                                                      |
| ----------------------- | -------------- | ----------------------------------------------------------- |
| Name                    | title          |                                                             |
| Completion Status       | status         | Backlog, Untriaged, Not started, In progress, Archive, Done |
| Owner                   | person         |                                                             |
| Project                 | relation       | → Projects database                                         |
| Depends on / Dependents | relation       | → self                                                      |
| GitHub PR               | relation       | → GitHub PRs                                                |
| Completed date          | date           |                                                             |
| Id                      | auto_increment |                                                             |

### Projects

- **Database ID:** `31aac9fb-35f1-8059-95e5-e9f6df5f5a28`
- **Data source ID:** `31aac9fb-35f1-8063-838f-000beb4f8193`

| Property | Type     | Values                                     |
| -------- | -------- | ------------------------------------------ |
| Name     | title    |                                            |
| Status   | status   | Not started, Background, In progress, Done |
| Tasks    | relation | → Tasks database                           |
