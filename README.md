# Tetris — Keyboard, Touch & Gamepad

A complete Tetris in plain HTML/CSS/JS. No build step, no dependencies.

## Features

- 10×20 board, 7-bag randomizer, hold (C/Shift), next queue, ghost piece
- Score / lines / level, best score in `localStorage`, pause, sound toggle, undo last placement
- Input: keyboard (DAS/ARR auto-shift, soft drop, lock delay), on-screen buttons, swipe, gamepad
- Responsive layout with mobile controls

## Run it

```bash
python3 -m http.server 5173
# visit http://127.0.0.1:5173
```

Or just open `index.html` in a browser.

## Controls

| Action | Keyboard |
| --- | --- |
| Move | ← → |
| Soft drop | ↓ |
| Hard drop | Space |
| Rotate | ↑ / X (CW), Z (CCW) |
| Hold | C / Shift |
| Pause | P / Esc |
| Undo | B |

## Structure

| Path | What it is |
| --- | --- |
| `index.html` | Shell + HUD |
| `game.js` | Board, pieces, loop, input, scoring |
| `styles.css` | Layout + theme |
