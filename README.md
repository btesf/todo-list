# Enhanced To-Do List

A single-page to-do list app with no build step: Vue 3, SortableJS, and Feather
Icons are loaded straight from a CDN in `index.html`, and the whole app is one
`script.js` file. Open `index.html` in a browser and it runs — no `npm install`
required for the app itself. npm is only used for the Playwright test suite
and for packaging the app as a desktop app via Nativefier.

## Features

- **Tasks**: add, edit (double-click the text), star as important, delete,
  drag-reorder within the pending list.
- **Subtasks**: per-task checklist with its own drag-reorder (completed
  subtasks sort to the bottom and lock in place); a small ring + counter badge
  shows completion progress at a glance.
- **Descriptions**: free-text per task, rendered with a small set of Markdown:
  `**bold**`, `*italic*`, `` `code` ``, bare URL auto-linking, and
  `[label](url)` link shortening (handy for pasting Jira/GitHub links without
  cluttering the row). The same rendering applies to task and subtask text.
- **Tags**: add/remove free-form tags per task; a compact chip strip shows
  them on the collapsed row, and clicking a chip filters the list to that tag
  (reuses the search box under the hood).
- **Due dates**: optional per-task due date with overdue styling.
- **Search**: filters both pending and completed lists by task text,
  description, and tags.
- **Completed list**: grouped by completion date ("Today", "Yesterday", then
  full dates), with groups older than 10 days collapsed by default; bulk
  select-and-delete or one-click "Clear completed".
- **Undo, not confirm dialogs**: deleting a task, bulk-deleting, clearing
  completed, and importing all show a toast with an "Undo" button instead of
  a blocking `confirm()`/`alert()` popup.
- **Dark mode**: toggle in the header, persisted, with a full second color
  palette (see `[data-theme="dark"]` in `style.css`).
- **Import/Export**: export the task list as a JSON file; import overwrites
  the current list (with Undo).
