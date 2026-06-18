---
name: oma-workshop
description: >
  Build, extend, and maintain the Operational Model for Ansible (OMA) Workshop Tool —
  an interactive benchmarking and facilitation tool hosted at
  ansible-ops-model.github.io/oma-workshop. Use this skill whenever the user
  asks to add or remove topics, edit guidance text, change styles, add a feature,
  fix a bug, restructure the files, work on the YAML data split, add comments to
  leaves, implement collaboration, or do anything else to the OMA workshop tool
  or its GitHub repository at github.com/ansible-ops-model/oma-workshop.
  Also use it when the user asks about the OMA model structure, the topic tree,
  the facilitator guide, or the relationship between the workshop tool and the
  Hugo documentation site at ansible-ops-model.gitlab.io.
---

# OMA Workshop Tool Skill

## Project overview

| Item | Value |
|---|---|
| Tool name | Operational Model for Ansible (OMA) Workshop Tool |
| Short name | OMA |
| Version | v3.0.0 |
| Live URL | https://ansible-ops-model.github.io/oma-workshop/ |
| GitHub repo | github.com/ansible-ops-model/oma-workshop |
| Model docs | ansible-ops-model.gitlab.io (Hugo, GitLab Pages — separate repo) |
| Hosting | GitHub Pages via GitHub Actions |
| Current state | Single self-contained `index.html` (~156KB) |
| Target state | Multi-file: `data/topics.yaml`, `data/guide.yaml`, split JS/CSS |
| Language | Vanilla JS (ES modules), D3.js v7, js-yaml, Red Hat Design System fonts |
| Local run | `python3 -m http.server 8080` then `localhost:8080` |

---

## Repository structure (current)

```
oma-workshop/
├── index.html          ← entire application (CSS + JS + data all inline)
├── logo.png            ← OMA logo — shown in header (small) and landing page (large, base64 embedded)
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE             ← Apache 2.0
└── .github/
    ├── workflows/
    │   └── deploy.yml  ← GitHub Actions → GitHub Pages (no build step)
    └── ISSUE_TEMPLATE/
        ├── topic-proposal.md
        └── bug-report.md
```

## Repository structure (target — multi-file)

```
oma-workshop/
├── index.html          ← shell: loads assets, bootstraps app
├── data/
│   ├── topics.yaml     ← full tree: pillars, groups, topics, levels
│   └── guide.yaml      ← descriptions + 3 prompts per topic key
├── js/
│   ├── data.js         ← YAML fetch/parse → exports BASE_DATA, GUIDE
│   ├── store.js        ← state: ANN, comments, customNodes, versions, priorityOrder
│   ├── tree.js         ← D3 rendering, draw(), toggle(), search highlights
│   ├── ui.js           ← panels, modals, toolbar, landing page, tooltip
│   └── collab.js       ← collaboration layer (Firebase or Yjs+WebRTC)
├── css/
│   └── style.css       ← all styles extracted from <style> block
├── logo.png
├── start.sh            ← python3 -m http.server 8080
├── start.bat           ← Windows equivalent
└── README.md
```

**Important:** `fetch()` is blocked on `file://` URLs. The multi-file version requires a local HTTP server. Document this clearly and provide `start.sh`.

---

## Design tokens (Red Hat Design System)

All colours are CSS custom properties in `:root`. When editing styles, always use these variables — never hardcode hex values.

```css
--rh-red: #EE0000          /* primary brand red — pillar nodes, CTAs */
--rh-red-dark: #C00000     /* hover state for red elements */
--rh-black: #151515        /* near-black — root nodes, header, body text */
--rh-dark: #212427
--rh-gray-dark: #3C3F42    /* group nodes */
--rh-gray-mid: #6A6E73     /* secondary text, labels */
--rh-gray-light: #8A8D90   /* tertiary text, metadata */
--rh-gray-100: #F5F5F5     /* page background */
--rh-gray-200: #D2D2D2     /* borders */
--rh-gray-300: #B8BBBE
--rh-white: #FFFFFF
--rh-blue: #0066CC         /* interactive, links */
--rh-blue-dark: #004080
--rh-blue-light: #BEE1F4   /* 2.0 node fill */
--rh-gold: #F0AB00         /* MVP stroke/warning */
--rh-gold-light: #F9E0A2   /* MVP node fill */
--rh-green: #3E8635        /* success / "Have this" */
--rh-green-light: #BDE5B8  /* "Have this" node fill */
```

