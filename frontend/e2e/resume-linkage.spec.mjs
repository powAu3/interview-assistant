import { expect, test } from '@playwright/test'

import { mockWsInitScript } from './fixtures/mock-ws.mjs'
import {
  COMMON_WS_BOOTSTRAP,
} from './fixtures/setup.mjs'
import {
  SAMPLE_CONFIG,
  SAMPLE_DEVICES,
  SAMPLE_OPTIONS,
  SAMPLE_RESUME_HISTORY,
  resolveApiPayload,
} from './fixtures/sample-data.mjs'

test.describe('shared resume mount', () => {
  test('switching the mounted resume in resume optimizer syncs to practice mode', async ({ context, page }) => {
    const config = {
      ...SAMPLE_CONFIG,
      has_resume: true,
      resume_active_history_id: 3,
      resume_active_filename: '张三_后端开发.pdf',
    }
    const history = {
      ...SAMPLE_RESUME_HISTORY,
      items: [
        {
          id: 2,
          original_filename: '李四_后端.pdf',
          file_size: 182304,
          created_at: Math.floor(Date.now() / 1000) - 86400,
          last_used_at: Math.floor(Date.now() / 1000) - 7200,
          parsed_ok: true,
          preview: '熟悉 Java / Spring Boot / MySQL / Redis，负责订单与库存链路。',
          parse_error: null,
          is_active: false,
        },
        {
          id: 3,
          original_filename: '张三_后端开发.pdf',
          file_size: 224512,
          created_at: Math.floor(Date.now() / 1000) - 3600,
          last_used_at: Math.floor(Date.now() / 1000) - 600,
          parsed_ok: true,
          preview: '3 年后端经验，负责高并发接口优化、缓存设计与监控治理。',
          parse_error: null,
          is_active: true,
        },
      ],
    }

    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url())
      const path = url.pathname
      const method = route.request().method()

      if (path === '/api/config') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(config),
        })
        return
      }

      if (path === '/api/options') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(SAMPLE_OPTIONS),
        })
        return
      }

      if (path === '/api/devices') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(SAMPLE_DEVICES),
        })
        return
      }

      if (path === '/api/resume/history') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(history),
        })
        return
      }

      if (/^\/api\/resume\/history\/\d+\/apply$/.test(path)) {
        const id = Number(path.split('/').slice(-2)[0])
        const selected = history.items.find((item) => item.id === id)
        history.items = history.items.map((item) => ({
          ...item,
          is_active: item.id === id,
        }))
        config.resume_active_history_id = id
        config.resume_active_filename = selected?.original_filename ?? null
        config.has_resume = true

        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ ok: true, history_id: id, length: 1200, preview: '已选用' }),
        })
        return
      }

      const payload = resolveApiPayload(path, method)
      await route.fulfill({
        status: payload && payload.detail === 'Not found' ? 404 : 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(payload ?? {}),
      })
    })

    await context.addInitScript(mockWsInitScript, { messages: COMMON_WS_BOOTSTRAP })
    await context.addInitScript(() => {
      localStorage.setItem('ia-color-scheme', 'vscode-light-plus')
    })

    await page.goto('/')
    await page.getByRole('tab', { name: '简历优化' }).click()
    await expect(page.getByText('张三_后端开发.pdf').first()).toBeVisible()

    await page.getByRole('button', { name: '选用' }).first().click()
    await expect(page.getByText('李四_后端.pdf').first()).toBeVisible()

    await page.getByRole('tab', { name: '模拟练习' }).click()
    await expect(page.getByText('李四_后端.pdf').first()).toBeVisible()
  })
})
