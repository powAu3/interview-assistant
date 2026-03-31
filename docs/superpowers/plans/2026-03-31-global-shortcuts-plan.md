# Global Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable Electron global shortcuts for hide/show window, hard clear, and server-screen ask, with persisted defaults and frontend configuration UI.

**Architecture:** Keep shortcut registration fully in the Electron main process, persist user choices in the desktop userData directory, and expose get/update/reset IPC APIs through preload. Renderer only records, displays, and updates shortcut bindings plus reacts to backend `session_cleared` events for immediate UI reset.

**Tech Stack:** Electron main/preload IPC, React + Zustand frontend, FastAPI websocket broadcast, TypeScript build, Python tests

---

### Task 1: Add failing desktop/backend tests and smoke checks

**Files:**
- Modify: `backend/tests/test_assist_asr_interrupt.py`
- Create: `desktop/shortcuts.test.js`

- [ ] **Step 1: Add backend expectation for `session_cleared` event path**
- [ ] **Step 2: Add desktop-level tests for shortcut validation and persistence helpers**
- [ ] **Step 3: Run tests to verify they fail on the current code**

### Task 2: Implement main-process shortcut manager

**Files:**
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`

- [ ] **Step 1: Add persisted shortcut config loader/saver in Electron userData**
- [ ] **Step 2: Add register/unregister/update/reset helpers with duplicate-key validation**
- [ ] **Step 3: Wire actions for hide/show, hard clear, and server-screen ask**
- [ ] **Step 4: Expose IPC methods through preload**

### Task 3: Expose clear event and UI sync

**Files:**
- Modify: `backend/api/assist/router.py`
- Modify: `backend/api/realtime/ws.py`
- Modify: `frontend/src/hooks/useInterviewWS.ts`
- Modify: `frontend/src/stores/configStore.ts`

- [ ] **Step 1: Broadcast `session_cleared` from backend clear path**
- [ ] **Step 2: Make frontend websocket handler immediately clear local assist state on that event**

### Task 4: Build configurable shortcut UI

**Files:**
- Create: `frontend/src/lib/shortcuts.ts`
- Create: `frontend/src/stores/shortcutsStore.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/SettingsDrawer.tsx`

- [ ] **Step 1: Add shortcut types/defaults/display helpers and persisted store**
- [ ] **Step 2: Initialize renderer shortcut state from preload IPC**
- [ ] **Step 3: Add settings UI for recording, status display, and reset-to-default**
- [ ] **Step 4: Remove the old hardcoded Ctrl/Cmd+B DOM listener in favor of configured global shortcuts**

### Task 5: Verify end-to-end behavior

**Files:**
- Modify: none required

- [ ] **Step 1: Run backend tests and desktop/frontend build checks**
- [ ] **Step 2: Validate default shortcut registration and update flow**
- [ ] **Step 3: Validate hard clear and server-screen ask behaviors with live app state**
