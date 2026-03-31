import { memo } from 'react'

import type { Assistant } from '../types'

type AssistantWallProps = {
  assistants: Assistant[]
}

function buildAssistantUrl(chatbotId: string) {
  return `https://kommune.applai.dk/chatbot/${chatbotId}?mode=standalone&widget=true&hasSidebar=true`
}

function AssistantPanel({
  assistant,
  index,
}: {
  assistant: Assistant
  index: number
}) {
  return (
    <article className="assistant-panel">
      <header className="assistant-panel__header">
        <div className="assistant-panel__topline">
          <p className="assistant-panel__eyebrow">AI Assistent</p>
          <span className="assistant-panel__slot">Spor {index + 1}</span>
        </div>
        <h2>{assistant.title}</h2>
        <p className="assistant-panel__subline">
          {assistant.chatbotId
            ? 'Live embed til sammenligning i workshoppen'
            : 'Denne plads er klar til endnu en assistent'}
        </p>
      </header>

      {assistant.chatbotId ? (
        <iframe
          title={assistant.title}
          src={buildAssistantUrl(assistant.chatbotId)}
          className="assistant-panel__frame"
          allow="local-network-access"
        />
      ) : (
        <div className="assistant-panel__placeholder">
          <strong>Mangler chatbot-id</strong>
          <p>Indsæt et chatbot-id i kontrolpanelet for at vise assistenten her.</p>
        </div>
      )}
    </article>
  )
}

const StableAssistantPanel = memo(
  AssistantPanel,
  (previousProps, nextProps) =>
    previousProps.index === nextProps.index &&
    previousProps.assistant.title === nextProps.assistant.title &&
    previousProps.assistant.chatbotId === nextProps.assistant.chatbotId,
)

export function AssistantWall({ assistants }: AssistantWallProps) {
  return (
    <section className="assistant-wall">
      {assistants.map((assistant, index) => (
        <StableAssistantPanel key={assistant.id} assistant={assistant} index={index} />
      ))}
    </section>
  )
}
