# Realtime ASR Latest-Group Interrupt Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep realtime interview assist responsive when the interviewer keeps asking new questions by grouping short follow-ups, ignoring backchannels, and interrupting stale ASR answer generation in favor of the latest confirmed question group.

**Architecture:** Preserve the existing VAD/ASR fragment merge stage, then add a second ASR question-group stage that classifies published utterances as ignore/candidate/promote. Confirmed ASR groups supersede stale pending/running ASR work, while manual and screen tasks keep the current dispatch behavior.

**Tech Stack:** FastAPI, Python threading/locks, existing OpenAI streaming client, pytest

---

### Task 1: Add failing regression tests

**Files:**
- Create: `backend/tests/test_assist_asr_interrupt.py`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run them to confirm they fail on the current behavior**

### Task 2: Add ASR utterance classification helpers

**Files:**
- Modify: `backend/services/stt.py`
- Test: `backend/tests/test_assist_asr_interrupt.py`

- [ ] **Step 1: Add helpers for filler stripping, backchannel detection, question-candidate classification, and grouped ASR prompt text construction**
- [ ] **Step 2: Run focused tests and confirm they pass**

### Task 3: Add ASR latest-group dispatch and stale-seq draining

**Files:**
- Modify: `backend/api/assist/router.py`
- Test: `backend/tests/test_assist_asr_interrupt.py`

- [ ] **Step 1: Port the safe commit-seq reset/drain logic so cancelled ASR work cannot block later commits**
- [ ] **Step 2: Add candidate-group buffering, confirm-window flushing, stale ASR task supersede, and single-flight ASR dispatch**
- [ ] **Step 3: Run focused tests and confirm they pass**

### Task 4: Wire config knobs for the new ASR timing behavior

**Files:**
- Modify: `backend/core/config.py`
- Modify: `backend/api/common/router.py`
- Modify: `frontend/src/stores/configStore.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/SettingsDrawer.tsx`

- [ ] **Step 1: Add config fields for confirm window / max wait / ASR interrupt toggle**
- [ ] **Step 2: Expose them through the existing config API and frontend types**
- [ ] **Step 3: Surface the controls in settings without changing unrelated UI behavior**

### Task 5: Verify and run real model-backed scenarios

**Files:**
- Modify: none required

- [ ] **Step 1: Run focused pytest coverage for the new behavior**
- [ ] **Step 2: Run a real model-backed harness that submits spaced ASR-like utterances against the live answer path**
- [ ] **Step 3: Compare timings and cancellation behavior with single-model and multi-model settings**
