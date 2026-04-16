import type { Application } from './types'

export function matchesApplicationSearch(application: Application, search: string): boolean {
  const query = search.trim().toLowerCase()
  if (!query) return true
  return (
    application.company.toLowerCase().includes(query)
    || application.position.toLowerCase().includes(query)
    || application.city.toLowerCase().includes(query)
    || application.notes.toLowerCase().includes(query)
  )
}

export function filterApplicationsBySearch(applications: Application[], search: string): Application[] {
  if (!search.trim()) return applications
  return applications.filter((application) => matchesApplicationSearch(application, search))
}
