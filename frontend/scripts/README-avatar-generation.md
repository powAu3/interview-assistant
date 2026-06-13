# Avatar generation workflow

This workflow is for synthetic, non-real-person practice interviewer portraits.

## Generate candidates

Requires `OPENAI_API_KEY`.

```powershell
$env:IMAGE_GEN = "$env:USERPROFILE\.codex\skills\.system\imagegen\scripts\image_gen.py"
python $env:IMAGE_GEN generate-batch `
  --input frontend\scripts\avatar-prompts.jsonl `
  --out-dir tmp\avatar-img2-candidates `
  --model gpt-image-2 `
  --size 1024x1536 `
  --quality high `
  --output-format png `
  --concurrency 3 `
  --force
```

## Review gates

Reject a candidate if it has any of these:

- Looks like a real public figure, celebrity, or identifiable photo source.
- Plastic 3D doll, anime/cartoon, beauty-influencer stock look, or game NPC feeling.
- Distorted eyes, mismatched pupils, bad teeth, broken collar, visible hand/finger artifacts.
- Green spill on hair/skin/clothes that cannot be removed cleanly.
- Persona mismatch: supportive too soft, pressure too hostile, calm too blank.

## Finalize assets

Choose one candidate per persona, remove chroma key to alpha, crop consistently, and save:

- `frontend/public/avatars/generated/interviewer-calm.webp`
- `frontend/public/avatars/generated/interviewer-supportive.webp`
- `frontend/public/avatars/generated/interviewer-pressure.webp`

Use the chroma-key helper from the imagegen skill:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\imagegen\scripts\remove_chroma_key.py" `
  --input tmp\avatar-img2-candidates\<candidate>.png `
  --out frontend\public\avatars\generated\<final>.png `
  --auto-key border `
  --soft-matte `
  --transparent-threshold 12 `
  --opaque-threshold 220 `
  --despill
```

Then export WebP with the repo’s available image tooling or PIL.
