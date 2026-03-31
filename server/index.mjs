import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import express from 'express'
import { Server as SocketServer } from 'socket.io'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const dataDir = path.join(rootDir, 'data')
const dataFile = path.join(dataDir, 'store.json')
const distDir = path.join(rootDir, 'dist')

const port = Number(process.env.PORT || 8787)
const isProduction = process.env.NODE_ENV === 'production'
const frontendPort = Number(process.env.FRONTEND_PORT || (isProduction ? port : 5173))
let cachedPublicBaseUrl = normalizeBaseUrl(process.env.PUBLIC_BASE_URL)
const authCookieName = 'workshop_auth'
const appPassword = 'Halsnæs'
const authCookieSecret = 'workshop-arena-auth-v1'
const authCookieMaxAgeMs = 1000 * 60 * 60 * 12

const defaultAssistants = [
  createAssistant('assistant-1', 'Assistent 1', '6db9e0ce-dfcd-441d-8865-6a3c4fe24111'),
  createAssistant('assistant-2', 'Assistent 2', '260c84d9-0878-45f5-8a80-c2e074c1a431'),
]

const defaultStore = {
  assistants: defaultAssistants,
  rounds: [],
  activeRoundId: null,
  votes: [],
}

const app = express()
const httpServer = createServer(app)
const io = new SocketServer(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
})

app.set('trust proxy', true)
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use((request, _response, next) => {
  updateCachedPublicBaseUrl(request)
  next()
})

app.get('/healthz', (_request, response) => {
  response.status(200).json({ ok: true })
})

app.get('/login', (request, response) => {
  if (isAuthenticatedRequest(request)) {
    response.redirect(normalizeReturnTo(request.query.returnTo))
    return
  }

  response
    .status(200)
    .type('html')
    .send(renderLoginPage({
      returnTo: normalizeReturnTo(request.query.returnTo),
      errorMessage: '',
    }))
})

app.post('/login', (request, response) => {
  const returnTo = normalizeReturnTo(request.body?.returnTo || request.query.returnTo)

  if (!passwordMatches(request.body?.password)) {
    response
      .status(401)
      .type('html')
      .send(renderLoginPage({
        returnTo,
        errorMessage: 'Forkert password. Prøv igen.',
      }))
    return
  }

  response.cookie(authCookieName, createAuthToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: authCookieMaxAgeMs,
    path: '/',
  })
  response.redirect(returnTo)
})

app.get('/logout', (_request, response) => {
  response.clearCookie(authCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
  })
  response.redirect('/login')
})

app.use((request, response, next) => {
  if (isAuthenticatedRequest(request)) {
    next()
    return
  }

  if (request.path.startsWith('/api/')) {
    response.status(401).json({ error: 'Password påkrævet.' })
    return
  }

  response.redirect(`/login?returnTo=${encodeURIComponent(request.originalUrl || '/')}`)
})

let store = await loadStore()

app.get('/api/state', (_request, response) => {
  response.json(buildClientState(_request))
})

app.put('/api/assistants', async (request, response) => {
  const assistants = request.body?.assistants

  if (!Array.isArray(assistants) || assistants.length < 1) {
    response.status(400).json({ error: 'Der skal være mindst 1 assistent.' })
    return
  }

  store.assistants = assistants.map((assistant, index) => ({
    id: normalizeText(assistant.id) || createAssistantId(index),
    title: normalizeText(assistant.title) || `Assistent ${index + 1}`,
    chatbotId: normalizeText(assistant.chatbotId),
  }))

  await persistAndBroadcast(response, 200, request)
})

app.post('/api/rounds', async (request, response) => {
  const nextRoundNumber = store.rounds.length + 1
  const roundName = normalizeText(request.body?.name) || `Runde ${nextRoundNumber}`
  const now = new Date().toISOString()

  if (store.activeRoundId) {
    store.rounds = store.rounds.map((round) =>
      round.id === store.activeRoundId
        ? { ...round, status: 'closed', closedAt: now }
        : round,
    )
  }

  const newRound = {
    id: randomUUID(),
    name: roundName,
    status: 'open',
    createdAt: now,
    closedAt: null,
  }

  store.rounds = [newRound, ...store.rounds]
  store.activeRoundId = newRound.id

  await persistAndBroadcast(response, 201, request)
})

