# PlugBox: plugin adapter and management tool

[中文](README.md) | **English**

**PlugBox is a plugin adapter and management tool.** It works with any engine-layer or agent-layer tool that supports custom plugins: browse, install, update, enable and disable plugins in one panel, while every host-specific difference stays inside an adapter. It is no longer tied to a single engine — the core only answers the question "what is a plugin".

It currently ships as a DeepSeek Harness plugin (bundle) and publishes a plugin index that any DSH instance can subscribe to.

| Item | Value |
|---|---|
| Product name | **PlugBox** (plugin adapter and management tool) |
| npm package name | `plugbox` |
| Bundle patch id / name | `plugbox` |
| Sidebar module id | `plugbox` |
| Locale namespace | `plugBox` |
| Icon | `icons/plugbox.svg` |
| Host mount prefix | `/plugbox` |
| RPC endpoint | `/plugbox/api/rpc` |
| GitHub repository | <https://github.com/Wcof/PlugBox> |
| Landing page | <https://wcof.github.io/PlugBox/> |
| License | MIT |

Shortest install path: add `https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json` under DeepSeek Harness → Discover → Index sources, search for `plugbox`, install, restart the window. Or run `dsh plugin --profile web add github:Wcof/PlugBox`.

If you are looking for "where do I install plugins for engine X" or "is there one marketplace to manage them all", this is that layer. The plugin list comes from the host's real `pluginManager` / `pluginMarket` services — there is no second copy of the data.

---

## Why it is layered

The real difference between plugin ecosystems is not whether a plugin installs, but how each host describes itself: what its manifest fields are called, how a plugin registers UI, what its RPC methods are named, and which structure a plugin's capabilities collapse into. Put that in one codebase and the second host turns into `if` statements everywhere.

PlugBox is therefore split in two.

### Core layer `src/core/` (host-agnostic)

One plugin protocol, manifest parsing and generation, registration and discovery, lifecycle management, and the abstraction for plugin resources.

| Location | Responsibility |
|---|---|
| `protocol/plugin.ts` | The host-neutral plugin protocol: `CanonicalPlugin`, `PluginVersion`, `Requirements`, `ResourceKind`, `PluginResource`, `Provenance` |
| `protocol/catalog.ts` | Catalog entry shape and provenance rules; markers are declared by adapters, the core only evaluates them |
| `protocol/version.ts` | Version comparison |
| `protocol/brand.ts` | The product's own identity constants (brand name, package name, markers, index file names) |
| `manifest/index.ts` | Two-way manifest conversion: `readManifest` / `toCanonical` / `writeManifest` / `toInstallSpec` |
| `resources/index.ts` | Unified abstraction for plugin resources (models / tools / config / files / UI slots) |

The core deliberately does not know any host's field names. Requirements are always namespaced as `requirements['<host-id>/<requirement-name>']`, e.g. `'dsh/dsh'`, and where a resource lands in the host is decided by the adapter.

### Adapter layer `src/adapters/` (one adapter per target host)

In one sentence: **the adapter answers "how does this host talk"; the core answers "what is a plugin".**

`src/adapters/types.ts` defines the `HostAdapter` contract. Each adapter declares:

