# Interviewer Avatar Assets

Primary renderer: synthetic human portrait assets under `generated/`.

Those portraits must be fictional/non-identifiable generated people. Do not use
real-person photos, celebrity/public-figure likenesses, or identity-preserving
references. See `frontend/scripts/README-avatar-generation.md` for the img2
prompt and review workflow.

The practice renderer consumes the lossy `.webp` exports (small, ~90KB each)
under `generated/`. Keep the `.png`/`-hq.png` masters for regeneration, but the
shipped bundle only needs the `.webp` files referenced from
`frontend/src/components/practice/humanInterviewerAssets.ts`.

If the `.webp` file is missing at runtime, `VirtualInterviewer` shows a
"待生成" placeholder so the app stays usable.