app.post('/api/rounds/:roundId/activate', async (request, response) => {
  const roundId = request.params.roundId
  const targetRound = store.rounds.find((round) => round.id === roundId)

  if (!targetRound) {
    response.status(404).json({ error: 'Runden blev ikke fundet.' })
    return
  }

  const now = new Date().toISOString()
  store.rounds = store.rounds.map((round) => {
    if (round.id === roundId) {
      return {
        ...round,
        status: 'open',
        closedAt: null,
      }
    }

    if (round.id === store.activeRoundId) {
      return {
        ...round,
        status: 'closed',
        closedAt: now,
      }
    }

    return round
  })

  store.activeRoundId = roundId

  await persistAndBroadcast(response, 200, request)
})

app.post('/api/rounds/:roundId/close', async (request, response) => {
  const roundId = request.params.roundId
  const targetRound = store.rounds.find((round) => round.id === roundId)

  if (!targetRound) {
    response.status(404).json({ error: 'Runden blev ikke fundet.' })
    return
  }

  const now = new Date().toISOString()
  store.rounds = store.rounds.map((round) =>
    round.id === roundId
      ? {
          ...round,
          status: 'closed',
          closedAt: now,
        }
      : round,
  )

  if (store.activeRoundId === roundId) {
    store.activeRoundId = null
  }

  await persistAndBroadcast(response, 200, request)
})

app.post('/api/votes', async (request, response) => {
  const assistantId = normalizeText(request.body?.assistantId)
  const roundId = normalizeText(request.body?.roundId)
  const voterId = normalizeText(request.body?.voterId)

  if (!assistantId || !roundId || !voterId) {
    response.status(400).json({ error: 'assistantId, roundId og voterId er påkrævet.' })
    return
  }

  const round = store.rounds.find((entry) => entry.id === roundId)
  if (!round || round.status !== 'open' || store.activeRoundId !== roundId) {
    response.status(400).json({ error: 'Runden er ikke åben for stemmer.' })
    return
  }

  const assistant = store.assistants.find((entry) => entry.id === assistantId)
  if (!assistant) {
    response.status(400).json({ error: 'Assistenten blev ikke fundet.' })
    return
  }

  const existingVote = store.votes.find(
    (vote) => vote.roundId === roundId && vote.voterId === voterId,
  )

  if (existingVote) {
    response.status(409).json({ error: 'Denne enhed har allerede stemt i runden.' })
    return
  }

  store.votes.unshift({
    id: randomUUID(),
    assistantId,
    roundId,
    voterId,
    createdAt: new Date().toISOString(),
  })

  await persistAndBroadcast(response, 201, request)
})

if (await directoryExists(distDir)) {
  app.use(express.static(distDir))

  app.get(/^\/(?!api|socket\.io).*/, (_request, response) => {
    response.sendFile(path.join(distDir, 'index.html'))
  })
}

io.engine.use((request, response, next) => {
  if (isAuthenticatedCookieHeader(request.headers.cookie)) {
    next()
    return
  }

  response.writeHead(401, { 'Content-Type': 'text/plain' })
  response.end('Unauthorized')
})

io.on('connection', (socket) => {
  socket.emit('state:updated', buildClientState())
})

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Workshop server running on http://localhost:${port}`)
})

async function loadStore() {
  await fs.mkdir(dataDir, { recursive: true })

  try {
    const fileContent = await fs.readFile(dataFile, 'utf8')
    return normalizeStore(JSON.parse(fileContent))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }

    await fs.writeFile(dataFile, JSON.stringify(defaultStore, null, 2))
    return structuredClone(defaultStore)
  }
}

