---
name: hyperspace-html-artifacts
description: Create and reconcile Hyperspace review artifacts as ordinary HTML files with durable nearby comments, toolbar-controlled item edits, structured list controls, and local-save friendly source. Use when Codex needs to author, update, inspect, or respond to user-reviewed `.html` artifacts that are opened through the Hyperspace/Hyperclay review loop.
---

# Hyperspace HTML Artifacts

## Overview

Use this skill to make HTML artifacts that can be reviewed in Hyperspace and then reconciled by an agent from disk. Keep the source readable, keep annotations separate from document content, and use ordinary semantic HTML as the review surface.

## Authoring Workflow

1. Create or update a normal `.html` file in the user's project.
2. Reuse the consumer project's existing stylesheet when one exists.
3. Add `data-hs-comment-host` to the closest durable document container where comments should be inserted.
4. Use normal headings, paragraphs, list items, table cells, captions, and summaries as individual edit targets. The Hyperspace toolbar controls whether they become editable.
5. Use normal `ol` and `ul` lists for list content; Hyperspace supplies add, delete, reorder, and item-edit controls while edit mode is active.
6. Avoid whole-page `contenteditable`, runtime toolbar markup, and generated build output in source files.
7. After a user review, read the saved HTML from disk before acting on comments or edits.

## Source Conventions

Use these attributes as the stable artifact contract:

- `data-hs-comment-host`: a container that can receive nearby comment elements.
- `data-hs-comment`: a durable user annotation stored as real nearby HTML.
- `movable`: marks comments whose rendered position is stored with CSS transform state.

Example:

```html
<section class="section" data-hs-comment-host>
  <h2>Decision</h2>
  <p>
    This exact wording is under review.
  </p>

  <ol>
    <li>First concrete next step.</li>
    <li>Second concrete next step.</li>
  </ol>

  <aside data-hs-comment movable style="transform: translate(72px, 120px)">
    <p>Clarify the owner before shipping.</p>
  </aside>
</section>
```

## Editable Boundaries

Use direct text editing for prose-like content only when the exact wording is the review surface. Do not wrap broad page regions in a single editable element; let Hyperspace select individual document items while edit mode is active.

Use structured controls for structured content:

- Lists: use ordinary `ol` and `ul` lists; Hyperspace supplies list controls in edit mode.
- Tables: prefer a future table-specific control instead of generic contenteditable cells.
- Repeated cards: prefer add, remove, and reorder controls rather than one editable wrapper.
- Links/buttons: keep label and target/action distinct.
- Code/config: use constrained editor behavior, not generic rich text editing.

## Reconciling Reviews

When the user has reviewed an artifact:

1. Read the saved HTML file from disk, not the pre-review source in memory.
2. Treat elements with `data-hs-comment` as user annotations, not source copy.
3. Treat changed text inside ordinary document elements as user edits.
4. Apply accepted feedback to the document content.
5. Remove or rewrite resolved comments only when doing so is clearly part of the requested update.
6. Preserve unrelated comments and transforms.
7. Leave runtime-only UI out of source. If present, remove elements marked `data-hs-runtime` or `save-remove`.

Prefer small source edits that preserve the artifact's readable structure. If an annotation cannot be confidently mapped after a large rewrite, keep it near the rewritten section for user review instead of silently deleting it.
