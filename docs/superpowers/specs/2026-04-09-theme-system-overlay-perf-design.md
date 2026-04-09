# 6-theme visual system + overlay refinement + assist performance design

## Summary

Upgrade the app from a single utility-style dark interface into a multi-theme desktop interview system while preserving current workflows and default behavior.

This work has three coordinated goals:

1. Keep the current default theme and existing three themes intact.
2. Add three new selectable themes:
   - `command-center`
   - `editorial-glass`
   - `stealth-cyber`
3. Improve assist-path responsiveness and long-session stability, especially around ASR-to-answer latency, WebSocket/state synchronization, and overlay lifecycle behavior.

The resulting product should feel like one coherent desktop tool across:

- main assist UI
- settings
- floating ask/answer overlay
- lyric overlay
- existing secondary product surfaces

## Goals

- Expand from 3 themes to 6 themes without breaking persisted user preferences.
- Make theme selection affect more than colors: surfaces, borders, density, overlay material, emphasis, and motion tone should also shift.
- Rework assist UI hierarchy so the app feels more like a professional control console.
- Rework settings into clearer grouped control surfaces.
- Make panel overlay and lyric overlay visually belong to the same design system as the main app.
- Reduce perceived assist latency.
- Improve long-running session stability and reduce state-sync noise.

## Non-goals

- No protocol rewrite of the entire assist pipeline.
- No large async/concurrency architecture rewrite.
- No redesign of every business flow from scratch.
- No breaking change to current default theme or stored theme selection.
- No removal of current overlay behavior/configuration; only refinement and extension.

## User-facing outcome

Users keep their current default experience, but can choose six themes total:

- Existing:
  - `vscode-dark-plus`
  - `vscode-light-plus`
  - `vscode-dark-hc`
- New:
  - `command-center`
  - `editorial-glass`
  - `stealth-cyber`

The assist page, settings, and overlays all feel intentionally designed instead of visually disconnected.

## Theme system design

### Theme model

Continue using the existing theme-selection mechanism and storage key. Extend the theme registry rather than replacing it.

Each theme defines:

- background tokens
- surface layering tokens
- border/emphasis tokens
- accent tokens
- overlay shell tokens
- code block tokens
- optional typography weight/spacing differences
- motion intensity rules

The new themes intentionally differ in character:

### 1. Command Center

- cold, tactical, high-density
- stronger panel separation
- sharper telemetry emphasis
- best fit for assist-heavy workflows

### 2. Editorial Glass

- refined, elegant, quieter
- softer light separation and premium panel feel
- strongest settings-page presentation

### 3. Stealth Cyber

- most memorable
- best for panel overlay and lyric overlay
- more theatrical, covert-prompt aesthetic

### Theme application scope

All six themes should apply consistently to:

- header and module switcher
- answer cards / stream surfaces
- transcription timeline items
- settings drawer and sections
- overlay shells
- lyric strip
- empty states
- badges / pills / status chips

## UI redesign plan

### Assist main screen

Refine information hierarchy without changing core workflow:

- Header becomes more console-like, with clearer primary/secondary controls.
- Mode switching becomes more deliberate and easier to scan.
- Token/health/status indicators become visually subordinate but still useful.
- The answer area becomes more obviously the primary working surface.
- The transcription area reads more like a live timeline than a plain stacked list.

### Settings

Reorganize settings visually into clearer grouped control sections:

- Theme selection
- Answer presentation
- Overlay / lyric overlay
- STT / capture behavior
- Other preferences

The overlay section remains Beta-labeled, but becomes a proper module rather than an add-on control block.

### Overlay panel

Refine the panel overlay into a real prompt card:

- clearer Ask / Answer hierarchy
- better readability at a glance
- stronger material identity per theme
- maintain drag behavior, opacity, and persistence

### Lyric overlay

Refine lyric mode into a usable teleprompter strip:

- better long-distance readability
- consistent spacing when width/font-size change
- theme-sensitive material treatment
- support existing line-count/opacity controls plus the newly added width and font size controls

