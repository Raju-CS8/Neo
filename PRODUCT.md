# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS frontend; separate Express 5 API server owning business logic, authorization and real-time connections; PostgreSQL via Drizzle with SQL migrations; Socket.IO for real time; Zod for validation. Chosen by the user from the hackathon brief's recommended stack. Local development uses the machine's PostgreSQL 18 service; the user supplies the password in `.env`.

## Users

Software and consulting delivery teams. Four roles, each a real job in the product:

- **Admin**: runs the workspace. Manages users, creates and deletes projects, assigns project managers, sees everything.
- **Project Manager**: runs assigned projects. Manages the team and tasks, assigns work, watches project activity.
- **Team Member**: does the work. Sees their projects and tasks, updates them, comments, moves status.
- **Viewer**: follows along read-only, such as a client or stakeholder.

Secondary audience: NeoStats hackathon judges, who run it locally, open two browser sessions, and call the API directly to test enforcement.

## Product Purpose

Lockstep is a multi-user project management platform where everyone on a delivery team works from the same state at the same moment. Success means a change made by one person appears for everyone relevant without a refresh, nobody's work is silently overwritten, and permissions hold even against direct API calls.

## Positioning

Lockstep treats shared state as the product. Every task carries a version; stale edits are stopped and reconciled in front of the person making them rather than quietly overwriting a colleague.

## Operating Context

Used all day in a desktop browser during delivery work: standups, triage, planning, status checks. The hackathon demo is two browser sessions side by side, signed in as different roles.

## Capabilities and Constraints

- CRUD: users (create, read, update, deactivate), projects (create, read, update, archive), team members (add, remove, change project-level role), tasks (create, read, update, delete, assign, change status), comments (create, read, delete).
- Real-time propagation of task changes, status changes, assignments, comments and notifications.
- Authorization enforced on the server. A rejected operation is rejected at the API, not just hidden in the UI.
- Optimistic concurrency on tasks: a stale version returns HTTP 409 and the UI guides the user through the latest state.
- Activity log for important actions. Notifications with read/unread state for assignment, status changes, mentions, membership changes and comments.
- Must ship: migrations, seed script covering every role, README, architecture note, `.env.example`, no committed secrets.
- Terminology: Admin, Project Manager, Team Member, Viewer, as in the brief.

## Brand Commitments

Product name: Lockstep (chosen for the hackathon; no prior brand assets exist).

## Evidence on Hand

The hackathon brief is the only source material. There are no real customers, testimonials, benchmarks or usage numbers, and none may be invented. Seed data is demonstration content.

## Product Principles

1. Never lose someone's work: conflicts are surfaced and resolved, not overwritten.
2. The server is the authority: the interface reflects permissions and never substitutes for them.
3. Show change as it happens: people should see who changed what without asking or refreshing.
4. Every role gets a complete product: a Viewer's read-only experience is designed, not a disabled version of someone else's.
5. Everything must be explainable: prefer plain mechanisms the team can defend line by line.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Status and role must never rely on colour alone. Full keyboard operation, including moving tasks between statuses without drag and drop. Live updates respect reduced-motion preferences.
