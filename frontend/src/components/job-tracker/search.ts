import type { Application } from './types'

export function matchesApplicationSearch(application: Application, search: string): boolean {
  const query = search.trim().toLowerCase()
  if (!query) return true
  const haystack = [
    application.company,
    application.position,
    application.city,
    application.notes,
    application.interviewer_info,
    application.feedback,
    application.stage,
    ...(application.todos ?? []).flatMap((todo) => [todo.title, todo.due ?? '']),
    application.review_summary.latest_status ?? '',
    application.review_summary.latest_avg_score != null
      ? application.review_summary.latest_avg_score.toFixed(1)
      : '',
  ]

  return haystack.some((value) => String(value).toLowerCase().includes(query))
}

export function filterApplicationsBySearch(applications: Application[], search: string): Application[] {
  if (!search.trim()) return applications
  return applications.filter((application) => matchesApplicationSearch(application, search))
}
