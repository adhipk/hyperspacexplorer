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
- Use artifact-specific styling for planning and presentation pages when it
  serves the document better. Do not default to `docs.css` or copied reference
  styles when a custom presentation would be clearer.
- Checklists, plans, roadmaps, and design-decision documents are user-editable
  review artifacts. Use ordinary semantic HTML as individual editable items and
  live controls for checklist state instead of disabled status markup.
- When migrating older planning material, remove the Markdown planning artifact
  and replace it with an HTML page linked from the project navigation.
- Markdown is allowed only for agent or repository instruction files such as
  this `AGENTS.md`, not for project planning artifacts.

## Behavior Changes

When the user states a durable project behavior or correction, consider whether
this file needs to be updated before continuing.

## Current Product Direction

- Build Hyperspace as a layer over HyperclayJS. Do not reinvent Hyperclay's
  edit mode, snapshot, dirty-check, persistence, or save stack unless the user
  explicitly changes direction.
- Base HTML is not page-wide `contenteditable`. Hyperspace treats ordinary
  document items as editable candidates, but only the single toolbar edit toggle
  activates direct editing. When the toggle is off, the page behaves like normal
  HTML and commenting still works.
- Do not flood dense structured content with one persistent edit affordance per
  child. There are no per-element edit badges. The edit toolbar button shows a
  slashed or blocked pencil when edit mode is off and a normal pencil when it is
  on.
- Use ordinary semantic elements as individual edit targets. Lists get special
  add, delete, reorder, and item-edit rules in edit mode; broad wrappers should
  not become a single editable page region.
- Match edit affordances to the content structure. Use direct text editing for
  prose-like content. Use structured controls for structured content: lists need
  add, delete, and reorder operations; tables need row, column, and cell
  operations; repeated cards need add, remove, and reorder operations; media
  needs replace and metadata controls; links/buttons need label and target or
  action controls; form-like content needs option/schema controls; code/config
  needs validated editor behavior.
- Prefer reusing Hyperclay Local's server core without the Electron app for
  production/local hosting. A small project-local server is acceptable as a
  compatibility shim for tests, prototyping, and runtime-injection experiments,
  but should not become a parallel save-server product unless Hyperclay Local's
  server blocks a concrete workflow.
- Keep source HTML ordinary and readable. AI-generated pages may use
  Hyperclay primitives and Hyperspace tool definitions, but page generation
  should not need to remember runtime boilerplate.
- Optimize the product around agent-authored HTML artifacts for review. Users
  need basic, robust review tools on top of those artifacts, not a general
  purpose website editor.
- Keep Hyperspace's toolbar, interactive controls, toast styling, and runtime
  CSS in external runtime assets. Artifact HTML may own its document styling,
  but should not embed Hyperspace application chrome or runtime CSS.
- Store basic comments as nearby HTML elements inside the closest reasonable
  document container selected by the user's first click. Do not attach basic
  comments to a specific target object unless the user asks for targeted
  annotations; screen position is CSS/runtime state, while source position keeps
  the comment semantically close.
- Keep basic comment UI low-intrusion: no border, no background, only positioned
  plain red text set in Excalifont, with no text shadow or decorative contrast
  effects. Comments should automatically size to their text; do not add manual
  resize boxes or persist fixed comment width/height. The armed comment tool
  must visibly change the page cursor, and empty draft comments must still have
  a visible caret footprint so creating a new comment is apparent. Single click
  focuses a comment, holding and dragging moves it, double click edits the text,
  and keyboard deletion removes a focused comment.
- Do not add a visible select tool to the toolbar. Idle selection is the default
  runtime state. The toolbar has a single edit toggle, a comment tool, and save;
  comments remain available independently of edit mode.
- Save text changes on focus loss. Autosaves should be quiet and must not show
  Hyperclay toast/popup UI; visible save feedback is reserved for manual saves.

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
- Model tool behavior with an explicit app-state store rather than scattered
  booleans and event-handler side effects. A small plain JavaScript/JSON store
  is acceptable first; keep the Excalidraw-style shape in mind with
  `activeTool`, `interaction`, and `selection` as distinct concepts. Consider
  `@xstate/store` only if the local store becomes strained enough to justify
  the dependency.
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
