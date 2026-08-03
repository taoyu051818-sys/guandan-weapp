# Guandan Master

**Language**

- English (current): `README.en.md`
- 简体中文: [README.md](./README.md)
- Русский: [README.ru.md](./README.ru.md)
- 日本語: [README.ja.md](./README.ja.md)
- 한국어: [README.ko.md](./README.ko.md)

Guandan Master is a Guandan card game project focused on local play, with LAN multiplayer support.  
The goal is to keep rules accurate, gameplay smooth, AI competitive, and architecture maintainable.

## Highlights

- Full game loop: dealing, playing, passing, initiative reset, settlement, leveling, tribute/return tribute.
- A-level challenge rules: supports pass/fail logic, downgrade after failure, and "three failures back to level 2".
- Four AI levels: `easy / medium / hard / master` with progressively stronger strategy layers.
- End-game UX: settlement page, victory animation, and clearer result messaging.
- Desktop packaging: supports Electron build for Windows.

## Gameplay Overview

### 1) Objective

- Four players, two teams (teammates sit opposite).
- Rank outcomes determine team level progression.
- Main win condition: reach level `A` and clear the A challenge.

### 2) Turn Rules

- Supports common Guandan combinations (single, pair, triple, straight, tube, plate, bomb, etc.).
- Players act clockwise and must beat the same play type with a stronger one.
- If all other players pass, the latest valid player leads a new trick.

### 3) Level Progression and A Challenge

- Regular levels progress based on finishing ranks.
- At level `A`, only specific rank combinations pass the challenge.
- Failed A attempts trigger downgrade rules, including streak-based penalties.

### 4) Tribute / Return Tribute

- Tribute flow is triggered by last-round ranks.
- Return tribute and anti-tribute paths are both supported.
- AI uses round context from this phase to adapt opening style.

## AI Strategy

### Difficulty Layers

- `easy`: rule-correct base play with beginner-friendly mistakes.
- `medium`: teammate-aware pressure control and low-value bomb avoidance.
- `hard`: 1-2 ply tactical lookahead and stronger initiative-chain planning.
- `master`: endgame search + opponent modeling (risk, bait, interception timing).

### Core Strategy Points

- Card memory and probability estimation.
- Team coordination signals.
- Initiative-chain oriented lead selection.
- Bomb timing based on expected value, not raw availability.
- Endgame specialization for small-hand scenarios.
- A-level challenge focused objective tuning.

## Tech Stack

- Frontend: React 18 + TypeScript + Vite
- State: Zustand
- UI/Animation: Tailwind CSS + Framer Motion
- Multiplayer: Socket.IO
- Desktop Build: Electron + electron-builder

## Project Structure

```text
src/
  components/   game and shared UI components
  pages/        menu, board, settlement, lobby, tutorial pages
  store/        global game state and flow
  lib/          rules engine, layered AI strategies, utilities
  workers/      AI worker thread
  types/        domain model types
server/         multiplayer backend
main.js         Electron main process
```

## Quick Start

### Install

```bash
npm install
```

### Run Frontend

```bash
npm run dev
```

### Optional Multiplayer Server

```bash
node server/index.js
```

### Check and Build

```bash
npm run check
npm run lint
npm run build
npm run electron:build:win
```

## License

This project is licensed under [Apache-2.0](./LICENSE).

## Community

If you enjoy Guandan, welcome to open an `Issue` or submit a `PR`.  
You are also invited to share real match cases and AI tuning ideas in Discussions.
