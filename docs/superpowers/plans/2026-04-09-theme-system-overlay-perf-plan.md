# Theme System, Overlay Refinement, and Assist Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the app to 6 selectable themes, visually unify the main UI/settings/overlays, and ship low-risk assist-path latency and long-session stability improvements without changing the current default theme or core workflow.

**Architecture:** Extend the existing theme token system instead of replacing it, then restyle the assist/settings/overlay surfaces to consume shared theme variables. Keep backend changes focused on noisy broadcast reduction, ASR/answer dispatch timing refinements, and cleanup/synchronization hardening rather than changing the pipeline architecture.

**Tech Stack:** React 18 + Zustand + Vite + Tailwind/CSS variables, Electron main/preload IPC, FastAPI backend, threaded assist pipeline, WebSocket push.

---

## File Structure / Responsibility Map

### Frontend theme registry and global tokens
- Modify: `frontend/src/lib/colorScheme.ts`
  - Extend `ColorSchemeId`
  - Add the 3 new theme options while preserving existing defaults and storage compatibility
- Modify: `frontend/src/index.css`
  - Define CSS variable sets for 6 total themes
  - Add shared visual primitives for console header, timeline, overlay shells, lyric strip, and theme-sensitive surface treatments

### Main assist UI refinement
- Modify: `frontend/src/App.tsx`
  - Refine header/module chrome and status grouping
  - Keep current mode switching and overlay sync behavior
- Modify: `frontend/src/components/AnswerPanel.tsx`
  - Improve stream/card hierarchy and empty states using shared theme tokens
- Modify: `frontend/src/components/TranscriptionPanel.tsx`
  - Turn transcription list into a stronger timeline-style surface
- Modify: `frontend/src/components/ControlBar.tsx`
  - Clarify primary vs secondary actions

### Settings and theme selection
- Modify: `frontend/src/components/settings/PreferencesTab.tsx`
  - Present 6-theme selection clearly
  - Keep overlay controls grouped and Beta-labeled
- Modify: `frontend/src/components/settings/shared.tsx`
  - Add reusable settings cards/section chrome if needed
- Modify: `frontend/src/components/SettingsDrawer.tsx`
  - Keep navigation intact while improving visual grouping

### Overlay system
- Modify: `frontend/src/components/InterviewOverlay.tsx`
  - Make panel + lyric overlay consume theme tokens
  - Keep width/font-size/line-count behavior intact
- Modify: `frontend/src/stores/configStore.ts`
  - Keep overlay config persistence API coherent and stable
- Modify: `frontend/src/types/electron.d.ts`
  - Keep overlay IPC typing aligned
- Modify: `desktop/main.js`
  - Preserve overlay persistence/shortcut logic while reducing sync noise and hardening lifecycle cleanup
- Modify: `desktop/preload.js`
  - Keep overlay IPC surface minimal and typed
- Modify: `desktop/shortcuts.js`
  - Keep overlay toggle shortcut registered and labeled
- Modify: `desktop/shortcuts.test.js`
  - Cover shortcut persistence changes

### Backend performance/stability
- Modify: `backend/api/assist/pipeline.py`
  - Reduce noisy broadcasts and tune dispatch timing carefully
  - Harden cleanup for pending/in-flight state
- Modify: `backend/services/llm/streaming.py`
  - Reduce redundant token/status broadcasts if safe
- Modify: `backend/main.py`
  - Ensure startup/shutdown and preload broadcast behavior remain clean

---

## Task 1: Freeze the theme registry and token contract

**Files:**
- Modify: `frontend/src/lib/colorScheme.ts`
- Modify: `frontend/src/index.css`
- Test: `cd frontend && npm run build`

- [ ] **Step 1: Extend the theme ID union and option list**

Add the new IDs while preserving current default behavior:

```ts
export type ColorSchemeId =
  | 'vscode-dark-plus'
  | 'vscode-light-plus'
  | 'vscode-dark-hc'
  | 'command-center'
  | 'editorial-glass'
  | 'stealth-cyber'

export const COLOR_SCHEME_OPTIONS = [
  // existing 3 first, new 3 after them
]
```

- [ ] **Step 2: Keep storage/backward compatibility**

Ensure `readStoredColorScheme()` accepts all 6 IDs but still falls back to the current default:

```ts
return 'vscode-dark-plus'
```

