# GeoTaskServer

GeoTaskServer is a Node.js service for dispatching geographical model tasks to
heterogeneous computing nodes.  This source-only repository contains the
server implementation, scheduling logic, and test scripts.

Private experiment traces, execution logs, generated figures, manuscript
files, server addresses, and credentials are deliberately excluded.

## Local setup

1. Install a supported Node.js release and MongoDB.
2. Copy `config.example.json` to `config.json` and set local database values.
3. Copy `setting.example.js` to `setting.js`, then set service endpoints and
   any LLM credentials through environment variables.
4. Install dependencies and start the service:

```powershell
npm install
npm start
```

`setting.js` and `config.json` are intentionally ignored by Git.  Do not add
keys, passwords, node addresses, raw experiment data, or generated paper
artifacts to this repository.

## Useful commands

```powershell
npm run test:scheduling
npm run test:runtime-prediction
npm run test:experiment-trace
```