function normalizeStore(rawStore) {
  const assistants = Array.isArray(rawStore?.assistants) ? rawStore.assistants : []
  const rounds = Array.isArray(rawStore?.rounds) ? rawStore.rounds : []
  const votes = Array.isArray(rawStore?.votes) ? rawStore.votes : []

  return {
    assistants:
      assistants.length > 0
        ? assistants.map((assistant, index) =>
            createAssistant(
              normalizeText(assistant?.id) || createAssistantId(index),
              normalizeText(assistant?.title) || `Assistent ${index + 1}`,
              normalizeText(assistant?.chatbotId),
            ),
          )
        : structuredClone(defaultAssistants),
    rounds: rounds.map((round) => ({
      id: normalizeText(round.id) || randomUUID(),
      name: normalizeText(round.name) || 'Runde',
      status: round.status === 'open' ? 'open' : 'closed',
      createdAt: normalizeText(round.createdAt) || new Date().toISOString(),
      closedAt: normalizeNullableText(round.closedAt),
    })),
    activeRoundId: normalizeNullableText(rawStore?.activeRoundId),
    votes: votes
      .map((vote) => ({
        id: normalizeText(vote.id) || randomUUID(),
        assistantId: normalizeText(vote.assistantId),
        roundId: normalizeText(vote.roundId),
        voterId: normalizeText(vote.voterId),
        createdAt: normalizeText(vote.createdAt) || new Date().toISOString(),
      }))
      .filter((vote) => vote.assistantId && vote.roundId && vote.voterId),
  }
}

function buildClientState(request = null) {
  const totals = Object.fromEntries(store.assistants.map((assistant) => [assistant.id, 0]))
  const roundTotals = Object.fromEntries(store.rounds.map((round) => [round.id, {}]))
  let totalVotes = 0

  for (const vote of store.votes) {
    if (!store.assistants.some((assistant) => assistant.id === vote.assistantId)) {
      continue
    }

    totalVotes += 1
    totals[vote.assistantId] = (totals[vote.assistantId] || 0) + 1

    if (!roundTotals[vote.roundId]) {
      roundTotals[vote.roundId] = {}
    }

    roundTotals[vote.roundId][vote.assistantId] =
      (roundTotals[vote.roundId][vote.assistantId] || 0) + 1
  }

  return {
    assistants: store.assistants,
    rounds: [...store.rounds].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    activeRoundId: store.activeRoundId,
    totals,
    roundTotals,
    totalVotes,
    lanVoteUrl: buildAppUrl('/vote', request),
    lanAdminUrl: buildAppUrl('/', request),
    lanResultsUrl: buildAppUrl('/results', request),
    lastUpdatedAt: new Date().toISOString(),
  }
}

function buildAppUrl(pathname, request = null) {
  const publicBaseUrl = getPublicBaseUrl(request)
  if (publicBaseUrl) {
    return `${publicBaseUrl}${pathname}`
  }

  return buildLanUrl(pathname)
}

function buildLanUrl(pathname) {
  const lanIp = getLanIp()
  if (!lanIp) {
    return null
  }

  return `http://${lanIp}:${frontendPort}${pathname}`
}

function getLanIp() {
  const interfaces = os.networkInterfaces()

  for (const network of Object.values(interfaces)) {
    if (!network) {
      continue
    }

    for (const address of network) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address
      }
    }
  }

  return null
}

function getPublicBaseUrl(request = null) {
  const derivedBaseUrl = deriveBaseUrlFromRequest(request)
  if (derivedBaseUrl) {
    cachedPublicBaseUrl = derivedBaseUrl
  }

  return cachedPublicBaseUrl
}

function updateCachedPublicBaseUrl(request) {
  const derivedBaseUrl = deriveBaseUrlFromRequest(request)
  if (derivedBaseUrl) {
    cachedPublicBaseUrl = derivedBaseUrl
  }
}

function deriveBaseUrlFromRequest(request) {
  if (!request) {
    return null
  }

  const host = normalizeText(request.get('host'))
  if (!host) {
    return null
  }

  const isLocalHost =
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.startsWith('[::1]')

  if (isLocalHost && process.env.RENDER !== 'true') {
    return null
  }

  const protocol = request.protocol || 'https'
  return normalizeBaseUrl(`${protocol}://${host}`)
}

function normalizeBaseUrl(value) {
  const normalized = normalizeText(value)
  return normalized ? normalized.replace(/\/+$/, '') : null
}

function isAuthenticatedRequest(request) {
  return isAuthenticatedCookieHeader(request.headers.cookie)
}

function isAuthenticatedCookieHeader(cookieHeader) {
  const cookies = parseCookies(cookieHeader)
  return verifyAuthToken(cookies[authCookieName] || '')
}

function parseCookies(cookieHeader) {
  const result = {}

  if (!cookieHeader) {
    return result
  }

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = part.split('=')
    const name = rawName?.trim()
    if (!name) {
      continue
    }

    result[name] = decodeURIComponent(rawValueParts.join('=').trim())
  }

  return result
}