Run: `grep -n "readStoredColorScheme\\|ColorSchemeId" frontend/src/lib/colorScheme.ts`
Expected: union contains 6 values, fallback remains `vscode-dark-plus`

- [ ] **Step 3: Add CSS variable blocks for the 3 new themes**

Add:

```css
[data-theme='command-center'] { ... }
[data-theme='editorial-glass'] { ... }
[data-theme='stealth-cyber'] { ... }
```

Include at minimum:
- `--c-bg-*`
- `--c-text-*`
- `--c-accent-*`
- `--c-code-*`
- any new shared tokens added for console chrome / overlays

- [ ] **Step 4: Introduce shared primitives instead of one-off styling**

Add reusable global classes in `frontend/src/index.css` such as:

```css
.console-panel { ... }
.console-topbar { ... }
.timeline-item { ... }
.overlay-shell { ... }
.lyric-shell { ... }
```

Expected result: later component styling can rely on these primitives instead of duplicating per-component CSS.

- [ ] **Step 5: Run the frontend build**

Run: `cd frontend && npm run build`
Expected: build succeeds with no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/colorScheme.ts frontend/src/index.css
git commit -m "Expand the app theme registry to six coherent visual systems"
```

---

## Task 2: Redesign the assist shell without changing workflow

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AnswerPanel.tsx`
- Modify: `frontend/src/components/TranscriptionPanel.tsx`
- Modify: `frontend/src/components/ControlBar.tsx`
- Test: `cd frontend && npm run build`

- [ ] **Step 1: Restyle the app header into a clearer control console**

Refactor `frontend/src/App.tsx` header markup/classes so:
- module tabs feel like a mode switcher
- Think/model/status controls feel grouped
- secondary telemetry does not compete with primary controls

Preserve these behaviors:
- existing mode tabs
- model selection
- settings/config buttons
- overlay sync effect

- [ ] **Step 2: Upgrade the transcription area into a timeline surface**

In `frontend/src/components/TranscriptionPanel.tsx`, keep the same data flow but move item styling toward:

```tsx
<div className="timeline-item ...">
  <span className="timeline-index ...">01</span>
  <div className="timeline-copy ...">{text}</div>
</div>
```

Expected result: better scanability during long sessions.

- [ ] **Step 3: Upgrade the answer area hierarchy**

In `frontend/src/components/AnswerPanel.tsx`:
- keep existing card/stream modes
- keep markdown and code rendering logic
- improve question/answer separation and empty-state polish
- reuse shared theme primitives where possible

Do not change:
- data model
- scroll-follow threshold behavior
- multi-stream semantics

- [ ] **Step 4: Clarify primary actions in the control bar**

In `frontend/src/components/ControlBar.tsx`:
- visually prioritize start / pause / stop / ask
- demote ancillary actions (clear/history/help-like affordances)
- preserve existing handlers and confirmations

- [ ] **Step 5: Run the frontend build**

Run: `cd frontend && npm run build`
Expected: build succeeds and all touched components compile

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/AnswerPanel.tsx frontend/src/components/TranscriptionPanel.tsx frontend/src/components/ControlBar.tsx
git commit -m "Raise the assist UI into a clearer themed control console"
```

---

## Task 3: Turn settings into a real theme-and-overlay control center

**Files:**
- Modify: `frontend/src/components/settings/PreferencesTab.tsx`
- Modify: `frontend/src/components/settings/shared.tsx`
- Modify: `frontend/src/components/SettingsDrawer.tsx`
- Test: `cd frontend && npm run build`

- [ ] **Step 1: Present all 6 themes as intentional choices**

In `PreferencesTab`, render theme choices with clearer previews/hints:

```tsx
{COLOR_SCHEME_OPTIONS.map((opt) => (
  <button key={opt.id} ...>
    <span>{opt.label}</span>
    <span>{opt.hint}</span>
  </button>
))}
```

Requirement: existing 3 themes remain visible and current default remains first-class, not deprecated.

- [ ] **Step 2: Keep the overlay section grouped and Beta-labeled**

Rework the overlay controls into a dedicated settings card with:
- enabled toggle
- panel vs lyrics mode
- opacity
- lyric lines
- lyric font size
- lyric width

Keep save behavior routed through the existing store setters.

- [ ] **Step 3: Add shared settings chrome only if it reduces duplication**

If repeated wrappers appear, add focused shared helpers in `shared.tsx`, for example:

```tsx
export function SettingsCard(...) { ... }
export function SettingsHint(...) { ... }
```

Do not add abstractions that are only used once.

- [ ] **Step 4: Keep the drawer navigation model unchanged**

Do not add tabs or move business logic between settings sections. This task is visual hierarchy and grouping only.

- [ ] **Step 5: Run the frontend build**

Run: `cd frontend && npm run build`
Expected: build succeeds and settings still compile cleanly

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/settings/PreferencesTab.tsx frontend/src/components/settings/shared.tsx frontend/src/components/SettingsDrawer.tsx
git commit -m "Make settings the control center for themes and overlays"
```