Typography: `Red Hat Display` (headings, panel titles, modal h2) and `Red Hat Text` (all body copy, buttons, labels). Both loaded from Google Fonts. Border radius: `3px` throughout (`--rh-radius`).

---

## Node colour palette (PAL constant)

Each entry: `f` = fill, `s` = stroke, `t` = text colour.

```js
const PAL = {
  root:     { f:'#151515', s:'#151515', t:'#FFFFFF' },  // near-black
  pillar:   { f:'#EE0000', s:'#C00000', t:'#FFFFFF' },  // brand red
  group:    { f:'#3C3F42', s:'#212427', t:'#FFFFFF' },  // dark charcoal
  mvp:      { f:'#F9E0A2', s:'#F0AB00', t:'#795600' },  // PatternFly gold
  '2.0':    { f:'#BEE1F4', s:'#0066CC', t:'#004080' },  // PatternFly blue
  advanced: { f:'#F4C5BE', s:'#C9190B', t:'#7D1007' },  // PatternFly red
  done:     { f:'#BDE5B8', s:'#3E8635', t:'#1E4F18' },  // success green
  planned:  { f:'#FCF7E0', s:'#F0AB00', t:'#795600' },  // warning amber
  custom:   { f:'#E8DAFF', s:'#6753AC', t:'#2A185A' }   // purple (user-added)
};
```

---

## Data structures

### BASE_DATA — topic tree

Nested JS object. Pillar → Group (optional) → Topic leaves.

```js
{
  name: 'Pillar name',
  type: 'pillar',           // 'root' | 'pillar' | 'group' | undefined (leaf)
  children: [
    {
      name: 'Group name',
      type: 'group',
      children: [
        { name: 'Topic name', level: 'mvp' }  // level: 'mvp' | '2.0' | 'advanced'
      ]
    },
    { name: 'Direct topic', level: '2.0' }   // direct child of pillar (no group)
  ]
}
```

Five pillars: **People**, **Process**, **Technology**, **Governance**, **Strategy**.
14 groups total. ~67 leaf topics.

### GUIDE — hover guidance

Object keyed by exact topic `name` string (case-sensitive, must match BASE_DATA exactly).

```js
const GUIDE = {
  'Topic name': {
    desc: 'One or two sentence description.',
    prompts: [
      'First discussion question?',
      'Second question — often about current state?',
      'Third question — about what good looks like?'
    ]
  }
}
```

Convention: 3 prompts per topic. If a topic has no GUIDE entry, hovering shows no tooltip — acceptable, add as time allows.

### State variables

```js
let ANN = {};            // nodePath → annotation string ('done'|'planned'|'mvp'|'2.0'|'advanced')
let customNodes = [];    // [{name, pillar, group, level, desc}] — user-added topics
let versions = [];       // [{id, label, timestamp, ann, custom, priorityOrder}] — named snapshots, max 20
let priorityOrder = [];  // array of nodePaths in user drag order
let MODE = 'nav';        // current annotation mode
```

All state persists to `localStorage` under key `aap_model_state`. JSON export includes all five.

**Planned additions (not yet built):**
```js
let COMMENTS = {};       // nodePath → string — per-leaf comment text
let removedNodes = [];   // nodePaths of built-in nodes hidden by user
let renamedNodes = {};   // nodePath → new name string
```

### nodePath helper

Unique stable key for any node — used as ANN key, COMMENTS key, etc.

