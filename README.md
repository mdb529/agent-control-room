# Agent Control Room

A mobile-friendly, fully fictional scripted investigation. All numbers, documents, events and agent responses are invented for this demo. No real run data or internal organizational material is included.

Open the GitHub Pages site. Playback starts automatically at Medium: 10 seconds
between steps. Choose Slow (16 seconds), Medium (10 seconds), or Fast (5 seconds).
Every step uses the selected interval. Pause, inspect an avatar, or open Investigation details
to explore the recorded evidence and outcomes.

## Continue editing in Claude Code

Clone this repository and edit the files directly. No install or build step:

- `index.html`: page shell, tabs and shared playback controls
- `styles.css`: responsive appearance and avatars
- `model.mjs`: event projection, role definitions and reading time
- `app.js`: UI, graph animation, details and automatic playback
- `demo.json`: the selected recorded sandbox investigation

Preview with `python3 -m http.server 8000`, then open http://localhost:8000.
GitHub Pages publishes the root of the main branch; push updates to republish.

The demo contains fictional sample values, scripted agent responses and invented
source excerpts. Internal source links, trace connections and local filesystem
metadata are omitted. Original event timestamps are preserved; playback uses
a slower presentation clock. This viewer does not invoke agents or apply changes.
