# Changelog

All notable changes to the OMA Workshop Tool are documented here. This file is aimed at anyone who clones or forks this repository and needs to understand what changed and why — not just what.

## v4.0.0 (unreleased, branch `v4.0.0`)

### ⚠ Breaking change: the tool now requires a local server

Topic data (the tree structure and all hover tooltips) used to live inline inside `index.html`, in two JavaScript constants (`BASE_DATA` and `GUIDE`). It has been moved into a separate file, **`data.yaml`**, which `index.html` now loads at runtime via `fetch()`.

**What this means for you:** double-clicking `index.html` and opening it as a `file://` URL no longer works in most browsers (Chrome and other Chromium browsers block `fetch()` of local files for security reasons). You must serve the folder over HTTP. From the repo root:

```bash
python3 -m http.server 8765
# then open http://localhost:8765/index.html
```

GitHub Pages deployments are unaffected — they're always served over HTTP, so `fetch('data.yaml')` works there with no changes needed.

**Why we did this anyway:** `data.yaml` is dramatically easier to read and edit than a deeply nested JavaScript object literal — this matters a lot for non-developer contributors (consultants, facilitators) who want to add or tweak topics without touching code. The previous design deliberately avoided this tradeoff to preserve fully offline, no-server use (see the "Design decisions" section of `README.md`); v4.0.0 accepts that tradeoff in favour of editability. If you need guaranteed offline single-file use (e.g. a venue with no reliable Wi-Fi and no way to run a local server), stay on v3.0.0 or inline the YAML content back into the script block yourself.

### Added

- **"Risk" mode** (⚠) — flags a topic as a known risk area, alongside the existing "Have this" and "Planned" modes.
- **"Not Considered" mode** (`?`) — marks a topic the customer has genuinely never thought about before. This is distinct from "Not Relevant": one is a real gap worth surfacing, the other doesn't apply to their context at all. Together with Have this / Planned / Risk, every topic in a workshop should end up tagged with exactly one of these five states — a blank topic by the end of a session means it simply hasn't been discussed yet, not that it's been judged irrelevant.
- **Workshop progress bar** — a prominent, colour-segmented bar (replacing a small corner badge) showing what fraction of all topics have been tagged, broken down by tag type, with a per-pillar mini-breakdown (People / Process / Technology) underneath so a facilitator can see at a glance which part of the model still needs attention.
- **Duplicate-topic notices** — some topics intentionally appear more than once in the model (e.g. "Capacity management" appears under both Process, asking about team/lead-time/change-process, and Technology, asking about the platform's own monitoring capability). Hovering either instance now shows a note pointing to the other location, so it doesn't get missed during tagging. This is computed automatically from the tree — any future duplicate topic name gets flagged the same way.
- **Group-level tooltips** — all 14 groups (e.g. "Platform operations", "Configuration standards") now have a one-line orientation description on hover, not just individual topics.
- **Onboarding breakdown** — the "Onboarding" group (Process) is now broken into four sub-groups (Basic onboarding, Streamlined onboarding, Training assessment, Skills-based onboarding), each containing specific concrete topics (e.g. "LDAP group creation", "Self-service LDAP/group provisioning", "Mentorship pairing") with their own tooltips and discussion prompts.
- **Smarter search** — search now only expands the branch(es) containing a match, instead of expanding the entire tree. Makes search usable on a tree this size.

### Changed

- **Pillars reduced from 5 to 3.** The model previously had People, Process, Technology, Governance, and Strategy as top-level pillars. Governance and Strategy have been folded into the other three:
  - SLA, OLA, Feature planning, Success plan, KPIs, Performance monitoring, and Key processes are now a "Governance" group under **Process**.
  - Budget & ownership and Skills development are now direct topics under **People**.
  - The "Brand" group (Name, Logo, Merchandise) is now under **People**.
  - Tools strategy is now a direct topic under **Technology**.
- **"N/A" renamed to "Not Relevant"** for clarity — the abbreviation wasn't self-explanatory to first-time facilitators.
- Header version badge bumped from `v3.0.0` to `v4.0.0`.

### Removed

- **The "Continue a previous session" drop-zone box.** It duplicated the toolbar's "↑ Import JSON" button and took up a large amount of vertical space on every load. Drag-and-drop of a snapshot/session JSON file anywhere on the page still works (via the full-page overlay shown while dragging) — only the large persistent box and its dedicated drop target were removed.

### Notes on data and persistence (unchanged, but worth restating)

- Annotations, custom topics, and version history are stored only in the browser's `localStorage`, scoped to that browser on that machine. Nothing is shared between users or persisted to the repository — see "Custom topics" below.
- Topics added via "+ Add topic" during a session are **not** written to `data.yaml`. They exist only in that browser's local storage and in any session/snapshot JSON you explicitly export. To add a topic permanently for everyone, edit `data.yaml` directly and ship it in a release.

---

## v3.0.0 and earlier

Baseline release: single self-contained `index.html` with topic data (`BASE_DATA`, `GUIDE`) embedded directly in the script, 5 pillars (People, Process, Technology, Governance, Strategy), and two annotation modes ("Have this" and "Planned"). No `data.yaml`, no local server required — true double-click-to-open offline use.