```js
function nodePath(d) {
  return d.ancestors().reverse().map(a => a.data.name.replace(/\n/g, '')).join('|');
}
// e.g. "Ansible Automation Platform|Technology|Developer experience|Git"
```

---

## Feature map

| Feature | Where in code | Notes |
|---|---|---|
| Landing page | `#landing` div + `.landing*` CSS + `buildLandingCards()`, `dismissLanding()` | Detects localStorage session; shows Resume/New/Load cards |
| Tree rendering | `draw()` function | Clears and redraws on every state change; D3 tree layout |
| Annotation modes | `setMode()`, `handleClick()` | 7 modes: nav, done, planned, mvp, 2.0, advanced, clear |
| Hover tooltip | `showTooltip()`, `positionTooltip()`, `hideTooltip()` | 220ms delay; positions within viewport |
| Search | `onSearch()`, `highlightSearch()` | Expands all, outlines matches in red |
| Version history | `saveNamedVersion()`, `buildHistoryPanel()`, `diffVersions()`, `restoreVersion()` | Downloads JSON on save |
| Priority panel | `buildPriorityPanel()`, drag events | Groups by maturity level; drag reorder |
| Summary table | `buildSummaryTable()`, `getSummaryRows()` | Full flat list with filters |
| Add custom topic | `openAddModal()`, `addTopic()` | Custom nodes: dashed border + purple + ★ |
| Session import | `handleFileDrop()`, `importJSON()` | Handles snapshot files and full session exports |
| Exports | `exportCSV()`, `exportJSON()`, `copyText()` | CSV, JSON, clipboard text |
| Keyboard shortcuts | `keydown` listener | Esc=navigate, 1/2/3=view depth |
| Mode indicator | `updateModeIndicator()` | Persistent badge below toolbar |
| Auto-save | `saveState()` → localStorage | Every annotation change |

---

## Common editing tasks

### Add a topic to the tree

Find the correct pillar/group in `BASE_DATA` and add:
```js
{ name: 'New topic name', level: 'mvp' }  // level: 'mvp' | '2.0' | 'advanced'
```
Then add a matching entry in `GUIDE` (key must match name exactly).

### Add a group

```js
{ name: 'New group', type: 'group', children: [
  { name: 'Topic A', level: 'mvp' },
  { name: 'Topic B', level: '2.0' }
]}
```
Also add the group name to `PILLAR_GROUPS[pillarName]` so it appears in the Add topic modal dropdown.

### Rename a topic

Change `name` in `BASE_DATA` AND update the key in `GUIDE`. If the topic has ANN entries in stored sessions, those will break (nodePath changes) — acceptable for built-in topics; document in CHANGELOG.

### Add guidance to a topic

Add a key to `GUIDE` matching the topic name exactly. Three prompts is the convention.

### Change a node colour

Edit the `PAL` constant. Each entry: `f`=fill, `s`=stroke, `t`=text.

### Change a UI colour

Edit the CSS custom property in `:root` near the top of the `<style>` block.

### Change the version number

Update the badge in the `<header>`:
```html
<span class="rh-header-tag">v3.0.0</span>
```
And update `CHANGELOG.md`.

### Change the logo

The landing page logo is embedded as a base64 data URI (the OMA PNG). To update it: base64-encode the new PNG and replace the `src` value of `<img class="landing-logo">`. The header logo references `logo.png` (external file).

---

## Planned features (not yet built)

### 1. YAML data split

Extract `BASE_DATA` → `data/topics.yaml` and `GUIDE` → `data/guide.yaml`.
Load via `fetch()` + `js-yaml` library (CDN).
Requires local HTTP server for offline use — document in README, provide `start.sh`.

`topics.yaml` shape:
```yaml
pillars:
  - name: People
    children:
      - name: Community of practice
        type: group
        level: "2.0"
        children:
          - name: Core team
            level: "2.0"
```

