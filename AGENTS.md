# 欢乐跳棋 (Chinese Checkers)

## Project Type

HTML5 Canvas single-page game. There is no build system and no `package.json`.

## Entry Points

- `web/start.html` - start screen
- `web/game.html` - main game UI
- `web/index.html` - redirects to the start screen

Single-player/local games can be opened directly in a browser. Online games require the Go signaling server in `server/`.

## Architecture

- Rendering: Canvas 2D
- Coordinate system: axial `(q, r)`
- Board: 121 cells = 61 center cells + 6 corners with 10 cells each
- Static board authority: `web/board_data.js`
- A player controls one or more seats/corners. Do not assume `playerId === seatId`.

## Key Files

| File | Purpose |
|------|---------|
| `web/board_data.js` | Static 121-cell board data, corner targets, id helpers, seat assignment |
| `web/js/config.js` | Shared constants |
| `web/js/board.js` | Board state, hex math, move generation, rendering |
| `web/js/game.js` | Main game controller |
| `web/js/player.js` | Player/controller model |
| `web/js/piece.js` | Piece model and piece rendering |
| `web/js/ai.js` | AI move evaluator |
| `web/js/audio.js` | Small generated sound effects |

## Corner Mapping

Every piece has a `seatId` that identifies its starting corner. Its target is the opposite corner:

```text
0 -> 3
1 -> 4
2 -> 5
3 -> 0
4 -> 1
5 -> 2
```

Cell id ranges:

```text
center: 1-61
corner 0: 62-71
corner 1: 72-81
corner 2: 82-91
corner 3: 92-101
corner 4: 102-111
corner 5: 112-121
```

## Seat Assignment

`getSeatAssignments(controllerCount, seatsPerPlayer)` is authoritative. Valid settings must satisfy `controllerCount * seatsPerPlayer <= 6`.

When the start screen is set to 1 human, the game creates a second AI controller, so `controllerCount` is 2.

```text
2x1: [[0], [3]]
2x2: [[0,1], [3,4]]
2x3: [[0,1,2], [3,4,5]]
3x1: [[0], [2], [4]]
3x2: [[0,1], [2,3], [4,5]]
4x1: [[0], [1], [3], [4]]
5x1: [[0], [1], [2], [3], [4]]
6x1: [[0], [1], [2], [3], [4], [5]]
```

## Rules

- Single step to an adjacent empty cell.
- Jump over any adjacent occupied cell into the next empty cell.
- After a jump, if another jump is available, the player may continue or end the turn.
- The game ends when the first controller has moved all controlled pieces into their respective target corners.

## Testing

- `node --check web/js/*.js web/board_data.js` - syntax check all JS
- Open `web/start.html`, try valid player/corner-count combinations, and verify pieces render and turns advance.
- Online mode: run `go test ./...` in `server/`, then start the Go server and verify 2-6 player rooms can connect before starting.