---

## Task 4: Unify panel overlay and lyric overlay with the theme system

**Files:**
- Modify: `frontend/src/components/InterviewOverlay.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/stores/configStore.ts`
- Modify: `frontend/src/types/electron.d.ts`
- Test: `cd frontend && npm run build`

- [ ] **Step 1: Keep overlay data flow stable**

Do not alter:
- overlay enable/disable meaning
- panel vs lyric mode meaning
- persisted opacity / width / font size / line count behavior

Only refine:
- styling
- class structure
- sync noise if obviously redundant

- [ ] **Step 2: Make panel overlay consume shared theme shell tokens**

Refactor `InterviewOverlay.tsx` so panel mode uses theme-aware shell classes:

```tsx
<div className="overlay-shell overlay-panel ...">
  ...
</div>
```

Expected result: theme switches visibly affect the floating ask/answer card.

- [ ] **Step 3: Make lyric overlay a true teleprompter strip**

Refactor lyric mode to ensure width/font-size changes remain visually balanced:

```tsx
<div className="overlay-shell lyric-shell ..." style={{ maxWidth: `${interviewOverlayLyricWidth}px` }}>
```

Check:
- line spacing remains readable
- last line emphasis still works
- empty/loading state still looks intentional

- [ ] **Step 4: Keep overlay IPC typing aligned**

Update `frontend/src/types/electron.d.ts` if needed so it matches actual preload IPC names and payload shape exactly.

- [ ] **Step 5: Run the frontend build**

