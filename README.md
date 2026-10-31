# Agent Control Room

A mobile-friendly, fully fictional scripted investigation. All numbers, documents, events and agent responses are invented for this demo. No real run data or internal organizational material is included.

Open the GitHub Pages site. Playback starts automatically at Medium: 10 seconds
between steps. Choose Slow (16 seconds), Medium (10 seconds), or Fast (5 seconds).
Every step uses the selected interval. Pause, inspect an avatar, or open Investigation details
to explore the recorded evidence and outcomes.

The Enterprise tab is a separate, fully fictional vision simulation. Each
business-unit swarm has a before/after chart, a dbt project boundary, active
source visuals and an Analyst/Skeptic review loop. Local findings collapse
into shared model inputs for the enterprise swarm above. The final learning
has an explicit simulated review/certification step. This is not a live dbt
Mesh deployment or native dbt agent-hosting service.

## Continue editing in Claude Code

Clone this repository and edit the files directly. No install or build step:

- `index.html`: page shell, tabs and shared playback controls
- `styles.css`: responsive appearance and avatars
- `model.mjs`: event projection, role definitions and reading time
- `app.js`: UI, graph animation, details and automatic playback
- `enterprise.mjs`: the Enterprise tab and its independent playback
- `enterprise-data.mjs`: fictional units, sources, stages and charts
- `enterprise.css`: project boundaries and progressive-focus styling
- `demo.json`: the selected recorded sandbox investigation

Preview with `python3 -m http.server 8000`, then open http://localhost:8000.
GitHub Pages publishes the root of the main branch; push updates to republish.

The demo contains fictional sample values, scripted agent responses and invented
source excerpts. Internal source links, trace connections and local filesystem
metadata are omitted. Original event timestamps are preserved; playback uses
a slower presentation clock. This viewer does not invoke agents or apply changes.
