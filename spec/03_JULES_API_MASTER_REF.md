# Jules API & CLI: Master Technical Reference

This document serves as the "source of truth" for programmatically interacting with Jules. It covers both the **Official CLI (@google/jules)** and the **REST API (v1alpha)**.

---

## 1. Official CLI: `Jules Tools`
The CLI is the easiest way to manage sessions and pull code changes directly from your terminal.

### Installation (Local Project Scope)
To ensure stability, we keep this "installed" within the project dependencies:
```powershell
npm install @google/jules --save-dev
```

### Authentication
```powershell
npx jules login   # Opens browser for Google Auth
npx jules logout  # Clears local credentials
```

### Core Commands
| Command | Purpose | Example |
|---|---|---|
| `npx jules` | Launch Interactive TUI | `npx jules` |
| `npx jules remote list --session` | List all sessions | `npx jules remote list --session` |
| `npx jules remote new` | Start a new task | `npx jules remote new --session "Add tests"` |
| `npx jules remote pull` | Get code changes | `npx jules remote pull --session <ID>` |

---

## 2. REST API (v1alpha)
Use the API for complex integrations, automation scripts, or when building custom tools.

### Base Configuration
- **Endpoint**: `https://jules.googleapis.com/v1alpha/`
- **Auth Header**: `x-goog-api-key: YOUR_API_KEY`

### Endpoints
#### Sessions
| Method | Path | Action |
|---|---|---|
| `POST` | `/sessions` | Create new session |
| `GET` | `/sessions` | List all sessions |
| `GET` | `/sessions/{id}` | Get session details & outputs |
| `POST` | `/sessions/{id}:sendMessage` | Send instruction to active session |
| `POST` | `/sessions/{id}:approvePlan` | Approve a pending plan |

#### Activities
| Method | Path | Action |
|---|---|---|
| `GET` | `/sessions/{id}/activities` | List events, logs, and artifacts |
| `GET` | `/sessions/{id}/activities/{id}` | Get specific event details (e.g., git patch) |

#### Sources (Repositories)
| Method | Path | Action |
|---|---|---|
| `GET` | `/sources` | List connected GitHub repos |

---

## 3. Data Schemas (Simplified)

### Session Object
```json
{
  "name": "sessions/12345",
  "state": "QUEUED | PLANNING | IN_PROGRESS | COMPLETED | FAILED",
  "url": "https://jules.google.com/session/...",
  "outputs": [
    { "pullRequest": { "url": "...", "title": "..." } }
  ]
}
```

### Create Session Payload
```json
{
  "prompt": "Description of the task",
  "title": "Optional title",
  "sourceContext": {
    "source": "sources/github-owner-repo",
    "githubRepoContext": { "startingBranch": "main" }
  },
  "requirePlanApproval": true
}
```
