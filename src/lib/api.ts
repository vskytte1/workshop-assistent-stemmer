import type { Assistant, WorkshopState } from '../types'

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string' ? payload.error : 'Der opstod en fejl i serveren.'
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

export function fetchState() {
  return request<WorkshopState>('/api/state')
}

export function updateAssistants(assistants: Assistant[]) {
  return request<WorkshopState>('/api/assistants', {
    method: 'PUT',
    body: JSON.stringify({ assistants }),
  })
}

export function createRound(name: string) {
  return request<WorkshopState>('/api/rounds', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function activateRound(roundId: string) {
  return request<WorkshopState>(`/api/rounds/${roundId}/activate`, {
    method: 'POST',
  })
}

export function closeRound(roundId: string) {
  return request<WorkshopState>(`/api/rounds/${roundId}/close`, {
    method: 'POST',
  })
}

export function submitVote(roundId: string, assistantId: string, voterId: string) {
  return request<WorkshopState>('/api/votes', {
    method: 'POST',
    body: JSON.stringify({ roundId, assistantId, voterId }),
  })
}