## Backend performance design

### Priority 1: perceived latency

Target the path from ASR fragments to answer dispatch.

#### Planned improvements

- Reduce unnecessary waiting before committing viable ASR question groups.
- Reduce repeated or low-value high-frequency broadcasts.
- Ensure overlay synchronization only happens on meaningful state changes, not every noisy intermediate path.
- Review whether answer-start and streaming broadcast cadence can be coalesced or trimmed without reducing fidelity.

### Priority 2: long-session stability

Review long-running behavior around:

- queue growth
- in-flight task cleanup
- commit buffer lifecycle
- timer accumulation
- overlay move persistence timer cleanup
- repeated listener registration
- state retained after cancellation / reconnect / overlay toggles

#### Planned improvements

- Add stricter cleanup on shutdown and mode switches.
- Reduce duplicate synchronization work between main window and overlay window.
- Keep persistence writes debounced.
- Guard against stale positions or stale inflight state surviving across mode changes.

### Priority 3: low-risk throughput gains

Only low-risk optimizations are in scope:

- avoid repeated serialization where possible
- avoid repeated identical UI-state pushes
- keep current threading model unless a tiny focused change is enough

## Implementation slices

### Slice A — theme system expansion

Files likely touched:

- `frontend/src/lib/colorScheme.ts`
- `frontend/src/index.css`
- assist/settings component styling files

### Slice B — assist UI refinement

Files likely touched:

- `frontend/src/App.tsx`
- `frontend/src/components/AnswerPanel.tsx`
- `frontend/src/components/TranscriptionPanel.tsx`
- `frontend/src/components/ControlBar.tsx`
- `frontend/src/components/settings/*`

### Slice C — overlay visual unification

Files likely touched:

- `frontend/src/components/InterviewOverlay.tsx`
- `desktop/main.js`
- `desktop/preload.js`
- `frontend/src/stores/configStore.ts`

### Slice D — backend performance/stability

Files likely touched:

- `backend/api/assist/pipeline.py`
- `backend/services/llm/streaming.py`
- `backend/main.py`

## Risks

### Visual risk

If too much styling changes at once, the app may feel inconsistent across modules.

Mitigation:

- build themes on top of existing tokens
- keep one shared surface language
- verify all six themes on main assist + settings + overlays before calling complete

### Performance risk

Aggressive latency tuning could over-submit noisy ASR fragments.

Mitigation:

- prefer threshold and synchronization refinement over large behavioral rewrites
- keep current gating concepts intact and tune around them

### Stability risk

Overlay/main-window sync can become noisy or circular.

Mitigation:

- ensure sync only happens on meaningful config/visibility changes
- avoid repeated listener accumulation
- keep persisted overlay state simple: coordinates + explicit overlay config only

## Verification plan

### Frontend

- `cd frontend && npm run build`
- manual verification of all 6 themes
- manual verification of assist, settings, panel overlay, lyric overlay

### Desktop

- `node --test desktop/shortcuts.test.js`
- `node --check desktop/main.js`
- `node --check desktop/preload.js`
- manual verification of overlay position persistence and toggle shortcut

### Backend

- targeted regression tests if touched logic already has tests
- at minimum, syntax/import validation for touched backend modules
- manual long-session sanity check for repeated assist usage

## Rollout order

1. Finish overlay follow-up changes already in progress.
2. Expand theme system to 6 themes.
3. Restyle assist UI and settings around the new system.
4. Unify panel/lyric overlay visuals with theme tokens.
5. Apply focused backend latency + stability improvements.
6. Run build/tests/manual checks.
7. Run code review after implementation is complete.

## Acceptance criteria

- Current default theme remains default.
- Users can choose 6 themes total.
- New themes visibly affect both main UI and overlays.
- Overlay panel and lyric strip feel stylistically integrated with the selected theme.
- Overlay position persists by mode.
- Overlay toggle shortcut works reliably.
- Lyric width/font-size controls behave correctly.
- Assist path feels at least as responsive as before, ideally better.
- No new long-session instability is introduced.
