# AGENTS.md

## Obsidian sync (mandatory)

Every change in this project must be recorded in the Obsidian vault at `/home/adam/Obsidian/Vault 23` before work is reported as done: file edits, new files, deletions, commits, pushes, deploys, and decisions that change a plan.

1. **Log it**

   ```bash
   bash "/home/adam/Obsidian/Vault 23/_scripts/log-change.sh" "Tetris" "<what changed>"
   ```

2. **Update the note** `Projects/Tetris.md` when facts moved — status, deployment, commands, open gaps.
3. **Update `Home.md` and `Action Required.md`** if the headline numbers or open actions changed.
4. **End the reply** with `Obsidian synced: <what changed>`.

Do not skip this because a change looks small. Never write secrets, tokens, `.env` values or personal data into the vault.

Full procedure and the folder-to-note map: `/home/adam/Obsidian/Vault 23/Sync Protocol.md`.