| Contract | Contents |
|---|---|
| `ui` | Mount prefix, RPC path, module id, locale namespace, claimed UI slots |
| `labels` | Display names for the three provenance badges (the vendor tier uses the host's own name, read from the adapter) |
| `catalog` | Index format, provenance policy, and the marker word this product uses in that host's index |
| `manifest` | Two-way conversion (`extract` / `compose` / `requirementKeyOf`), plus the optional `satisfies` range check and `pluginGate` admission check |
| `resources` | Canonical resource → host claim; returning `null` means this host cannot carry that kind of resource |
| `methods` | Canonical verb → the host's real call name |
| `installSpec` | Canonical description → host install argument |

**Adding a host means adding one directory that implements `HostAdapter` plus registering it — the core does not change.** Conversely, if a new host forces you to edit `src/core/`, the design is wrong.

### Host-specific terms: kept, and attributed

The following are **DeepSeek Harness's own protocol fields, file formats and commands**, supplied by the DSH adapter. They are what makes a plugin actually installable in DSH — **they are not product copy and must not be "neutralised"**:

`dsh.bundle` (bundle declaration) · `engines.dsh` (compatibility range) · `cordis.patch.yml` (bundle patch) · `dsh plugin add` (install command) · `pluginManager` / `pluginMarket` (host services)

The full contract lives in [docs/hosts/dsh-spec.md](docs/hosts/dsh-spec.md). It belongs to the DSH adapter, **not to the core**: another host means another contract document.

---

## Support matrix

| Host | Adapter id | Host protocol / commands | Verified | Notes |
|---|---|---|---|---|
| DeepSeek Harness (DSH) | `dsh` | `dsh.bundle` · `cordis.patch.yml` · `engines.dsh` · `dsh plugin add` | **Yes** (`0.2.1-rc.5`) | The first supported host and the only adapter currently exercised on a real host; contract in [docs/hosts/dsh-spec.md](docs/hosts/dsh-spec.md) |
| DeepSeek Harness by zcode | `zcode-dsh` | Same protocol family as DSH | **No** | Known host, not yet verified on a real environment. Differences in CLI entry point, profile layout and UI slots are still to be filled in; until then it must not be advertised as supported |

> Any host missing from this table is not integrated. **DSM Harness excluded: there is no adapter for it, and its existence must not be read as coverage.**
> Unverified adapters carry `verified: false` in the contract and are never selected by default; adapters with open questions also carry `openQuestions`.

---

## Install

PlugBox currently ships as a DeepSeek Harness bundle — `dsh.bundle.patch` in `package.json` is a DSH protocol field supplied by the DSH adapter. Pick one of three ways; on another host the install argument comes from that host's `HostAdapter.installSpec`.

### 1. From the plugin index (recommended)

1. Open the DeepSeek Harness **Discover** page and add this URL under *Index sources*:
   `https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json`
2. Search for `plugbox`, then install.
3. Restart the DSH window — host-side code is loaded at startup.

### 2. From GitHub

In the panel's **Install plugin** dialog, enter either:

- `github:Wcof/PlugBox`
- `git+https://github.com/Wcof/PlugBox#<commit-sha>` (pinned to a commit, useful for reproducing issues)

Or from the DSH CLI (`--profile` takes your profile name; desktop is usually `desktop`):

```bash
dsh plugin --profile web add github:Wcof/PlugBox
```

### 3. From a local directory (development)

Enter the absolute path of this repository in the same dialog, e.g. `/Users/you/code/PlugBox`. Run `npm run build` and commit `web/` after frontend changes — git installs do not run a build.

---

## Usage

### Plugin management

The top row shows origin counters; clicking a card filters the list. Each card shows title, package name, origin, runtime status and plugin-row count. **Details** opens the per-row enablement page.

### Plugin market

Entries are grouped by index source. Cards show provenance, status (installable, installed, update available, version mismatch) and the current version. The toolbar offers search, source chips, multi-select author facets and sort orders. Indexes longer than 100 entries are paged by `nextOffset`; when the page cap is hit, the list says so instead of silently truncating.

Provenance badges come from the active adapter (see below), so the *official* tier is worded per host — under DSH it reads "DSH official".

### Install from a branch

Click the version chip at the bottom-left of a card to open the repository's branches:

- each row shows the branch name, the version inside it, the host compatibility range it requires, and the branch's own title and description (branches can describe themselves differently);
- branches that do not declare the host's plugin field (`dsh.bundle` for DSH) cannot be installed;
- the currently installed branch is marked, and switching branches requires uninstalling first.

You are installing **the branch's current head commit**, which upstream can move at any time. For a fixed version, wait for a tagged release and use the normal install path.

The branch list is read by the host half with `git ls-remote --heads` (no GitHub API quota), falling back to the GitHub REST API only when git is unavailable.

### Update checks

The panel silently compares installed versions with the index on open and shows a banner when updates exist. **Check for updates** forces an index refresh.

---

## Provenance labels

| Badge | Meaning | How it is decided |
|---|---|---|
| **Host official** | Maintained or curated by the current host's vendor. The display name comes from the adapter (under DSH: "DSH official") | The adapter's declared `vendorLabels` match (for DSH: `official` in the entry's `metadata.labels`) |
| **PlugBox catalog** | Listed in this repository's index | Index entry has `plugbox` in `metadata.keywords` |
| **Third-party** | Comes from another subscribed index | Neither of the above |

`provenanceOf(entry, policy)` lives in the core while the `ProvenancePolicy` markers come from the adapter, so the core never learns a host's field names — adding a host that marks officials with `keywords.vendor` is an adapter-only change.

**"PlugBox catalog" is this project's curation, not an endorsement by any host vendor.** Inclusion criteria: the repository exists, it really is a plugin for the target host (under DSH: declares `dsh.bundle` and installs with `dsh plugin add`), version and license are verifiable from `package.json` / `LICENSE`, and the version corresponds to a release or a fixed commit. The index currently lists 11 plugins across six categories: reading, learning, productivity, UI, tools, models.

To suggest a plugin, open an issue with the repository URL, target version and license.

---

## Index sources and the two indexes

### The curated index `index.json`

A hand-picked catalog published with the repository in DSH's `format: 1`, subscribable by any DSH instance. Three entry points:

| Entry point | URL | Notes |
|---|---|---|
| GitHub Raw | `https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json` | Always current, recommended |
| jsDelivr | `https://cdn.jsdelivr.net/gh/Wcof/PlugBox@main/index.json` | CDN mirror, ~12 h cache |
| In-repository file | `index.json` at the repository root | Checked out with the repo, generated on build |

The index is generated from `src/data/catalog.ts` (the catalog) by `src/data/pluginIndex.ts` (the builder); `npm run build` writes the root `index.json` and validates it with the DSH ecosystem's official validator `@deepseek-ai/dsh-plugin-market-index`.

Every version carries `source: { type: "git", url, commit }`, and `engines.dsh` mirrors the `package.json` at that commit — leaving the field empty means "any DSH version", so it must not be filled in casually.

If jsDelivr lags, purge it:

```bash
curl https://purge.jsdelivr.net/gh/Wcof/PlugBox@main/index.json
```

### The community catalog `community.json`

The curated index only carries a dozen entries. The repository also publishes a **community catalog** synced from the third-party site [dsh-plugin.org](https://dsh-plugin.org), where every entry was verified at repository level: the repo is reachable, its `package.json` at that commit declares the plugin field the host requires, and the version comes from the package itself. Entries carry a `community` marker so they can be told apart from curated ones.

- `https://raw.githubusercontent.com/Wcof/PlugBox/main/community.json`

Subscribe from DSH's Discover → Index sources, or click **Community catalog** in the panel's market toolbar. With thousands of entries, search beats paging; the list renders in batches with a **Show more** button.

Being listed there means "this repository really is a plugin package for the target host" — not that its behaviour or compatibility was tested. The host still decides installability by `engines.dsh`.

---

## For plugin authors: manifests and resource mapping

The core converts manifests **through an intermediate view on purpose**: a host's plugin-eligibility field (DSH requires `dsh.bundle.patch` in `package.json`) is host-specific — pushing it into the canonical shape would pollute the core back, and dropping it entirely would make the plugin uninstallable on the target host.

```
host package.json ──adapter.manifest.extract──▶ intermediate ManifestView (host fields preserved verbatim in hostFields)
intermediate view ──toCanonical──▶ CanonicalPlugin (purely neutral description)
CanonicalPlugin + resources ──writeManifest──▶ target host's package.json fragment
```

Only three things matter if you author plugins:

1. **Write compatibility as a range, not as an enumeration of prereleases.** `>=0.2.1-rc.2 <0.3.0-0` covers the whole 0.2.1 series without touching it every rc; `0.2.1-rc.2 || 0.2.1-rc.3` breaks the day the next rc ships. Full walkthrough in [docs/article-engine-incompatible.md](docs/article-engine-incompatible.md).
2. **The compatibility field belongs to the host, and keys get namespaced.** The core stores `requirements['<host-id>/<requirement-name>']`, mapped by `requirementKeyOf` (DSH's `engines.dsh` → `dsh/dsh`) and stripped again on write-back. Do not expect raw host field names in the core.
3. **Declare resources by kind.** The unified kinds are `command` / `tool` / `skill` / `model` / `prompt` / `config` / `file` / `ui-slot` / `transport`. One resource collapses into different structures per host (a UI slot becomes `sidebar.panellist` + `main` in DSH); that mapping is `HostAdapter.resources.map`, and a resource the host cannot carry returns `null` rather than pretending to work.

---

## Compatibility and limits

- Verified against DeepSeek Harness `0.2.1-rc.5` (npm `latest`). After a host upgrade, run `npm run check:engines` to re-check the index.
- Compatibility is decided host-side: when `engines.dsh` exists it is the only criterion (peer dependencies are ignored), evaluated as `semver.satisfies(runtime, range, { includePrerelease: true })`. That rule belongs to the DSH ecosystem and is implemented by the DSH adapter's `satisfies`; if an adapter does not implement it, the core returns `unknown` instead of guessing.
- Branch installs show the declared range but cannot predict compatibility: the runtime version is not exposed to the page, and the decision happens at install time.
- One published version per plugin in the index. Other versions are reachable through branch installs or by bumping the index.
- No plugin configuration UI: the DSH remote surface exposes bundle/row enablement plus install and remove only. Configuration schemas live on the model side (`Config.listConfigs`).
- Unverified adapters are never selected as the default host adapter.

---

## FAQ

**How is this different from the host's built-in Discover page?**
Both read the same host services. Discover browses one index at a time; PlugBox merges sources and adds author facets, compatibility flags and branch installs.

**Which hosts does PlugBox support?**
See the support matrix above. Only DeepSeek Harness is currently verified on a real host; the DeepSeek Harness shipped by zcode is a known host but not yet verified. Adding a host means one adapter plus a little configuration — no core changes.

**Is "PlugBox catalog" the same as host official?**
No. It only means the plugin is listed in this repository's index. Host-official entries are decided by each host's own marker (for DSH, `official` in the entry's `labels`), and the two are shown as different badges.

**Why does a plugin say "version mismatch"?**
That version's declared compatibility range (`engines.dsh`) does not include your DSH version. The card shows the required range; upgrade DSH or wait for the plugin to widen it. See [docs/article-engine-incompatible.md](docs/article-engine-incompatible.md) for the full walkthrough.

**How is a branch install different from a normal install?**
A normal install uses the commit recorded in the index. A branch install uses the branch's current head commit, which moves with upstream pushes — meant for unreleased fixes.

**Why restart after installing?**
Host-side plugin code loads when DSH starts. Frontend assets can hot-update; host code cannot.

**The index is subscribed but nothing shows up?**
Check the URL in a browser (it should return JSON), then click **Check for updates** to refresh the cache. jsDelivr caches for ~12 hours; use the purge command above if needed.

**Do the old DeepSeekBox subscribe URLs still work?**
No. The repository has been renamed to **Wcof/PlugBox** and the old `Wcof/DeepSeekBox` index URLs are dead. Remove the old entries under *Index sources* and subscribe to `https://raw.githubusercontent.com/Wcof/PlugBox/main/index.json` (or its jsDelivr counterpart) instead; an already installed old copy can be replaced by installing again from the new URL using option 2.

---

## Development

```bash
npm install
npm run dev              # dev server at http://localhost:5180 with mocked host RPC
npm run build            # type check + build into web/, then postbuild (index sync and validations)
npm run preview          # preview the build output
npm run check:all        # bundle self-check + index validation + engines check + pinned index check
npm run validate:bundle  # bundle self-check only
npm run check:engines    # compare index compatibility ranges with upstream package.json
npm run check:pinned     # check the pinned index
npm run community:scan   # scan the community plugin source (pass --all for a full scan)
npm run community:build  # build the community catalog from the scan result
```

Stack: Vue 3 `<script setup>` + TypeScript + Vite, no UI library and no router, hand-written CSS. `web/` is the committed build artifact — DSH does not run a build when installing from git, and a missing `web/` returns 503.

### Layout

```
index.js              host half: /plugbox/ static route + /plugbox/api/rpc
client.js             client half: sidebar entry + iframe panel
cordis.patch.yml      bundle patch (DSH protocol) inserting the panel row
icons/plugbox.svg     icon shown in the host sidebar
locale/{zh,en}.json   panel copy (namespace plugBox)
src/core/             core layer: plugin protocol, manifest conversion, resources (host-agnostic)
src/adapters/         adapter layer: one HostAdapter per target host
src/services/         the single gateway to the host RPC
src/components/       panel UI
src/data/             catalog library and index builder
web/                  committed build output
scripts/              index and bundle validation, community sync, engines check, dev fake host
docs/                 landing page and host documentation
index.json            published curated index (generated on build)
community.json        published community catalog (generated on build)
```

### Data flow

The page only talks to `src/services/pluginService.ts`, which turns each action into a canonical verb (`status`, `listBundles`, `listPlugins`, `setBundleEnabled`, `setPluginEnabled`, `removeBundle`, `installBundle`, `listIndexes`, `setIndexes`, `searchMarket`, `repoBranches`) and posts `{ method, params }` to `/plugbox/api/rpc`. The host half maps those verbs through the active adapter's `methods` table and forwards them to DSH's `pluginManager` / `pluginMarket`. `repoBranches` is the only method not backed by a host service — it reads repository branches.

The endpoint accepts POST from the same origin only, with a 512 KiB body limit. Install and remove run pnpm and can take minutes.

---

## Related

- [AGENTS.md](AGENTS.md) — engineering structure, boundaries, red lines, verification steps
- [ROADMAP.md](ROADMAP.md) — current status and history
- [docs/hosts/dsh-spec.md](docs/hosts/dsh-spec.md) — DeepSeek Harness host contract (DSH adapter)
- [docs/article-engine-incompatible.md](docs/article-engine-incompatible.md) — long-form troubleshooting for "version mismatch"
- [goals/](goals/) — build log
- [docs/index.html](docs/index.html) — GitHub Pages landing page (SoftwareApplication / FAQPage structured data)

## 致谢与免责声明 / Credits and disclaimer

Credits: the plugin mechanism provided by the DeepSeek Harness host, catalog data from the community site [dsh-plugin.org](https://dsh-plugin.org), and community lists such as [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).

Disclaimer:

- **This project has no affiliation with DeepSeek official or zcode**, and is not an official product of any host.
- "PlugBox catalog" is this project's curation, not an endorsement by any host vendor. Community catalog entries are synced from a third-party site and are only verified at repository level (reachable, really a plugin package, version taken from the package itself) — their behaviour and compatibility are not guaranteed.
- Other marketplace implementations maintain their own catalogs. PlugBox does not replace them; it merges index sources into one panel and adds compatibility flags and branch installs.

## License

MIT, see [LICENSE](LICENSE).
