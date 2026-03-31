import { startTransition, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Link, Route, Routes } from 'react-router-dom'
import { io } from 'socket.io-client'

import { AssistantWall } from './components/AssistantWall'
import { ResultsTable } from './components/ResultsTable'
import {
  activateRound,
  closeRound,
  createRound,
  fetchState,
  resetVotes,
  submitVote,
  updateAssistants,
} from './lib/api'
import type { Assistant, Round, WorkshopState } from './types'

const voterStorageKey = 'workshop-assistent-stemmer-voter-id'
const voteMapStorageKey = 'workshop-assistent-stemmer-votes'

function App() {
  const { state, loading, error, replaceState } = useWorkshopState()

  return (
    <Routes>
      <Route
        path="/"
        element={
          <DisplayPage
            state={state}
            loading={loading}
            error={error}
            replaceState={replaceState}
          />
        }
      />
      <Route
        path="/vote"
        element={
          <VotePage
            state={state}
            loading={loading}
            error={error}
            replaceState={replaceState}
          />
        }
      />
      <Route
        path="/results"
        element={
          <ResultsPage
            state={state}
            loading={loading}
            error={error}
            replaceState={replaceState}
          />
        }
      />
    </Routes>
  )
}

function useWorkshopState() {
  const [state, setState] = useState<WorkshopState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function applyState(nextState: WorkshopState) {
    startTransition(() => {
      setState(nextState)
      setLoading(false)
      setError(null)
    })
  }

  useEffect(() => {
    let cancelled = false

    async function loadInitialState() {
      try {
        const nextState = await fetchState()
        if (!cancelled) {
          applyState(nextState)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setLoading(false)
          setError(
            caughtError instanceof Error ? caughtError.message : 'Kunne ikke hente appens data.',
          )
        }
      }
    }

    void loadInitialState()

    const socket = io({
      transports: ['websocket', 'polling'],
    })

    socket.on('state:updated', (nextState: WorkshopState) => {
      if (!cancelled) {
        applyState(nextState)
      }
    })

    return () => {
      cancelled = true
      socket.close()
    }
  }, [])

  return { state, loading, error, replaceState: applyState }
}

type SharedPageProps = {
  state: WorkshopState | null
  loading: boolean
  error: string | null
  replaceState: (state: WorkshopState) => void
}

