# Operational Model for Ansible — Workshop Tool

An interactive benchmarking and facilitation tool for the [Operational Model for Ansible (OMA)](https://ansible-ops-model.gitlab.io/), built by the Red Hat EMEA Ansible Launch Team.

The OMA model describes good practice for running a central automation platform based on Ansible Automation Platform — covering People, Process, Technology, Governance, and Strategy across three maturity levels: MVP, 2.0, and Advanced.

This tool lets you and your team visually map where you are today against the model, annotate your progress, prioritise what to tackle next, and export the results.

**→ [Open the Workshop Tool](https://ansible-ops-model.github.io/oma-workshop/)**
**→ [Read the full model](https://ansible-ops-model.gitlab.io/)**

---

## What it does

- **Interactive tree** — browse all 67 model topics across 5 pillars and 14 groups, collapsed or expanded by pillar, group, or all at once
- **Workshop annotation** — mark topics as "Have this", "Planned", or reclassify their maturity level during a session
- **Hover guidance** — every leaf node includes a description and 3 discussion prompts drawn from the facilitator guide
- **Session persistence** — auto-saves to browser storage; named snapshots download as JSON files for sharing between sessions
- **Version history** — save named snapshots, compare diffs between sessions, restore any previous state
- **Priority ordering** — drag and reorder annotated items to build a prioritised roadmap; export as CSV
- **Custom topics** — add organisation-specific topics that aren't in the base model
- **Search** — find any topic instantly across the full tree
- **Exports** — CSV, JSON, plain text, priority list, and print view

---

## Getting started

### Running locally (Offline)

The tool is a single HTML file with no build step required.

1. Download `index.html` from this repository
2. Open `index.html` in any modern browser

That's it. No server, no dependencies, no installation.

### Running a workshop

1. Open the tool in a browser (locally or at the hosted URL)
2. Share your screen or use a display — the tool is designed for facilitated group sessions
3. Use the **View** buttons to set depth (Pillars → Groups → All topics)
4. Hover over any leaf node to see its description and discussion prompts
5. Select an annotation mode (Have this / Planned) and click nodes to mark current state
6. When done, use **↓ Save snapshot** to download a named JSON file
7. In a follow-up session, drag the JSON file onto the page to restore where you left off

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Return to Navigate mode |
| `1` | Switch to Pillars view |
| `2` | Switch to Groups view |
| `3` | Switch to All topics view |

---

## Repository structure

```
oma-workshop/
├── index.html          ← The complete tool (single self-contained file)
├── logo.svg            ← Your logo — replace this file to rebrand
├── README.md           ← This file
├── CHANGELOG.md        ← Full change history
├── CONTRIBUTING.md     ← How to contribute
├── LICENSE             ← Apache 2.0
└── .github/
    ├── workflows/
    │   └── deploy.yml  ← GitHub Actions → GitHub Pages deployment
    └── ISSUE_TEMPLATE/
        ├── topic-proposal.md
        ├── topic-amendment.md
        └── bug-report.md
```

---

## How to edit the tool

The tool is intentionally a single HTML file so that contributors do not need a build pipeline. Everything lives in `index.html`. Here is what does what.

### Changing the logo

When needed, replace `logo.svg` in the repo root with your own file. Supported formats: SVG (recommended) or PNG.

- Height is constrained to `32px`; width scales automatically up to `140px`
- If the file is missing, `OMA` appears as a text fallback in the header
- To change the filename, edit the `src` attribute of the `<img class="rh-hat">` element in `index.html`

### Changing the tool title

Find this line in `index.html` and edit the text:

```html
<span class="rh-title">Operational Model for Ansible</span>
```

### Changing the version number

Find and update this tag in the header:

```html
<span class="rh-header-tag">v3.0.0</span>
```

### Adding or editing a topic in the tree

Topics live in the `BASE_DATA` constant in the `<script>` block near the bottom of `index.html`. Search for `const BASE_DATA` to find it.

The tree is structured as nested objects. Each node has:

```js
{
  name: 'Topic name',      // displayed in the tree
  level: 'mvp',            // 'mvp', '2.0', or 'advanced'
  type: 'group',           // optional — only set for groups: type:'group'
  children: [...]          // optional — child nodes
}
```

**To add a new topic**, find the correct pillar and group and add a new object to the `children` array:

```js
{ name: 'My new topic', level: 'mvp' }
```

**To add a new group**, add an object with `type: 'group'` and a `children` array:

```js
{
  name: 'My new group',
  type: 'group',
  children: [
    { name: 'First topic', level: 'mvp' },
    { name: 'Second topic', level: '2.0' }
  ]
}
```

**To rename a topic**, find its `name` property and change the string. If the topic also has guidance (description + prompts), update the matching key in the `GUIDE` object — the keys must match exactly.

### Adding hover guidance to a topic

Guidance lives in the `GUIDE` constant, directly above `BASE_DATA`. The key is the topic name (must match exactly, including capitalisation).

```js
'My new topic': {
  desc: 'A one or two sentence description of what this topic is and why it matters.',
  prompts: [
    'First discussion question to ask the group?',
    'Second question — often about current state or a specific incident?',
    'Third question — about what good would look like?'
  ]
},
```

Three prompts per topic is the convention. If a topic has no entry in `GUIDE`, hovering over it shows no tooltip — this is fine; add guidance as time allows.

### Changing the GUIDE groups available when adding a custom topic

The dropdown in the "Add topic" modal is driven by `PILLAR_GROUPS` near the top of the script block:

```js
const PILLAR_GROUPS = {
  People:     ['Community of practice'],
  Process:    ['Platform operations', 'Onboarding', 'Development process'],
  Technology: ['Platform infrastructure', 'Developer experience', 'Configuration standards', 'Enablement'],
  Governance: ['Brand'],
  Strategy:   []
};
```

Add or rename entries here to match any structural changes to `BASE_DATA`.

### Changing colours and theme

All colours are defined as CSS custom properties (variables) at the top of the `<style>` block:

```css
:root {
  --rh-red: #EE0000;
  --rh-black: #151515;
  --rh-blue: #0066CC;
  /* ... */
}
```

Node colours for the tree are in the `PAL` constant in the script block:

```js
const PAL = {
  root:     { f:'#151515', s:'#151515', t:'#FFFFFF' },  // f=fill, s=stroke, t=text
  pillar:   { f:'#EE0000', s:'#C00000', t:'#FFFFFF' },
  mvp:      { f:'#F9E0A2', s:'#F0AB00', t:'#795600' },
  '2.0':    { f:'#BEE1F4', s:'#0066CC', t:'#004080' },
  advanced: { f:'#F4C5BE', s:'#C9190B', t:'#7D1007' },
  done:     { f:'#BDE5B8', s:'#3E8635', t:'#1E4F18' },
  planned:  { f:'#FCF7E0', s:'#F0AB00', t:'#795600' },
};
```

### Changing the version displayed in the header

Update the badge in the `<header>` element and update `CHANGELOG.md` to describe what changed.

---

## Deploying to GitHub Pages

The repository includes a GitHub Actions workflow that deploys automatically on every push to `main`.

1. Go to your repository **Settings → Pages**
2. Under **Source**, select **GitHub Actions**
3. Push any change to `main` — the workflow deploys within about 30 seconds
4. The tool is live at `https://<org>.github.io/<repo>/`

The workflow file is at `.github/workflows/deploy.yml`. It requires no secrets or configuration — it simply uploads the repo root as a static site.

---

## Contributing

Contributions are welcome. The most useful contributions are:

- **Adding or improving guidance** — descriptions and discussion prompts for topics that don't have them yet, or improving existing ones
- **Proposing new topics** — use the [topic proposal issue template](.github/ISSUE_TEMPLATE/topic-proposal.md)
- **Reporting bugs** — use the [bug report template](.github/ISSUE_TEMPLATE/bug-report.md)
- **Suggesting structural changes** — open an issue before making large structural changes so the approach can be discussed first

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

The underlying model is maintained at [ansible-ops-model.gitlab.io](https://ansible-ops-model.gitlab.io/). If you want to propose changes to the model content itself (rather than the tool), contribute there.

---

## Design decisions

**Why a single HTML file?**
Contributors to this project are primarily Ansible practitioners and Red Hat consultants, not web developers. A single file with no build step means anyone can open a pull request without needing Node, npm, or any toolchain. The file can also be downloaded and used completely offline, which matters in workshop contexts where internet access is unreliable.

**Why is topic data embedded in JavaScript rather than a separate JSON file?**
For the same reason — a separate JSON file would require a local server to load (browser same-origin policy blocks `fetch()` for local files). Embedding it in the script makes the file self-contained. Future versions hosted on GitHub Pages could separate the data into `data/topics.json` and `data/guide.json` since they would always be served over HTTP.

**Why Red Hat branding?**
This tool was built by the Red Hat EMEA Ansible Launch Team and uses the Red Hat / PatternFly design system. The branding can be changed by swapping `logo.svg` and updating the CSS variables — the tool itself is model-agnostic.

---

## Licence

Apache 2.0. See [LICENSE](LICENSE).

---

## Authors

- Model: [Alessandro Grassi](https://www.linkedin.com/in/alessandrograssi/), [Alexandra Cretu](https://www.linkedin.com/in/acrt/), [Amaya Rosa Gil Pippino](https://www.linkedin.com/in/amayagil/), [Logan Brooks](https://www.linkedin.com/in/loganacbrooks/), [Magnus Glantz](https://www.linkedin.com/in/magnus-glantz/), [Farzaneh Sadeghi](https://www.linkedin.com/in/fazifs/), [Christian Jung](https://www.linkedin.com/in/cjungcloud/) — Red Hat EMEA Ansible Launch Team
- Workshop tool: built on the OMA model, themed with the [Red Hat Design System](https://ux.redhat.com/)

Original model documentation & guidance: [ansible-ops-model.gitlab.io](https://ansible-ops-model.gitlab.io/)
