export type Assistant = {
  id: string
  title: string
  chatbotId: string
}

export type Round = {
  id: string
  name: string
  status: 'open' | 'closed'
  createdAt: string
  closedAt: string | null
}

export type WorkshopState = {
  assistants: Assistant[]
  rounds: Round[]
  activeRoundId: string | null
  totals: Record<string, number>
  roundTotals: Record<string, Record<string, number>>
  totalVotes: number
  lanVoteUrl: string | null
  lanAdminUrl: string | null
  lanResultsUrl: string | null
  lastUpdatedAt: string
}
