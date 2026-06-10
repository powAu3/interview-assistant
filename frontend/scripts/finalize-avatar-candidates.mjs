import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const repoRoot = path.resolve(root, '..')
const candidateDir = path.resolve(repoRoot, 'tmp', 'avatar-img2-candidates')
const finalDir = path.resolve(root, 'public', 'avatars', 'generated')
const reviewPath = path.resolve(repoRoot, 'tmp', 'avatar-img2-review.json')

const personas = [
  ['calm', 'interviewer-calm'],
  ['supportive', 'interviewer-supportive'],
  ['pressure', 'interviewer-pressure'],
]

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file))
}

function scoreCandidate(file) {
  const png = readPng(file)
  let greenPixels = 0
  let skinishPixels = 0
  let opaqueSubjectPixels = 0
  let brightEyeOrShirtPixels = 0
  const total = png.width * png.height

  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i]
    const g = png.data[i + 1]
    const b = png.data[i + 2]
    const a = png.data[i + 3]
    const isGreen = g > 190 && r < 80 && b < 90
    if (isGreen) greenPixels += 1
    if (a > 80 && !isGreen) {
      opaqueSubjectPixels += 1
      if (r > g && g > b && r >= 120 && r <= 245 && g >= 75 && g <= 210 && b >= 45 && b <= 180) {
        skinishPixels += 1
      }
      if (r > 220 && g > 220 && b > 210) {
        brightEyeOrShirtPixels += 1
      }
    }
  }

  const subjectRatio = opaqueSubjectPixels / total
  const greenRatio = greenPixels / total
  const skinRatio = skinishPixels / Math.max(1, opaqueSubjectPixels)
  const brightRatio = brightEyeOrShirtPixels / Math.max(1, opaqueSubjectPixels)
  const subjectScore = Math.max(0, 1 - Math.abs(subjectRatio - 0.48) / 0.34)
  const greenScore = Math.min(1, greenRatio / 0.34)
  const skinScore = Math.max(0, 1 - Math.abs(skinRatio - 0.24) / 0.24)
  const brightScore = Math.max(0, 1 - Math.abs(brightRatio - 0.12) / 0.2)
  const score = Math.round((subjectScore * 0.3 + greenScore * 0.18 + skinScore * 0.34 + brightScore * 0.18) * 1000) / 10

  return {
    file,
    score,
    subjectRatio: Number(subjectRatio.toFixed(3)),
    greenRatio: Number(greenRatio.toFixed(3)),
    skinRatio: Number(skinRatio.toFixed(3)),
    brightRatio: Number(brightRatio.toFixed(3)),
  }
}

function listCandidates(slug) {
  if (!fs.existsSync(candidateDir)) return []
  return fs.readdirSync(candidateDir)
    .filter((name) => name.toLowerCase().endsWith('.png') && name.includes(slug))
    .map((name) => path.join(candidateDir, name))
}

function main() {
  fs.mkdirSync(finalDir, { recursive: true })
  const review = {
    candidateDir,
    finalDir,
    generatedAt: new Date().toISOString(),
    policy: [
      'Synthetic fictional identity only.',
      'Reject public-figure resemblance, celebrity likeness, or anything that looks like a real photo source.',
      'Reject bad eyes, teeth, collars, hands, green spill, plastic 3D doll look, anime/cartoon, and influencer stock-photo styling.',
    ],
    personas: {},
  }

  for (const [persona, slug] of personas) {
    const candidates = listCandidates(slug).map(scoreCandidate).sort((a, b) => b.score - a.score)
    review.personas[persona] = {
      slug,
      candidates,
      selected: candidates[0] ?? null,
      manualGate: 'Run visual review before copying to final .webp files.',
    }
  }

  fs.mkdirSync(path.dirname(reviewPath), { recursive: true })
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2))
  console.log(`Wrote ${reviewPath}`)
  for (const [persona] of personas) {
    const selected = review.personas[persona].selected
    console.log(`${persona}: ${selected ? `${path.basename(selected.file)} score=${selected.score}` : 'no candidates found'}`)
  }
}

main()
