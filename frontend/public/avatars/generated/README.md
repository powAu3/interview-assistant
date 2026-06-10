# Synthetic interviewer avatars

This directory is reserved for generated, non-real-person interviewer portraits used by practice mode.

The avatar renderer keeps original PNG masters, enhanced high-resolution PNGs, and smaller WebP exports:

- `interviewer-calm.png` / `interviewer-calm-hq.png` / `interviewer-calm.webp`
- `interviewer-supportive.png` / `interviewer-supportive-hq.png` / `interviewer-supportive.webp`
- `interviewer-pressure.png` / `interviewer-pressure-hq.png` / `interviewer-pressure.webp`

Practice mode currently uses the `*-hq.png` files for the main portrait layer because the active booth scales and animates the portrait. Regenerate them with `frontend/scripts/enhance-avatar-assets.py` after replacing the original PNG masters. The smaller WebP files can still be used in lower-risk previews or if they are regenerated at a visibly lossless quality.

Generation policy:

- Use fictional synthetic people only.
- Do not use real photos, public-figure likenesses, celebrities, or identity-preserving references.
- Prefer `gpt-image-2`/img2 candidates on a flat chroma-key background, then locally remove the key color and crop to a consistent half-body transparent WebP.
- Run visual self-review before replacing these files: face naturalness, eyes/mouth, hands excluded, professional interview fit, dark booth/warm page integration.

If the final files are missing, the frontend falls back to the legacy Rocketbox poster so the app stays usable during generation.
