/**
 * Visual regression suite — pixel-diff snapshots of main pages.
 *
 * Snapshots are OS-specific (Linux font rendering on CI runner only).
 * To (re)generate baselines, run the GitHub Action
 * `update-visual-snapshots` (workflow_dispatch) which executes
 * `npm run test:e2e:update-snapshots` on Ubuntu and opens a PR with
 * the new images.
 *
 * Tagged @visual so they can be filtered. Tolerance is set in the
 * playwright.config.mjs `expect.toHaveScreenshot` block.
 */
import { test, expect } from '@playwright/test'
import { installMocks, COMMON_WS_BOOTSTRAP } from './fixtures/setup.mjs'

test.describe('@visual main pages', () => {
  test.beforeEach(async ({ context }) => {
    await installMocks(context, {
      messages: COMMON_WS_BOOTSTRAP,
      localStorage: {
        'ia-color-scheme': 'vscode-light-plus',
        'ia_answer_panel_layout': 'stream',
      },
    })
  })

  test('assist page', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '学习助手' })).toBeVisible()
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('assist.png', { fullPage: false })
  })

  test('practice page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: '模拟练习' }).click()
    await page.waitForTimeout(700)
    await expect(page).toHaveScreenshot('practice.png', { fullPage: false })
  })

  test('knowledge page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: '能力分析' }).click()
    await expect(page.getByText('薄弱点排名')).toBeVisible({ timeout: 8000 })
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('knowledge.png', { fullPage: false })
  })

  test('resume page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: '简历优化' }).click()
    await expect(page.getByText('粘贴目标岗位 JD')).toBeVisible({ timeout: 8000 })
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('resume.png', { fullPage: false })
  })
})
