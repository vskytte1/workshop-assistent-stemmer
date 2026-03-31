import type { Assistant } from '../types'

type ResultsTableProps = {
  assistants: Assistant[]
  counts: Record<string, number>
  heading: string
}

export function ResultsTable({ assistants, counts, heading }: ResultsTableProps) {
  const rows = [...assistants].sort(
    (left, right) => (counts[right.id] || 0) - (counts[left.id] || 0),
  )

  const maxVotes = rows.reduce((highest, assistant) => {
    const value = counts[assistant.id] || 0
    return value > highest ? value : highest
  }, 0)

  return (
    <section className="results-card">
      <div className="results-card__heading">
        <p className="section-label">Resultater</p>
        <h3>{heading}</h3>
      </div>

      <div className="results-table">
        {rows.map((assistant) => {
          const votes = counts[assistant.id] || 0
          const barWidth = maxVotes > 0 ? `${(votes / maxVotes) * 100}%` : '0%'
          const isLeader = votes > 0 && votes === maxVotes

          return (
            <div className="results-row" key={assistant.id}>
              <div className="results-row__label">
                <div className="results-row__title-wrap">
                  <strong>{assistant.title}</strong>
                  {isLeader ? <span className="results-row__leader">Fører</span> : null}
                </div>
                <span>{votes} stemmer</span>
              </div>
              <div className="results-row__meter">
                <div className="results-row__bar" style={{ width: barWidth }} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