`guide.yaml` shape:
```yaml
"Incident management":
  desc: "A standard process for managing technical incidents."
  prompts:
    - "Who is the first person called when AAP has a problem at 2am?"
    - "Walk me through the last significant incident."
    - "If a new engineer joined tomorrow, how would they know what to do?"
```

### 2. Comments on leaf nodes

New state: `COMMENTS = {}` (nodePath → string).
New annotation mode: `comment` — clicking a leaf opens an inline textarea.
Comment icon appears on leaves with text. Visible in tooltip and summary table.
Persists to localStorage and JSON exports.

### 3. Real-time add / rename / remove nodes

Three new state arrays:
- `customNodes` — already exists (user-added topics)
- `removedNodes` — nodePaths of built-in nodes hidden in this session
- `renamedNodes` — nodePath → new display name

Tree build function checks all three before rendering.
`⋯` button on hover for each node opens a context menu: Rename / Add child / Remove.
Permanent changes submitted via GitHub issue (pre-filled URL from the tool).

### 4. Collaboration

Two viable approaches — choose one before building `collab.js`:

**Option A: Firebase Realtime Database**
- Free tier sufficient
- User clicks "Collaborate" → tool pushes state to Firebase → gets 6-char room code
- Second user enters code → both see annotations update in real time
- `collab.js` uses Firebase SDK (loaded from CDN, no npm)
- Requires a Firebase project config object added to repo

**Option B: Yjs + y-webrtc (preferred for open source)**
- True P2P, no data leaves the browsers, no third-party account needed
- Both users must be online simultaneously
- Uses free public STUN servers for WebRTC NAT traversal
- `collab.js` uses `yjs` + `y-webrtc` from CDN
- More complex to implement, better long-term for an open source project with no infrastructure budget

**Current workaround (already works):** Each person saves a snapshot → shares JSON → facilitator uses diff view to compare and reconcile.

---

## GitHub Pages deployment

The deploy workflow (`.github/workflows/deploy.yml`) triggers on every push to `main`. No build step — the repo root is served as-is. Deployment takes ~30 seconds.

The tool is live at: `https://ansible-ops-model.github.io/oma-workshop/`

`localStorage` is scoped to `ansible-ops-model.github.io` — sessions persist across visits for the same user in the same browser.

Custom domain: add a `CNAME` file to repo root containing the domain, point DNS CNAME at `ansible-ops-model.github.io`. No HTML changes needed.

---

## Architecture decisions

**Why a single HTML file (current state)?**
Contributors are Ansible practitioners, not web developers. Zero-install, no build step, works from a USB stick. Facilitators need it to work reliably in rooms with unreliable internet.

**Why move to multi-file?**
Topic data (`BASE_DATA`) and guidance (`GUIDE`) are the parts most contributors want to edit. Keeping them in a JavaScript constant inside an HTML file is a barrier. YAML files are readable and editable by anyone. The JS and CSS can also be reviewed and contributed to in isolation.

**Why not React/Vue/etc?**
No build pipeline needed for contributors. Vanilla JS with ES modules covers the use case cleanly. D3 is the only substantial dependency and is loaded from CDN.

**Why Red Hat branding?**
Built by the Red Hat EMEA Ansible Launch Team. Branding is swappable via CSS custom properties and logo file replacement — the tool is model-agnostic.

---

## Relationship to the Hugo documentation site

The OMA model documentation lives at `ansible-ops-model.gitlab.io` (Hugo, GitLab Pages, separate repository). The workshop tool is a companion application, not part of the Hugo site.

- The Hugo site explains the model (what each topic means, why it matters)
- The workshop tool is the interactive benchmarking instrument
- They link to each other but are maintained independently
- Changes to model content (what topics exist) should be proposed to the GitLab repo first, then reflected in `data/topics.yaml` (future) or `BASE_DATA` (current)
- Hugo integration is possible via Option B in the assessment (`data/topics.yaml` as shared source of truth, injected at build time) but is not the current approach