function DisplayPage({ state, loading, error, replaceState }: SharedPageProps) {
  const [isModalOpen, setModalOpen] = useState(false)
  const [assistantDrafts, setAssistantDrafts] = useState<Assistant[]>([])
  const [stableAssistants, setStableAssistants] = useState<Assistant[]>([])
  const [roundName, setRoundName] = useState('')
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!state) {
      return
    }

    setAssistantDrafts(state.assistants)
    setStableAssistants((previousAssistants) =>
      haveAssistantsChanged(previousAssistants, state.assistants) ? state.assistants : previousAssistants,
    )

    setSelectedRoundId((currentRoundId) => {
      if (currentRoundId && state.rounds.some((round) => round.id === currentRoundId)) {
        return currentRoundId
      }

      return state.activeRoundId || state.rounds[0]?.id || null
    })
  }, [state])

  if (loading) {
    return <LoadingShell message="Henter workshop-visning..." />
  }

  if (error || !state) {
    return <ErrorShell message={error || 'Appen kunne ikke indlæses.'} />
  }

  const activeRound = state.rounds.find((round) => round.id === state.activeRoundId) || null
  const selectedRound =
    state.rounds.find((round) => round.id === selectedRoundId) || activeRound || state.rounds[0] || null

  async function handleSaveAssistants() {
    setPendingAction('save-assistants')
    setActionError(null)

    try {
      const nextState = await updateAssistants(assistantDrafts)
      replaceState(nextState)
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Kunne ikke gemme assistenter.')
    } finally {
      setPendingAction(null)
    }
  }

  async function handleCreateRound() {
    setPendingAction('create-round')
    setActionError(null)

    try {
      const nextState = await createRound(roundName)
      setRoundName('')
      replaceState(nextState)
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Kunne ikke oprette runden.')
    } finally {
      setPendingAction(null)
    }
  }

  async function handleActivateRound(roundId: string) {
    setPendingAction(`activate-${roundId}`)
    setActionError(null)

    try {
      const nextState = await activateRound(roundId)
      replaceState(nextState)
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Kunne ikke aktivere runden.')
    } finally {
      setPendingAction(null)
    }
  }

  async function handleCloseRound(roundId: string) {
    setPendingAction(`close-${roundId}`)
    setActionError(null)

    try {
      const nextState = await closeRound(roundId)
      replaceState(nextState)
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Kunne ikke lukke runden.')
    } finally {
      setPendingAction(null)
    }
  }

  async function handleResetVotes() {
    if (
      !window.confirm(
        'Dette sletter alle tidligere runder og alle stemmer. Assistenternes opsætning bevares. Vil du fortsætte?',
      )
    ) {
      return
    }

    setPendingAction('reset-votes')
    setActionError(null)

    try {
      const nextState = await resetVotes()
      setSelectedRoundId(null)
      replaceState(nextState)
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Kunne ikke nulstille afstemningerne.',
      )
    } finally {
      setPendingAction(null)
    }
  }

  function handleAddAssistant() {
    setAssistantDrafts((currentAssistants) => [
      ...currentAssistants,
      createAssistantDraft(currentAssistants.length + 1),
    ])
  }

  function handleRemoveAssistant(assistantId: string) {
    setAssistantDrafts((currentAssistants) => {
      if (currentAssistants.length === 1) {
        return currentAssistants
      }

      return currentAssistants.filter((assistant) => assistant.id !== assistantId)
    })
  }

  return (
    <div className="display-shell">
      <div className="display-backdrop" />

      <header className="display-header">
        <div className="display-hero">
          <p className="section-label">Workshop Arena</p>
          <div className="display-meta">
            <div className="hero-stat">
              <span>Aktive embeds</span>
              <strong>{state.assistants.filter((assistant) => assistant.chatbotId).length}</strong>
            </div>
            <div className="hero-stat">
              <span>Stemmer i alt</span>
              <strong>{state.totalVotes}</strong>
            </div>
            <div className="hero-stat">
              <span>Runder oprettet</span>
              <strong>{state.rounds.length}</strong>
            </div>
          </div>
        </div>

        <div className="display-header__actions">
          <Link className="ghost-button" to="/results">
            Resultatvisning
          </Link>
          <div className="round-indicator">
            <span>Aktiv runde</span>
            <strong>{activeRound ? activeRound.name : 'Ingen aktiv runde'}</strong>
          </div>
          <button className="primary-button" onClick={() => setModalOpen(true)}>
            Åbn kontrolpanel
          </button>
        </div>
      </header>

      <AssistantWall assistants={stableAssistants} />

      {isModalOpen ? (
        <ControlModal
          assistants={assistantDrafts}
          state={state}
          selectedRound={selectedRound}
          roundName={roundName}
          actionError={actionError}
          pendingAction={pendingAction}
          onAssistantChange={(assistantId, field, value) => {
            setAssistantDrafts((currentAssistants) =>
              currentAssistants.map((assistant) =>
                assistant.id === assistantId ? { ...assistant, [field]: value } : assistant,
              ),
            )
          }}
          onClose={() => setModalOpen(false)}
          onCreateRound={handleCreateRound}
          onCloseRound={handleCloseRound}
          onActivateRound={handleActivateRound}
          onRoundNameChange={setRoundName}
          onSaveAssistants={handleSaveAssistants}
          onResetVotes={handleResetVotes}
          onAddAssistant={handleAddAssistant}
          onRemoveAssistant={handleRemoveAssistant}
          onSelectRound={(roundId) => setSelectedRoundId(roundId)}
        />
      ) : null}
    </div>
  )
}

