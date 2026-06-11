# Agent Instructions

## Planning Artifacts

Planning decisions for this project must be authored as HTML documents.

- Do not create or update Markdown files for product plans, architecture plans,
  design decisions, roadmaps, implementation plans, or planning notes.
- Use the smallest HTML artifact that is actually helpful. Prefer brief,
  focused documents over elaborate plans.
- Interactive elements, comparisons, and richer layouts are available options,
  not defaults.
- Before creating or expanding a plan, check whether the needed facts are
  already known and whether the document will change a decision or next action.
- Avoid documenting for its own sake.
- Prefer existing project styling in `docs.css` for planning pages.
- When migrating older planning material, remove the Markdown planning artifact
  and replace it with an HTML page linked from the project navigation.
- Markdown is allowed only for agent or repository instruction files such as
  this `AGENTS.md`, not for project planning artifacts.

## Behavior Changes

When the user states a durable project behavior or correction, consider whether
this file needs to be updated before continuing.

## Decision Flow

- Use two-way-door judgment for implementation decisions. If a choice is cheap
  to reverse, make the smallest reasonable decision and keep building.
- Stop to ask questions or create explanatory HTML artifacts only for major
  architectural blockers, irreversible choices, or decisions that would change
  the project direction.
- Prefer building the next small verified slice over expanding planning docs
  once the current plan is clear.
- Keep the HTML plan up to date when major implementation changes, milestones,
  or direction-setting decisions land.
- Prefer appending new plan updates or milestone notes over editing existing
  plan text, so changes are obvious and easy to review.

## Architecture Language

- A simple JavaScript runtime include does not imply a single-file source
  architecture. Plans and documentation should distinguish the consumer-facing
  include from the project source layout.
- Do not introduce a bundler, generated build pipeline, or complex abstraction
  layer for modularity unless the user explicitly asks for it.
- Prefer the minimum useful type safety first: plain JavaScript with JSDoc
  types and static checking is acceptable before adopting TypeScript or a build
  step.
- If source files are split before a build step exists, prefer native browser
  ES modules over generated output.

## HTML Artifacts And Annotations

- Treat HTML artifacts as live project documents. The file on disk is the
  source of truth, and the agent owns updates to the actual HTML content.
- User comments and annotations are first-class communication between the user
  and agent. They must be durable, visible to the agent from disk or durable
  file-backed data, and rendered back to the user as part of one cohesive page.
- Keep annotations conceptually separate from source text. They may be stored
  with the HTML artifact, but editing a note must not accidentally rewrite the
  document content.
- Attach annotations to DOM elements. When an element is rewritten or replaced,
  reset its child annotations unless the system can clearly reattach them.
- Live document editing is required, but whole-page contenteditable is the wrong
  long-term boundary. Prefer targeted edit controls that create durable deltas
  or edit objects for the agent to reconcile with the source HTML.

## Tooling

- Use Bun for package scripts, dependency installation, and lockfile updates.
  Do not introduce npm-based workflow steps unless the user explicitly asks.

## Testing

- Do not rely only on existing tests when behavior changes or refactors touch a
  meaningful user-facing path. Add focused coverage when it is appropriate for
  the risk of the change.
