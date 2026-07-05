import { expect, test } from '@playwright/test'

import { COMMON_WS_BOOTSTRAP, installMocks } from './fixtures/setup.mjs'

test.describe('job tracker and review linkage', () => {
  test('compact job tracker keeps detail feedback clear and opens linked review timeline', async ({ context, page }) => {
    await installMocks(context, {
      messages: COMMON_WS_BOOTSTRAP,
      localStorage: {
        'ia-color-scheme': 'vscode-light-plus',
        'ia_app_mode': 'job-tracker',
      },
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    await expect(page.getByRole('heading', { name: '求职进度', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '查看 MiniMax 详情' }).click()

    await expect(page.getByText('详情已展开')).toBeVisible()
    await expect(page.getByRole('button', { name: '定位 MiniMax 详情' })).toBeVisible()
    await expect(page.getByRole('button', { name: '返回列表' })).toBeVisible()
    await expect(page.getByText('已聚焦 1 条 · 当前筛选 2 条')).toBeVisible()
    await expect(page.getByText('已有复盘时间线')).toBeVisible()

    await page.getByRole('button', { name: '看复盘' }).click()
    await expect(page.getByRole('heading', { name: '关联复盘' })).toBeVisible()
    await expect(page.getByText('二面复盘')).toBeVisible()
    await expect(page.getByText('一面复盘')).toBeVisible()
  })

  test('review detail shows the linked application timeline and can jump back to job tracker', async ({ context, page }) => {
    await installMocks(context, {
      messages: COMMON_WS_BOOTSTRAP,
      localStorage: {
        'ia-color-scheme': 'vscode-light-plus',
        'ia_app_mode': 'review',
      },
    })

    await page.goto('/')

    await expect(page.getByRole('tab', { name: '面试复盘' })).toHaveAttribute('aria-selected', 'true')
    const linkedReviewRow = page.locator('article').filter({ hasText: '二面复盘' }).first()
    await expect(linkedReviewRow).toBeVisible()
    await linkedReviewRow.click()

    await expect(page.getByText('已绑定求职记录')).toBeVisible()
    await expect(page.getByText(/2\s*场复盘/)).toBeVisible()

    await page.getByRole('button', { name: '去求职看板' }).click()
    await expect(page.getByRole('heading', { name: '求职进度', exact: true })).toBeVisible()
    await expect(page.getByText('已定位到 MiniMax · AI 产品工程师')).toBeVisible()
  })
})