type ControlModalProps = {
  assistants: Assistant[]
  state: WorkshopState
  selectedRound: Round | null
  roundName: string
  pendingAction: string | null
  actionError: string | null
  onAssistantChange: (assistantId: string, field: 'title' | 'chatbotId', value: string) => void
  onClose: () => void
  onCreateRound: () => void
  onCloseRound: (roundId: string) => void
  onActivateRound: (roundId: string) => void
  onRoundNameChange: (value: string) => void
  onSaveAssistants: () => void
  onResetVotes: () => void
  onAddAssistant: () => void
  onRemoveAssistant: (assistantId: string) => void
  onSelectRound: (roundId: string) => void
}

function ControlModal({
  assistants,
  state,
  selectedRound,
  roundName,
  pendingAction,
  actionError,
  onAssistantChange,
  onClose,
  onCreateRound,
  onCloseRound,
  onActivateRound,
  onRoundNameChange,
  onSaveAssistants,
  onResetVotes,
  onAddAssistant,
  onRemoveAssistant,
  onSelectRound,
}: ControlModalProps) {
  const activeRound = state.rounds.find((round) => round.id === state.activeRoundId) || null
  const selectedRoundCounts = selectedRound ? state.roundTotals[selectedRound.id] || {} : {}

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="control-modal"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="control-modal__header">
          <div className="control-modal__intro">
            <p className="section-label">Kontrolpanel</p>
            <h2>Afstemning, QR og iframe-opsætning</h2>
            <p className="muted-copy">
              Her styrer du hele sessionen: QR til deltagerne, runder til afstemning og opsætning af assistenternes titler og embeds.
            </p>
          </div>
          <div className="control-modal__meta">
            <div className="meta-pill">
              <span>Aktiv runde</span>
              <strong>{activeRound ? activeRound.name : 'Ingen'}</strong>
            </div>
            <div className="meta-pill">
              <span>Stemmer i alt</span>
              <strong>{state.totalVotes}</strong>
            </div>
            <div className="meta-pill">
              <span>Live assistenter</span>
              <strong>{state.assistants.filter((assistant) => assistant.chatbotId).length}</strong>
            </div>
          </div>
          <button className="ghost-button" onClick={onClose}>
            Tilbage til væggen
          </button>
        </div>

        {actionError ? <p className="feedback error">{actionError}</p> : null}

        <div className="control-modal__grid">
          <section className="panel-card panel-card--sticky">
            <div className="panel-card__header">
              <p className="section-label">Mobiladgang</p>
              <h3>QR til afstemningssiden</h3>
              <p className="panel-card__lede">
                Vis denne kode på storskærmen, så deltagerne kan hoppe direkte ind på deres telefoner.
              </p>
            </div>

            {state.lanVoteUrl ? (
              <>
                <div className="qr-card">
                  <QRCodeSVG value={state.lanVoteUrl} size={180} bgColor="transparent" fgColor="#16213e" />
                </div>
                <a className="inline-link" href={state.lanVoteUrl} target="_blank" rel="noreferrer">
                  {state.lanVoteUrl}
                </a>
              </>
            ) : (
              <p className="muted-copy">
                Ingen lokal netværksadresse fundet. Appen virker stadig lokalt, men QR-linket kunne ikke genereres.
              </p>
            )}

            {state.lanAdminUrl ? (
              <p className="muted-copy">
                Adminvisning: <a className="inline-link" href={state.lanAdminUrl}>{state.lanAdminUrl}</a>
              </p>
            ) : null}

            {state.lanResultsUrl ? (
              <p className="muted-copy">
                Resultatvisning:{' '}
                <a className="inline-link" href={state.lanResultsUrl} target="_blank" rel="noreferrer">
                  {state.lanResultsUrl}
                </a>
              </p>
            ) : null}
          </section>

          <section className="panel-card">
            <div className="panel-card__header">
              <p className="section-label">Runder</p>
              <h3>Start og styr afstemninger</h3>
              <p className="panel-card__lede">
                Opret en ny runde for hver diskussion. Kun én runde er åben ad gangen.
              </p>
            </div>

            <div className="round-creator">
              <input
                value={roundName}
                onChange={(event) => onRoundNameChange(event.target.value)}
                placeholder={`Runde ${state.rounds.length + 1}`}
              />
              <button
                className="primary-button"
                onClick={onCreateRound}
                disabled={pendingAction === 'create-round'}
              >
                {pendingAction === 'create-round' ? 'Opretter...' : 'Ny runde'}
              </button>
            </div>

            <div className="danger-zone">
              <div>
                <strong>Nulstil afstemninger</strong>
                <p className="muted-copy">
                  Sletter alle tidligere runder og alle stemmer, men beholder dine assistenter.
                </p>
              </div>
              <button
                className="danger-button"
                onClick={onResetVotes}
                disabled={pendingAction === 'reset-votes' || state.rounds.length === 0}
              >
                {pendingAction === 'reset-votes' ? 'Nulstiller...' : 'Slet runder og stemmer'}
              </button>
            </div>

            <div className="round-list">
              {state.rounds.length === 0 ? (
                <p className="muted-copy">Der er ingen runder endnu. Opret den første for at åbne afstemningen.</p>
              ) : (
                state.rounds.map((round) => {
                  const isActive = round.id === state.activeRoundId

                  return (
                    <article
                      className={`round-card ${selectedRound?.id === round.id ? 'round-card--selected' : ''}`}
                      key={round.id}
                    >
                      <button className="round-card__body" onClick={() => onSelectRound(round.id)}>
                        <div>
                          <strong>{round.name}</strong>
                          <span>{formatDateTime(round.createdAt)}</span>
                        </div>
                        <StatusPill label={isActive ? 'Åben' : 'Lukket'} tone={isActive ? 'open' : 'closed'} />
                      </button>

                      <div className="round-card__actions">
                        {isActive ? (
                          <button
                            className="ghost-button"
                            onClick={() => onCloseRound(round.id)}
                            disabled={pendingAction === `close-${round.id}`}
                          >
                            Luk runde
                          </button>
                        ) : (
                          <button
                            className="ghost-button"
                            onClick={() => onActivateRound(round.id)}
                            disabled={pendingAction === `activate-${round.id}`}
                          >
                            Genåbn
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </section>

          <section className="panel-card">
            <div className="panel-card__header">
              <p className="section-label">Resultater</p>
              <h3>Aktuel runde og totaler</h3>
              <p className="panel-card__lede">
                Brug resultatkortene til at læse både øjebliksbilledet og den samlede udvikling.
              </p>
            </div>

            {activeRound ? (
              <p className="muted-copy">
                Aktiv nu: <strong>{activeRound.name}</strong>
              </p>
            ) : (
              <p className="muted-copy">Ingen runde er aktiv lige nu.</p>
            )}

            <ResultsTable
              assistants={state.assistants}
              counts={selectedRoundCounts}
              heading={selectedRound ? `${selectedRound.name} (${sumCounts(selectedRoundCounts)} stemmer)` : 'Ingen runde valgt'}
            />

            <ResultsTable
              assistants={state.assistants}
              counts={state.totals}
              heading={`Total på tværs af alle runder (${state.totalVotes} stemmer)`}
            />
          </section>

          <section className="panel-card panel-card--full">
            <div className="panel-card__header">
              <p className="section-label">Assistenter</p>
              <h3>Redigér titler og chatbot-id'er</h3>
              <p className="panel-card__lede">
                Titlen bliver vist direkte over hver iframe, så publikum tydeligt kan se forskellen mellem sporene.
              </p>
            </div>

            <div className="assistant-settings__toolbar">
              <div className="meta-pill">
                <span>Antal spor</span>
                <strong>{assistants.length}</strong>
              </div>
              <button className="ghost-button" onClick={onAddAssistant}>
                Tilføj spor
              </button>
            </div>

            <div className="assistant-settings">
              {assistants.map((assistant, index) => (
                <article className="assistant-settings__card" key={assistant.id}>
                  <div className="assistant-settings__card-top">
                    <strong>Spor {index + 1}</strong>
                    <button
                      className="ghost-button ghost-button--small"
                      onClick={() => onRemoveAssistant(assistant.id)}
                      disabled={assistants.length === 1}
                    >
                      Fjern
                    </button>
                  </div>

                  <label>
                    Titel
                    <input
                      value={assistant.title}
                      onChange={(event) =>
                        onAssistantChange(assistant.id, 'title', event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Chatbot-id
                    <input
                      value={assistant.chatbotId}
                      onChange={(event) =>
                        onAssistantChange(assistant.id, 'chatbotId', event.target.value)
                      }
                      placeholder="6db9e0ce-dfcd-441d-8865-6a3c4fe24111"
                    />
                  </label>
                </article>
              ))}
            </div>

            <div className="panel-card__footer">
              <button
                className="primary-button"
                onClick={onSaveAssistants}
                disabled={pendingAction === 'save-assistants'}
              >
                {pendingAction === 'save-assistants' ? 'Gemmer...' : 'Gem iframe-opsætning'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function VotePage({ state, loading, error, replaceState }: SharedPageProps) {
  const [submittingAssistantId, setSubmittingAssistantId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [voterId, setVoterId] = useState('')
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(null)

  useEffect(() => {
    const existingVoterId = localStorage.getItem(voterStorageKey)

    if (existingVoterId) {
      setVoterId(existingVoterId)
      return
    }

    const newVoterId = createVoterId()
    localStorage.setItem(voterStorageKey, newVoterId)
    setVoterId(newVoterId)
  }, [])

  useEffect(() => {
    if (!state?.activeRoundId) {
      setSelectedAssistantId(null)
      return
    }

    const rawVoteMap = localStorage.getItem(voteMapStorageKey)
    const voteMap = rawVoteMap ? (JSON.parse(rawVoteMap) as Record<string, string>) : {}
    setSelectedAssistantId(voteMap[state.activeRoundId] || null)
  }, [state?.activeRoundId])

  if (loading) {
    return <LoadingShell message="Henter afstemningen..." />
  }

  if (error || !state) {
    return <ErrorShell message={error || 'Afstemningen kunne ikke indlæses.'} />
  }

  const activeRound = state.rounds.find((round) => round.id === state.activeRoundId) || null

  if (!activeRound) {
    return (
      <div className="vote-shell">
        <div className="display-backdrop" />
        <div className="vote-card vote-card--waiting">
          <p className="section-label">Workshop</p>
          <h1>Afstemningen er ikke åben endnu</h1>
          <p>Vent på, at workshoplederen starter næste runde på storskærmen.</p>
          <Link className="ghost-button" to="/">
            Tilbage til assistentvæggen
          </Link>
        </div>
      </div>
    )
  }

  const roundCounts = state.roundTotals[activeRound.id] || {}
  const activeRoundId = activeRound.id
  const selectedAssistant = state.assistants.find((assistant) => assistant.id === selectedAssistantId) || null

  async function handleVote(assistantId: string) {
    if (!voterId) {
      return
    }

    setSubmittingAssistantId(assistantId)
    setActionError(null)

    try {
      const nextState = await submitVote(activeRoundId, assistantId, voterId)
      const rawVoteMap = localStorage.getItem(voteMapStorageKey)
      const voteMap = rawVoteMap ? (JSON.parse(rawVoteMap) as Record<string, string>) : {}
      voteMap[activeRoundId] = assistantId
      localStorage.setItem(voteMapStorageKey, JSON.stringify(voteMap))
      setSelectedAssistantId(assistantId)
      replaceState(nextState)
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Kunne ikke afgive stemme.')
    } finally {
      setSubmittingAssistantId(null)
    }
  }

  return (
    <div className="vote-shell">
      <div className="display-backdrop" />
      <div className="vote-card">
        <div className="vote-card__header">
          <div className="vote-card__intro">
            <p className="section-label">Mobilafstemning</p>
            <h1>{activeRound.name}</h1>
            <p className="muted-copy">
              Vælg den assistent, der leverede den stærkeste oplevelse i denne runde.
            </p>
          </div>
          <Link className="ghost-button" to="/">
            Se assistenterne
          </Link>
        </div>

        <div className="vote-meta">
          <div className="meta-pill">
            <span>Runde</span>
            <strong>{activeRound.name}</strong>
          </div>
          <div className="meta-pill">
            <span>Stemmer nu</span>
            <strong>{sumCounts(roundCounts)}</strong>
          </div>
          <div className="meta-pill">
            <span>Valgmuligheder</span>
            <strong>{state.assistants.length}</strong>
          </div>
        </div>

        {actionError ? <p className="feedback error">{actionError}</p> : null}
        {selectedAssistant ? (
          <p className="feedback success">
            Din stemme er registreret på <strong>{selectedAssistant.title}</strong>.
          </p>
        ) : null}

        <div className="vote-grid">
          {state.assistants.map((assistant) => {
            const votes = roundCounts[assistant.id] || 0
            const isSelected = assistant.id === selectedAssistantId

            return (
              <article className={`vote-option ${isSelected ? 'vote-option--selected' : ''}`} key={assistant.id}>
                <div>
                  <p className="vote-option__index">Assistent</p>
                  <h2>{assistant.title}</h2>
                </div>
                <p className="vote-option__meta">{votes} stemmer i denne runde</p>
                <button
                  className="primary-button"
                  onClick={() => handleVote(assistant.id)}
                  disabled={Boolean(selectedAssistantId) || submittingAssistantId === assistant.id}
                >
                  {isSelected
                    ? 'Din stemme'
                    : submittingAssistantId === assistant.id
                      ? 'Sender...'
                      : 'Stem på denne'}
                </button>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ResultsPage({ state, loading, error }: SharedPageProps) {
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null)

  if (loading) {
    return <LoadingShell message="Henter resultatvisning..." />
  }

  if (error || !state) {
    return <ErrorShell message={error || 'Resultaterne kunne ikke indlæses.'} />
  }

  const selectedRound =
    state.rounds.find((round) => round.id === selectedRoundId) ||
    state.rounds.find((round) => round.id === state.activeRoundId) ||
    state.rounds[0] ||
    null
  const selectedRoundCounts = selectedRound ? state.roundTotals[selectedRound.id] || {} : {}
  const totalLeader = getTopAssistant(state.assistants, state.totals)
  const roundLeader = selectedRound
    ? getTopAssistant(state.assistants, selectedRoundCounts)
    : null

  return (
    <div className="results-shell">
      <div className="display-backdrop" />

      <section className="results-stage">
        <header className="results-stage__header">
          <div className="results-stage__intro">
            <p className="section-label">Live Resultater</p>
            <h1>Stemmer på assistenterne</h1>
            <p className="muted-copy">
              Visningen opdaterer live og samler både den valgte runde og de samlede totaler.
            </p>
          </div>

          <div className="results-stage__actions">
            <div className="hero-stat">
              <span>Stemmer i alt</span>
              <strong>{state.totalVotes}</strong>
            </div>
            <div className="hero-stat">
              <span>Runder</span>
              <strong>{state.rounds.length}</strong>
            </div>
            <Link className="ghost-button" to="/">
              Tilbage til væggen
            </Link>
          </div>
        </header>

        <div className="results-stage__spotlights">
          <article className="spotlight-card">
            <p className="section-label">Valgt Runde</p>
            <h2>{selectedRound ? selectedRound.name : 'Ingen runde endnu'}</h2>
            <div className="spotlight-card__metric">
              <span>Førende assistent</span>
              <strong>{roundLeader ? roundLeader.title : 'Ingen stemmer endnu'}</strong>
            </div>
            <div className="spotlight-card__metric">
              <span>Stemmer i runden</span>
              <strong>{sumCounts(selectedRoundCounts)}</strong>
            </div>
            <ResultsTable
              assistants={state.assistants}
              counts={selectedRoundCounts}
              heading={selectedRound ? `${selectedRound.name}` : 'Ingen runde valgt'}
            />
          </article>

          <article className="spotlight-card spotlight-card--accent">
            <p className="section-label">Samlet Total</p>
            <h2>Alle runder samlet</h2>
            <div className="spotlight-card__metric">
              <span>Førende assistent</span>
              <strong>{totalLeader ? totalLeader.title : 'Ingen stemmer endnu'}</strong>
            </div>
            <div className="spotlight-card__metric">
              <span>Stemmer i alt</span>
              <strong>{state.totalVotes}</strong>
            </div>
            <ResultsTable
              assistants={state.assistants}
              counts={state.totals}
              heading={`Total på tværs af alle runder`}
            />
          </article>
        </div>

        <section className="round-board">
          <div className="round-board__heading">
            <div>
              <p className="section-label">Pr. Runde</p>
              <h2>Alle afstemningsrunder</h2>
            </div>
            {state.activeRoundId ? (
              <div className="meta-pill">
                <span>Aktiv nu</span>
                <strong>{state.rounds.find((round) => round.id === state.activeRoundId)?.name}</strong>
              </div>
            ) : null}
          </div>

          {state.rounds.length === 0 ? (
            <article className="round-board__empty">
              <h3>Der er ingen runder endnu</h3>
              <p>Opret den første runde i kontrolpanelet for at starte resultatvisningen.</p>
            </article>
          ) : (
            <div className="round-board__grid">
              {state.rounds.map((round) => {
                const counts = state.roundTotals[round.id] || {}
                const leader = getTopAssistant(state.assistants, counts)
                const isSelected = selectedRound?.id === round.id

                return (
                  <button
                    className={`round-summary ${isSelected ? 'round-summary--selected' : ''}`}
                    key={round.id}
                    onClick={() => setSelectedRoundId(round.id)}
                  >
                    <div className="round-summary__top">
                      <div>
                        <strong>{round.name}</strong>
                        <span>{formatDateTime(round.createdAt)}</span>
                      </div>
                      <StatusPill
                        label={round.id === state.activeRoundId ? 'Åben' : 'Lukket'}
                        tone={round.id === state.activeRoundId ? 'open' : 'closed'}
                      />
                    </div>

                    <div className="round-summary__stats">
                      <div>
                        <span>Stemmer</span>
                        <strong>{sumCounts(counts)}</strong>
                      </div>
                      <div>
                        <span>Fører</span>
                        <strong>{leader ? leader.title : 'Ingen endnu'}</strong>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </section>
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone: 'open' | 'closed' }) {
  return <span className={`status-pill status-pill--${tone}`}>{label}</span>
}

function LoadingShell({ message }: { message: string }) {
  return (
    <div className="utility-shell">
      <div className="utility-card">
        <p className="section-label">Workshop</p>
        <h1>{message}</h1>
      </div>
    </div>
  )
}

function ErrorShell({ message }: { message: string }) {
  return (
    <div className="utility-shell">
      <div className="utility-card">
        <p className="section-label">Workshop</p>
        <h1>Noget gik galt</h1>
        <p>{message}</p>
      </div>
    </div>
  )
}

function haveAssistantsChanged(left: Assistant[], right: Assistant[]) {
  if (left.length !== right.length) {
    return true
  }

  return left.some((assistant, index) => {
    const otherAssistant = right[index]
    return (
      assistant.id !== otherAssistant.id ||
      assistant.title !== otherAssistant.title ||
      assistant.chatbotId !== otherAssistant.chatbotId
    )
  })
}

function sumCounts(counts: Record<string, number>) {
  return Object.values(counts).reduce((sum, current) => sum + current, 0)
}

function formatDateTime(dateString: string) {
  return new Intl.DateTimeFormat('da-DK', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(dateString))
}

function createVoterId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }

  return `voter-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createAssistantDraft(nextNumber: number): Assistant {
  return {
    id: `assistant-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: `Assistent ${nextNumber}`,
    chatbotId: '',
  }
}

function getTopAssistant(assistants: Assistant[], counts: Record<string, number>) {
  return [...assistants]
    .sort((left, right) => (counts[right.id] || 0) - (counts[left.id] || 0))[0] || null
}

export default App