function createAuthToken() {
  const payload = 'authenticated'
  const signature = createHmac('sha256', authCookieSecret).update(payload).digest('hex')
  return `${payload}.${signature}`
}

function verifyAuthToken(token) {
  const normalizedToken = normalizeText(token)
  if (!normalizedToken) {
    return false
  }

  const [payload, signature] = normalizedToken.split('.')
  if (payload !== 'authenticated' || !signature) {
    return false
  }

  const expectedSignature = createHmac('sha256', authCookieSecret)
    .update(payload)
    .digest('hex')

  return safeEquals(signature, expectedSignature)
}

function passwordMatches(input) {
  const candidate = typeof input === 'string' ? input : ''
  return safeEquals(candidate, appPassword)
}

function safeEquals(left, right) {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function normalizeReturnTo(value) {
  const normalized = normalizeText(typeof value === 'string' ? value : '')
  if (!normalized || !normalized.startsWith('/') || normalized.startsWith('//')) {
    return '/'
  }

  return normalized
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function renderLoginPage({ returnTo, errorMessage }) {
  const safeReturnTo = escapeHtml(returnTo)
  const safeErrorMessage = escapeHtml(errorMessage)

  return `<!doctype html>
<html lang="da">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Login | AI Workshop Arena</title>
    <style>
      :root {
        color: #26221c;
        background:
          radial-gradient(circle at top left, rgba(255, 245, 230, 0.96), transparent 28%),
          radial-gradient(circle at top right, rgba(222, 212, 193, 0.48), transparent 22%),
          linear-gradient(180deg, #f6f1e8 0%, #efe8dc 52%, #ece3d6 100%);
        font-family: "Instrument Sans", system-ui, sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .card {
        width: min(460px, 100%);
        padding: 32px;
        border-radius: 28px;
        background: rgba(255, 252, 247, 0.95);
        border: 1px solid rgba(74, 63, 48, 0.12);
        box-shadow: 0 30px 90px rgba(55, 43, 29, 0.16);
      }
      .eyebrow {
        margin: 0 0 12px;
        color: #7c7367;
        font-size: 0.76rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-family: "Newsreader", Georgia, serif;
        font-size: 3rem;
        line-height: 0.98;
        letter-spacing: -0.04em;
      }
      p {
        margin: 14px 0 0;
        color: #5f5648;
        line-height: 1.55;
      }
      form {
        margin-top: 24px;
      }
      label {
        display: block;
        margin-bottom: 10px;
        color: #5f5648;
        font-size: 0.92rem;
        font-weight: 600;
      }
      input {
        width: 100%;
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid rgba(74, 63, 48, 0.2);
        background: rgba(255, 253, 249, 0.98);
        font: inherit;
      }
      input:focus {
        outline: none;
        border-color: rgba(198, 106, 61, 0.5);
        box-shadow: 0 0 0 4px rgba(198, 106, 61, 0.12);
      }
      button {
        width: 100%;
        margin-top: 16px;
        padding: 14px 18px;
        border: 0;
        border-radius: 999px;
        color: #fffdf8;
        background: linear-gradient(180deg, #d17a4f 0%, #b45b34 100%);
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .error {
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(169, 85, 72, 0.14);
        color: #a95548;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <p class="eyebrow">Beskyttet Workshop</p>
      <h1>Log ind</h1>
      <p>Hele workshop-sitet er beskyttet med password.</p>
      <form method="post" action="/login">
        <input type="hidden" name="returnTo" value="${safeReturnTo}" />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
        <button type="submit">Fortsæt</button>
      </form>
      ${safeErrorMessage ? `<div class="error">${safeErrorMessage}</div>` : ''}
    </main>
  </body>
</html>`
}

async function persistAndBroadcast(response, statusCode = 200, request = null) {
  await fs.writeFile(dataFile, JSON.stringify(store, null, 2))
  const clientState = buildClientState(request)
  io.emit('state:updated', clientState)
  response.status(statusCode).json(clientState)
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value)
  return normalized || null
}

function createAssistant(id, title, chatbotId = '') {
  return {
    id,
    title,
    chatbotId,
  }
}

function createAssistantId(index) {
  return `assistant-${index + 1}-${randomUUID().slice(0, 8)}`
}

async function directoryExists(directoryPath) {
  try {
    const stat = await fs.stat(directoryPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}
