# Architecture

```
Next.js (3000) --REST + cookie--> Express API (4000) --> PostgreSQL
      ^------- Socket.IO, same cookie ------'
```

The API owns all business logic, authorization and real-time connections. The frontend holds no permission logic that matters; it only hides controls for convenience.

## Real time

**Choice: Socket.IO.** Traffic is mostly server to client, so SSE would also work, but Socket.IO gives rooms and automatic reconnection without extra code.

- Sockets authenticate with the same httpOnly session cookie as REST.
- The server assigns rooms (`user:<id>`, `project:<id>`, `admins`). Clients cannot subscribe themselves, so authorization holds on the real-time channel too. Membership changes join or leave rooms immediately.
- `Outbox` (`api/src/realtime.ts`) queues messages during a transaction and sends them only after commit, so clients never hear about a rolled-back change.
- Events tell the client what to refetch. REST stays the single source of truth, and after a reconnect the client refetches everything, so missed events cannot leave stale state.
- Limit: rooms live in one process. Running several API instances would need the Socket.IO Redis adapter.

## Data model

`users`, `projects`, `project_members`, `tasks`, `comments`, `notifications`, `activity_logs`. Schema is in `api/src/db/schema.ts`; SQL migrations are in `api/drizzle/`.

- Roles exist at two levels: `users.role` (global) and `project_members.role`. A global Viewer is always read-only.
- `tasks.version` is the concurrency token. `(project_id, number)` is unique and gives codes like `ATL-5`.
- `activity_logs` uses `ON DELETE SET NULL`, so the audit trail outlives deleted projects.

## Authorization

`api/src/policy.ts` holds one permission table. Every project route calls `authorize(user, projectId, action)`.

- 401: not signed in. The user is reloaded per request, so deactivation applies immediately.
- 404: not a member. Project existence is not leaked.
- 403: a member without permission.
- 409: a write to an archived project.

Team Members may edit only tasks assigned to them and cannot reassign. Only Admins can grant or remove the Project Manager role.

## Concurrent updates

Each edit sends the version it was based on. The check and write are one atomic statement:

```sql
UPDATE tasks SET ..., version = version + 1 WHERE id = $1 AND version = $2
```

Zero rows updated means a conflict: the API returns 409 `VERSION_CONFLICT` with the latest task. No lock is held while a user edits, and two simultaneous writers cannot both succeed. Deletes use the same check.

In the UI, live changes flow into a clean form. A form with unsaved edits is left alone and shows a warning. On 409, the user sees their edit next to the latest value and either discards or re-applies their edits on the latest version.

## Known limits

- No rate limiting on login.
- The board loads up to 200 tasks per project.
- Comments are not versioned, because they cannot be edited.