- **Auto-save to a local file**: optionally mirrors every change to a file on
  disk via the File System Access API, in addition to the normal
  `localStorage` persistence — see [Persistence](#persistence) below.
- **Keyboard accessibility**: consistent `:focus-visible` outlines on
  buttons, links, and checkboxes; the "add task" input auto-focuses on load.

## Project structure

```
index.html    All markup + Vue component templates (as <script type="text/x-template"> blocks)
script.js     All Vue component logic (components + root app), wrapped in a single DOMContentLoaded listener
style.css     All styling, including light/dark theme CSS custom properties
tests/        Playwright end-to-end test suite (one spec file per feature area)
scripts/      Build tooling (Nativefier packaging wrapper, see below)
build/        Nativefier build output (gitignored, created on demand)
```

There's no bundler, no JSX, no SFCs. Each Vue component's template lives in
`index.html` as a `<script type="text/x-template" id="...">` block, and its
logic (a plain object with `template: '#...-template'`, `props`, `emits`, and
a `setup()`) lives in `script.js`. Vue resolves the `#id` reference to the
template at runtime.

## Architecture / components

The app is a single Vue instance mounted on `#app`, composed of five
components. Data flows down via props; changes flow back up via emitted
events that bubble through intermediate components exactly the way DOM events
do — a pattern used consistently throughout instead of a global store:

```
root app (createApp)
├─ owns: tasks[], searchQuery, theme, toast, expandedTaskIds, auto-save state
├─ <task-list>              (pending tasks)
│   └─ <task-item> × N
│       └─ <subtask-list>
│           └─ <subtask-item> × N
└─ <completed-tasks>        (completed tasks, grouped by date)
    └─ <task-item> × N       (same component, reused)
        └─ <subtask-list>
            └─ <subtask-item> × N
```

### Root app (`createApp({ setup() {...} })`, `script.js`)

Owns all canonical state and is the only place that mutates the `tasks`
array directly:

- `tasks` — the full task list (source of truth; persisted to
  `localStorage` and, optionally, a local file — see Persistence).
- `pendingTasks` / `completedTasks` — computed, filtered by `searchQuery` and
  sorted (pending by `order`; completed grouped by date inside
  `CompletedTasks`).
- `expandedTaskIds` — a `Set<taskId>` tracking which task rows have their
  details panel open. Deliberately **not** local state inside `TaskItem`:
  since Vue destroys and recreates a `TaskItem` instance whenever a task is
  filtered out of view (search) or moves between the pending/completed lists
  (they're separate components), a local `ref` would reset on every such
  move. Keying by task id in the root instead makes "expanded" survive both.
- `toast` + `showToast()`/`dismissToast()`/`handleToastAction()` — the
  undo-toast system. Any destructive action captures what it removed in a
  closure and calls `showToast(message, { actionLabel: 'Undo', onAction })`.
- Auto-save state (`autoSaveState`, `fileAccessSupported`,
  `showAutoSaveBanner`/`showAutoSaveFooterButton`) — see Persistence.
- `theme` + `toggleTheme()` — dark/light mode, persisted to `localStorage`.

### `TaskList` (`#task-list-template`)

Thin wrapper around a `<ul>` of `TaskItem`s for the **pending** list. Owns the
SortableJS instance for drag-reordering (`forceFallback: true` — see the note
below on why). On drop, emits `order-update` with the reordered array; the
root just writes new `order` values back onto the matching tasks in `tasks`.
Everything else (`update-task`, `delete-task`, `filter-by-tag`,
`set-task-expanded`) is passed straight through to the root.

### `CompletedTasks` (`#completed-tasks-template`)

Renders the **completed** list, grouped by completion date via a computed
`groupedTasks` (keys: "Today", "Yesterday", or a full date). Groups whose date
is more than 10 days old are collapsed by default; `expandedDates` (a
`Set<dateKey>`, the same pattern as `expandedTaskIds` above) tracks which old
groups the user has manually expanded, and the whole group's height/opacity
animate via CSS rather than `v-if`, so toggling is smooth.

Also owns bulk-selection mode (`isSelecting`, `selectedIds`) for
"Select → check some → Delete Selected", and the one-click "Clear completed"
button — both emit up to the root (`delete-many`, `clear-completed`) rather
than mutating `tasks` themselves.

### `TaskItem` (`#task-item-template`)

The task row itself — checkbox, star, text (double-click to edit), due-date
badge, subtask progress ring, tag chip strip, and the expand/collapse details
panel (description, due date editor, tags editor, subtasks). Renders both in
the pending list and the completed list (via the `selectionMode`/`selected`
props, only relevant in the completed context).

Props: `task`, `selectionMode`, `selected`, `expanded` (see `expandedTaskIds`
above — this is *not* local state).
Emits: `update-task`, `delete-task`, `toggle-select`, `filter-by-tag`,
`set-task-expanded`.

Notable behavior:
- Marking a task complete auto-collapses its details; starting to edit the
  description auto-expands them.
- The subtask progress ring's `stroke-dashoffset` is computed from the ratio
  of completed subtasks — see `subtaskProgressRingOffset` in `script.js`.
- All user-facing text (task text, description) goes through `linkify()`,
  which escapes HTML first and *then* applies Markdown/link patterns, so
  Markdown syntax can never be used to break out of the escaped text (see
  `tests/security.spec.js` and `tests/markdown.spec.js`).

### `SubtaskList` / `SubtaskItem` (`#subtask-list-template`, `#subtask-item-template`)

One level down: a per-task checklist. `SubtaskList` owns its own SortableJS
instance (incomplete subtasks are draggable; completed ones sort to the
bottom via `filter: '.completed'` and are pinned there). `SubtaskItem` is the
individual row (checkbox, text with the same double-click-to-edit and
`linkify()` rendering, delete button).

### Why `forceFallback: true` on both Sortable instances

Native HTML5 drag-and-drop (SortableJS's default) was visually janky —
disabling it in favor of SortableJS's pointer-emulated "fallback" mode, along
with `fallbackTolerance: 3`, gives smooth, predictable dragging at the cost of
needing a small movement threshold before a drag is recognized (see
`tests/helpers.js`'s `dragHandle()` for how the test suite accounts for this).

## Data model

Stored as a plain array of task objects (see `loadTasks()`/`addTask()` in
`script.js` for where defaults are filled in):

```js
{
  id: string,             // Date.now().toString()
  text: string,
  completed: boolean,
  completionDate: string | null,   // ISO timestamp, set when completed
  description: string,
  subtasks: [{ id, text, completed, order }],
  isImportant: boolean,
  order: number,           // lower sorts first; new tasks get min(existing) - 1
  dueDate: string | null,  // "YYYY-MM-DD"
  tags: string[],
}
```

Loading (`loadTasks()`) and importing (`handleImport()`) both merge these
defaults onto whatever's in storage/the imported file, so older exports
missing newer fields (e.g. `tags`) still load correctly.

## Persistence

Two independent layers, both optional to use:

1. **`localStorage`** (key `enhancedTodoAppTasks_vue_v2`) — always on, no
   setup required. This is the primary store; every change is written here
   via a `watch(tasks, ..., { deep: true })` in the root.
2. **A local file, via the File System Access API** — opt-in. Click
   "Enable auto-save" (shown once as a dismissible banner on first run, then
   as a permanent footer button) to pick a `.json` file; from then on, every
   change is *also* written there. The chosen file's handle is stored in
   IndexedDB (`todoAppFileHandleDB`) so it can be silently re-acquired on the
   next launch — if the browser needs the user to re-confirm permission, the
   button switches to "Reconnect auto-save" instead of failing silently. This
   feature only appears in browsers that support
   `window.showSaveFilePicker` (Chromium-based; this is also why the
   packaged desktop app below is built on Electron, not e.g. a WebKit
   wrapper).

`localStorage` is keyed by origin — see the build steps below for why the
packaged app points at the `index.html` file directly rather than a
dev-server URL.

## Testing

Playwright end-to-end tests, one spec file per feature area under `tests/`:

```bash
npm install        # installs @playwright/test and the packaging devDependency
npx playwright install chromium   # first time only, downloads the test browser
npm test            # run the full suite headless
npm run test:ui      # interactive UI mode
```

`playwright.config.js` runs `python3 -m http.server` as the dev server for
tests (no build step needed for the app itself). `tests/helpers.js` has the
shared utilities (`resetApp`, `addTask`, `taskRow`, `openDetails`,
`dragHandle`, etc.) used across spec files.

## Building the desktop app (macOS, via Nativefier)

The app can be packaged as a standalone macOS app with
[Nativefier](https://github.com/nativefier/nativefier) (which wraps it in
Electron). This repo includes a small wrapper script for this — read
[Why not just run `nativefier` directly?](#why-not-just-run-nativefier-directly)
below for why it exists before you skip straight to the plain CLI command.

### Prerequisites

- Node.js and npm.
- Nativefier installed globally: `npm install -g nativefier`.

### Step by step

1. **Install project dependencies** (one time):
   ```bash
   npm install
   ```
   This pulls in `@electron/packager`, used by the build script below.

2. **Run the build script**:
   ```bash
   npm run build:app
   ```
   This runs `scripts/build-nativefier-app.js`, which:
   - Points Nativefier at `file://<absolute-path-to>/index.html` **directly**
     — not a `localhost` dev server — so the app's origin (and therefore its
     `localStorage`/IndexedDB data) stays stable across every future launch,
     regardless of what port a dev server might otherwise pick.
   - Names the app "My Tasks", sized 900×800, `arm64` (Apple Silicon),
     `singleInstance: true` (clicking the app again while it's open focuses
     the existing window instead of opening a second one), `fastQuit: true`
     (quits when you close the window, standard behavior for a small utility
     app rather than staying docked with no window open).
   - Pins Electron to a recent version (`43.4.1` at the time of writing)
     rather than Nativefier's own older default, so the bundled Chromium is
     current and you won't immediately see Nativefier's "Old build detected"
     security warning on first launch.

3. **Find the built app** at:
   ```
   build/My Tasks-darwin-arm64/My Tasks.app
   ```
   Drag it into `/Applications` if you want it there, or just double-click it
   in place to launch it.

4. **Rebuild periodically.** Nativefier apps don't auto-update their bundled
   Electron/Chromium. Every few months, just re-run `npm run build:app` — it
   overwrites the previous build in place and resets the "how old is this
   build" clock, so you won't see the security warning.

5. **To build for a different Mac architecture** (e.g. an Intel Mac instead
   of Apple Silicon), edit the `arch: 'arm64'` line in
   `scripts/build-nativefier-app.js` to `'x64'`, or pass a different name/URL
   by editing that same file's `rawOptions` object — the script currently
   takes `targetUrl` and `outputDirectory` as its two CLI arguments and
   hardcodes the rest for convenience.

### Why not just run `nativefier` directly?

The plain command *should* work:

```bash
nativefier "file:///absolute/path/to/index.html" \
  --name "My Tasks" --platform mac --arch arm64 \
  --width 900 --height 800 --single-instance --fast-quit
```

On the machine this was built on (Node.js v26.4.0, a very new release),
though, that command silently hangs partway through packaging: Nativefier's
bundled legacy `electron-packager` dependency returns a promise that never
resolves *or* rejects on that Node version, so the process just quietly exits
once nothing else is keeping it alive — no error, no output, just a
half-finished `build/` directory. Confirmed by calling `electron-packager`
directly (same silent hang) and then testing its actively-maintained
successor, `@electron/packager`, which completes correctly.

`scripts/build-nativefier-app.js` works around this without touching
Nativefier's own global install: it intercepts Nativefier's internal
`require('electron-packager')` call (via `scripts/electron-packager-shim.js`)
and redirects it to `@electron/packager`, then calls Nativefier's normal
programmatic API (`buildNativefierApp`) exactly as its CLI would. If you're
building on a machine with an older/LTS Node version, you likely won't hit
this at all, and the plain `nativefier` command above will work fine — the
wrapper script is only needed to route around this specific incompatibility.

### Auto-save and the packaged app

`localStorage` persists fine across restarts once the app always launches
against the same stable `file://` URL (which is exactly what this build does
— see step 2 above). The optional local-file auto-save feature (see
[Persistence](#persistence)) works the same way inside the packaged app as
in a browser, since Electron's renderer is Chromium and supports the File
System Access API. For belt-and-suspenders resilience against an unclean
shutdown or a computer crash, enabling it once is still worthwhile even
though `localStorage` alone already survives normal restarts.
