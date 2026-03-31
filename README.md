# AI Workshop Arena

Webapp til workshop-brug med:

- en storskærmsvisning med dynamiske AI-assistenter i iframes side om side
- et kontrolpanel i modal til runder, QR-kode, resultater og redigering af titler/chatbot-id'er
- en separat mobilvenlig afstemningsside, hvor hver enhed kan stemme én gang pr. runde
- en separat resultatvisning på `/results`
- lokal filpersistens i `data/store.json`

## Lokal kørsel

```bash
npm install
npm run dev
```

Det starter:

- frontend på `http://localhost:5173`
- backend på `http://localhost:8787`

Produktionslignende lokal kørsel:

```bash
npm run build
npm run start
```

## Render deploy

Projektet er klargjort til Render som en enkelt Web Service via [render.yaml](./render.yaml).

### 1. Læg projektet i GitHub

```bash
git init -b main
git add .
git commit -m "Prepare Render deployment"
git remote add origin <din-github-repo-url>
git push -u origin main
```

`dist`, `tmp` og testartefakter er ignoreret i `.gitignore`.

### 2. Opret service på Render

1. Opret en ny Blueprint eller Web Service fra GitHub-repoet.
2. Brug `main` som branch.
3. Vælg nærmeste EU-region.
4. Brug laveste passende instance type.

Render-konfigurationen er:

- build: `npm install && npm run build`
- start: `npm start`
- health check: `/api/state`

### 3. Sæt environment variables

Sæt disse i Render:

- `NODE_ENV=production`
- `PUBLIC_BASE_URL=https://<din-service>.onrender.com`

Appen bruger `PUBLIC_BASE_URL` til:

- QR-link til afstemningen
- public links til adminvisning
- public links til resultatvisning

Hvis `PUBLIC_BASE_URL` ikke er sat, forsøger appen at udlede base URL fra request host i produktion.

### 4. Test efter deploy

Åbn og test:

- `/`
- `/vote`
- `/results`

Minimumstest:

- opret en runde
- afgiv mindst to stemmer fra to forskellige sessioner
- verificér at live-resultater opdateres
- verificér at iframe-væggen forbliver stabil under afstemning

## Vigtige noter

- `data/store.json` ligger på Render-instansen og kan blive nulstillet ved redeploy eller restart
- det er accepteret i denne løsning
- Render free tier kan have cold starts, så åbn appen lidt før workshopstart

## Vigtige filer

- `server/index.mjs`: API, realtime-opdateringer og produktionens URL-logik
- `render.yaml`: Render deploy-konfiguration
- `data/store.json`: assistentopsætning, runder og stemmer
- `src/App.tsx`: routing, adminflow, mobilafstemning og resultatvisning
