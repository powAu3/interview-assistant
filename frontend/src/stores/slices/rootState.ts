import type { ConfigSlice } from './configSlice'
import type { InterviewSlice } from './interviewSlice'
import type { SttSlice } from './sttSlice'
import type { UiSlice } from './uiSlice'
import type { ResumeOptSlice } from './resumeOptSlice'

export type RootState = ConfigSlice &
  InterviewSlice &
  SttSlice &
  UiSlice &
  ResumeOptSlice
