this is the plan
I want a single js script that can edit html pages,
I dont want to have to do anything fancy,
the js injects basic ui into the html,
basically it just turns on content editable using the edit tools,
its automatically saved to the html.

questions
do we need to talk to the server serving this file to do this?
I like the design of the tools and the ui components, try to keep the minimalist highligher design.

phase 2 result
We proved the smallest useful save path:
- HyperEdit can stay a single browser script.
- The script can remain backend-agnostic through a configurable data-save-url.
- A tiny Bun server can serve the root folder and implement one viable save endpoint.
- Native contenteditable plus a floating minimalist toolbar is enough to validate the interaction direction.

Answer to the server question:
Yes, if the edited HTML should be written back to disk. The browser can keep a local draft by itself, but persistent source-file updates need a server, native app shell, extension permission, or another trusted writer. The Bun server is only one minimal example of that trusted writer.

Known issues from the saved page edit
- Refreshing after a save can shift layout.
- Comment boxes are currently regular DOM inside the editable root, which makes keyboard behavior fragile.
- Pressing Enter in a comment can split or duplicate comment box nodes.
- Comment editing can overwrite nearby selected document text.
- Full-document serialization can include browser extension DOM, such as injected chat widgets.
- Sending the entire HTML document is heavy and risky because it persists more than HyperEdit owns.
- The current hyperedit.js is monolithic and too narrowly shaped around the first design document.

Planning direction
The next phase should define tools as small units with explicit inputs, events, and outputs:
- Select tool: depends on pointer and selection events; outputs active target state only.
- Highlight tool: depends on the current selection; outputs an annotation record or semantic highlight artifact.
- Comment tool: depends on the current selection plus isolated text input; outputs a comment record attached to an annotation id.
- Color sampler: depends on pointer target or EyeDropper result; outputs a color choice.
- Save tool: depends on dirty HyperEdit state; outputs only HyperEdit-owned artifacts or operations.

Reusable event layer:
- One document-level pointer handler routes events to the active tool.
- One selection reader normalizes selection ranges before tools use them.
- One keyboard/input controller isolates contenteditable text editing from toolbar/comment editing.
- One serializer owns all cleanup and only emits approved HyperEdit output.

Output artifact options:
- Store an operation log of HyperEdit events and replay it onto source HTML.
- Store annotation records separately from the document body.
- Store semantic custom elements such as hx-highlight and hx-comment, or data-owned semantic spans, then hydrate them into visual UI at runtime.

Preferred next direction:
Do not keep sending arbitrary browser HTML as the long-term format. Save only HyperEdit-owned operations or artifacts, then let the server reconcile those with the source document. This reduces extension leakage, layout drift, and accidental persistence of runtime UI.