Run: `cd frontend && npm run build`
Expected: build succeeds and overlay-related typing is clean

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/InterviewOverlay.tsx frontend/src/index.css frontend/src/App.tsx frontend/src/stores/configStore.ts frontend/src/types/electron.d.ts
git commit -m "Unify the floating panel and lyric overlay with theme-aware styling"
```

---

## Task 5: Harden Electron overlay lifecycle and shortcut behavior

**Files:**
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Modify: `desktop/shortcuts.js`
- Modify: `desktop/shortcuts.test.js`
- Test: `node --test desktop/shortcuts.test.js`
- Test: `node --check desktop/main.js`
- Test: `node --check desktop/preload.js`

- [ ] **Step 1: Keep the overlay IPC surface minimal and correctly named**

Ensure preload and renderer agree on:

```js
syncOverlayWindow
getOverlayState
onOverlayState
removeOverlayStateListener
```

If any stale alias remains, remove it unless a compatibility bridge is required.

- [ ] **Step 2: Keep overlay state broadcast directional and non-duplicative**

In `desktop/main.js`, verify `sendOverlayState()` and IPC handlers:
- do not spam unchanged state if avoidable
- still update both main window and overlay window when required
- do not create a renderer/main feedback loop

- [ ] **Step 3: Preserve per-mode position persistence**

Keep:
- per-mode saved coordinates
- off-screen recovery logic
- debounced persistence writes

Explicitly verify:
- panel and lyrics can store separate positions
- mode switch reuses the correct saved position

- [ ] **Step 4: Keep the global shortcut stable**

Retain:

```js
toggleInterviewOverlay: 'CommandOrControl+O'
```

Ensure label/category remain user-readable in the shortcuts editor.

- [ ] **Step 5: Run desktop checks**

Run:

```bash
node --test desktop/shortcuts.test.js
node --check desktop/main.js
node --check desktop/preload.js
```

Expected:
- test output shows all desktop shortcut tests passing
- syntax checks exit 0

- [ ] **Step 6: Commit**

```bash
git add desktop/main.js desktop/preload.js desktop/shortcuts.js desktop/shortcuts.test.js
git commit -m "Harden overlay lifecycle, IPC, and shortcut behavior"
```

---

## Task 6: Reduce assist-path broadcast noise and cleanup risk

**Files:**
- Modify: `backend/api/assist/pipeline.py`
- Modify: `backend/services/llm/streaming.py`
- Modify: `backend/main.py`
- Test: targeted backend checks for touched modules

- [ ] **Step 1: Add focused instrumentation before behavior changes**

Before changing behavior, identify the noisy paths in:
- transcription broadcast
- audio level broadcast
- transcribing state broadcast
- token update broadcast
- answer chunk broadcast boundaries

Use search:

```bash
grep -n "broadcast(" backend/api/assist/pipeline.py backend/services/llm/streaming.py backend/main.py
```

Expected: a concrete list of candidate hot paths to trim.

- [ ] **Step 2: Trim only clearly redundant broadcasts**

Examples of acceptable changes:
- avoid rebroadcasting identical boolean state repeatedly
- debounce or threshold high-frequency nonessential signals if safe
- avoid duplicate overlay-related pushes originating from backend if the renderer can derive them

Examples of forbidden changes:
- removing required `answer_chunk` streaming fidelity
- changing semantics of answer ordering
- changing the pipeline architecture

- [ ] **Step 3: Review ASR dispatch timing for low-risk latency wins**

In `backend/api/assist/pipeline.py`, inspect the confirmation/grouping window logic and only tighten where behavior remains safe:

```py
def _asr_confirm_window_sec(cfg) -> float: ...
def _asr_group_max_wait_sec(cfg) -> float: ...
```

Preferred changes:
- reduce unnecessary waiting
- avoid duplicate stale work
- improve cancellation/cleanup of superseded tasks

- [ ] **Step 4: Harden cleanup**

Verify cleanup paths on:
- stop
- cancel
- shutdown
- reconnect-sensitive flows

Expected invariants:
- pending queues do not accumulate stale work
- in-flight state is cleared on reset paths
- no repeated listener/timer buildup from the backend changes

- [ ] **Step 5: Run backend validation**

Run at minimum:

```bash
python -m py_compile backend/main.py backend/api/assist/pipeline.py backend/services/llm/streaming.py
```

If any existing targeted tests cover touched paths, run them too, for example:

```bash
pytest backend/tests/test_assist_asr_interrupt.py -q
```

Expected: syntax checks pass; touched regression tests pass if run.

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/api/assist/pipeline.py backend/services/llm/streaming.py
git commit -m "Reduce assist-path sync noise and harden long-session cleanup"
```

---

## Task 7: Final integration verification across themes and overlays

**Files:**
- Modify: none unless fixes are required
- Test: frontend, desktop, and backend verification commands

- [ ] **Step 1: Run the full verification set**

Run:

```bash
cd frontend && npm run build
cd ..
node --test desktop/shortcuts.test.js
node --check desktop/main.js
node --check desktop/preload.js
python -m py_compile backend/main.py backend/api/assist/pipeline.py backend/services/llm/streaming.py
```

Expected: all commands exit 0

- [ ] **Step 2: Perform manual theme verification**

Check all 6 themes in:
- main assist UI
- settings
- panel overlay
- lyric overlay

Record any visual regressions before claiming completion.

- [ ] **Step 3: Perform manual overlay verification**

Verify:
- panel position persistence
- lyrics position persistence
- panel vs lyrics mode switch keeps correct position
- `CommandOrControl+O` toggles overlay reliably
- lyric width/font-size updates are visible and stable

- [ ] **Step 4: Perform manual assist verification**

Verify:
- start/pause/stop still work
- transcription still arrives
- answers still stream
- no obvious duplicate or noisy status flicker appears after the backend tuning

- [ ] **Step 5: Commit final integration fixes if any**

```bash
git add -A
git commit -m "Polish the integrated six-theme assist and overlay experience"
```

---

## Self-review checklist

### Spec coverage
- 6-theme expansion: covered by Tasks 1 and 3
- assist UI refinement: covered by Task 2
- overlay unification: covered by Tasks 4 and 5
- backend latency/stability: covered by Task 6
- verification across all surfaces: covered by Task 7

### Placeholder scan
- No `TODO`, `TBD`, or “implement later” placeholders remain
- Commands and touched files are explicit per task

### Type consistency
- Overlay IPC naming uses `syncOverlayWindow` / `getOverlayState` / `onOverlayState`
- New theme IDs are defined first in `colorScheme.ts` and then consumed elsewhere

