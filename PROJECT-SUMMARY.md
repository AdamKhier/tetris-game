# Tetris — Project Summary

> Reconstructed 22 Nov 2026 from the repository itself, not from chat history.

## What it is
A complete Tetris in plain HTML/CSS/JS: 10×20 board, 7-bag randomizer, hold, next queue, ghost piece, scoring/levels, best score in `localStorage`, pause, sound toggle and undo.

## Input
Keyboard with DAS/ARR auto-shift, soft drop and lock delay; on-screen buttons; swipe; gamepad.

| Action | Keyboard |
| --- | --- |
| Move | ← → |
| Soft / hard drop | ↓ / Space |
| Rotate | ↑ or X (CW), Z (CCW) |
| Hold | C / Shift |
| Pause | P / Esc |
| Undo | B |

## How to run
```bash
python3 -m http.server 5173
# http://127.0.0.1:5173
```
Or open `index.html` directly.

## Status
Finished. No dependencies, no build step.

## Git
`AdamKhier/tetris-game` — public.
