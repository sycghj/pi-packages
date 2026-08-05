# AGENTS.md

## Monorepo Structure

This is a pnpm workspace monorepo.
Each package under `packages/` is a Pi extension published to npm under `@gotgenes/`.
Always launch Pi from the repo root — the root `.pi/settings.json` and `.pi/prompts/` are only discovered from CWD.
The working directory is always the repo root, so for a package-scoped script run `pnpm --filter @gotgenes/<pkg> run <script>` (or `pnpm -C packages/<pkg> run <script>`) from the root instead of `cd packages/<pkg> && pnpm run <script>`.
Before working on a specific package, load its `package-<name>` skill for architecture, priorities, and testing context.
Load skills inline — never dispatch a subagent to load skills.
When adding a new package, wire it into all of:

1. `release-please-config.json` — add to `packages` (component) and add `docs/plans` + `docs/retro` to `exclude-paths`.
2. `.release-please-manifest.json` — add the package at `0.0.0`.
3. `.pi/settings.json` — add the `../packages/<pkg>` load path.
   Add the `{ "source": "npm:@gotgenes/<pkg>", "extensions": [], "skills": [] }` disable entry (prevents double-load) **only after the package's first npm publish** — before that, the `npm:` reference makes Pi and the subagent launcher `npm install` a nonexistent package and fail (Refs #600).
4. `README.md` — add the package to the Packages table, and to the no-dedicated-skill note unless it ships a `package-<pkg>` skill.

Publishing is automatic — `scripts/publish-released.sh` derives the package list from release-please's `paths_released`, so no publish-script edit is needed.
A brand-new package's **first** release is the exception: npm Trusted Publishing cannot create a package that does not exist, so the CI `publish` job 404s on `v1.0.0`.
Publish the first version manually (`pnpm login`, then `pnpm --filter @gotgenes/<pkg> publish --access public --no-git-checks` — no `--provenance`), then configure the Trusted Publisher on npmjs.org (repo `gotgenes/pi-packages`, workflow `ci.yml`).
Every release after that publishes automatically (Refs #600).

If `release-please`'s CI job fails after it has already tagged/released, GitHub skips the downstream `publish` job — and a rerun does not recover it, since release-please finds nothing new to release and reports `releases_created: false`.
Recover with the manual-publish command above for the missing version, then advance `last-release-sha` in `release-please-config.json` to the release commit (the write-back step is skipped too) and commit `chore: advance release-please last-release-sha baseline [skip ci]` (Refs #646).

A cross-package change bumping a dependent package to a **same-day-published** sibling hits pnpm's 24h `minimumReleaseAge` supply-chain gate — CI's `--frozen-lockfile` install and local `pnpm exec` hooks fail `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`.
`minimumReleaseAgeExclude` does not fix it (honored at resolution, ignored by pnpm's lockfile verification pass); the repo sets `trustLockfile: true` in `pnpm-workspace.yaml` to trust the reviewed lockfile and skip that re-verification.
Do not remove it, and do not reach for `minimumReleaseAge: 0` (which also disables the delay for a fresh `pnpm add`).
Refs #626.

When adding a new internal docs subdirectory (retro, plans, architecture, decisions, assets), add its path to `exclude-paths` in `release-please-config.json`.
Commits that only touch excluded paths do not trigger releases.

### Docs-in-distribution convention

The published npm tarball ships runtime code, user-facing docs, and nothing else — no dev files (`test/`, `tsconfig.json`, `vitest.config.ts`, `AGENTS.md`, `.pi/`, `.prettierignore`) and no internal working docs.
Every package uses a `files` allowlist in `package.json`; no package uses `.npmignore` (Refs #484, #523).
A bare directory entry (e.g. `"src"`) is recursive, so runtime code ships without allowlist edits as it grows; npm always auto-includes `package.json`, `README*`, and `LICENSE*` regardless of the allowlist.
List only the additional top-level ship targets explicitly: `dist` (built type bundles), `schemas`, `config/*.example.json`, and user-doc paths.
Ship the docs the README links to (`docs/*.md` plus referenced subdirectories such as `guides`/`migration`/`assets`/`architecture`/`decisions`), never a bare `"docs"` entry — that would also ship `docs/plans` and `docs/retro`.
A package with no user-facing docs omits any `docs` entry from its allowlist entirely.
A link from a shipped doc into a non-shipped path (`docs/decisions/`, `docs/architecture/`) resolves to nothing in the tarball — use an absolute GitHub URL, or add the target to `files` (Refs #647).
Verify the allowlist with `pnpm --filter <pkg> exec pnpm pack --pack-destination /tmp` and inspect `tar tzf` for the expected file set — confirm it contains runtime code and user docs, and excludes `test/`, dev config, and internal docs.
Run `pnpm fallow dead-code` locally before pushing a new or dependency-changed package — CI gates on it, and `devDependencies` copied from a sibling package often include unused entries.

### Architecture-doc conventions

Every package's `docs/architecture/architecture.md` module-tree entries describe **current behavior** — what each module is now.
Cite an issue in a module-tree entry **only** when the ref encodes an active constraint (a lint-guarded boundary, an ADR string boundary, a structural invariant); all other provenance belongs in git log and `docs/architecture/history/`, never in the tree (the "relocated #559, dissolved #505, renamed #510…" trail).
Without this discipline, the per-change doc-update commits that append provenance re-inflate the tree — the debt #601 and #605 paid down in bulk for pi-permission-system and pi-subagents.
`/finish-phase`'s bounded doc-hygiene step holds each phase's touched module-tree entries to this standard (Refs #601, #605, #606, #607).

## Workflow

- Keep scope tight.
- Prefer small, reversible changes.
- Preserve intentional behavior unless there is a clear reason to change it.
- Ask before removing functionality or changing defaults.
- To check a GitHub issue/PR's state (including upstream repos), use `gh issue view N --repo owner/repo`, not web search.
- Never run a state-mutating command (`gh issue close`, `gh pr merge`, `git push`) to discover what it does — it executes.
  Probe with a read-only query (`gh api .../issues/N --jq .state`) or `--help` (Refs #661).
- For Pi SDK internals (prompt assembly, caching, session lifecycle), read Pi's own source at the sibling checkout `../pi` when present, rather than the installed `dist/` bundles or their sourcemaps.
  Dispatch an `Explore` subagent with `model: "sonnet-5"` for a multi-hop trace there (e.g. "how does `ui.custom` pass keybindings to the factory?") — a targeted read of a known file is fine inline, but a hunt costs 5–10 greps of this session's context, and `Explore`'s haiku default is too weak for the reasoning.
  The checkout tracks Pi's `main` and runs ahead of the pinned dependency.
  Read it for mechanism, but confirm any API you design around exists in the installed version first — `grep` the types under `node_modules/.pnpm/@earendil-works+pi-coding-agent@*/` (Refs #661).

### Tool-injected messages

The `pi-autoformat` extension emits a `[pi-autoformat] Formatted N file(s)` message after `Edit`/`Write`.
It is informational — not a turn boundary.
Continue the current step (e.g. Red→Green→Commit) until it is complete.
It also reflows what you just wrote (line wrapping, quote style), so an `oldText` built from the layout you emitted can fail to match — re-read a region you just edited before editing it again.
It also joins a line ending in `:` with the sentence after it — to add a sentence there, start a new paragraph, not a new line.

### Stale prompt-template expansion

A slash command's expanded body is a snapshot from when the Pi process loaded it — so after this session edits a `.pi/prompts/*.md` template, a later same-process invocation of that command can run the **pre-edit** copy.
When the pasted prompt body contradicts the on-disk file (e.g. you just changed `/ship-issue` and its steps read stale), treat the **on-disk file as authoritative** and follow it, not the injected text (Refs #586).

### Edit tool batches

A multi-edit `Edit` call is atomic: if one `oldText` fails to match, the whole batch is rejected and nothing is applied.
Each `edits[]` entry has exactly one `oldText`/`newText` — put a second replacement in a second array entry, never as `oldText2`/`newText2`.
Extra suffixed keys are silently ignored while the tool still reports `Successfully replaced N block(s)`, so count reported blocks against intended edits (Refs #605).
After a rejection, re-apply every intended edit (not just the ones you retried) and run `pnpm run check` to confirm none were silently dropped — but `tsc` passes on a dropped `import type` removal (an unused type import is not an error), so re-read the affected region rather than trusting the check alone.
When an edit's `oldText` would span a decorative comment rule (a long run of `─`/`═`) or a width-padded table row, anchor on adjacent unique code lines rather than the padded span itself — miscounting it fails the whole atomic batch, and `rumdl fmt` does not re-pad tables for you.
If you delete such a block by line number with `sed`, re-read the region afterward to confirm you did not remove an enclosing brace.
A multi-line `perl -0777`/`sed` regex substitution across many similar blocks is a trap — a non-greedy `.*?` group spans block boundaries and silently corrupts a neighbor; collapse repeated multi-line literals with per-block `Edit` calls and reserve scripted substitution for single-line per-symbol renames (Refs #525).
A replacement containing backslashes is a trap even as a single-line rename — shell, perl, and the regex engine each consume an escape level.
Use `Edit` (Refs #653).
When wrapping existing lines in a new enclosing block (a `describe`, function, or `try`), emit the opening and closing braces as two `edits[]` entries in one `Edit` call (or use `Write`) — a lone opening brace fails the whole file parse, and the close is too far from the open to anchor in the same `oldText`.

### Multi-session issue lifecycle

Larger issues span multiple sessions, each handling one stage.
The standard flow is:

1. `/plan-issue #N` — read the issue, explore the codebase, produce a numbered plan, commit it.
2. `/tdd-plan` or `/build-plan` — execute the plan (TDD for code changes, build for docs/config).
   Two fresh-context subagents bracket the implementation: a `tidy-first-assessor` at the **start** (after the green baseline, before the first change) proposes preparatory refactorings that make the change easy (Kent Beck's Tidy First), and a `pre-completion-reviewer` at the **end** runs the quality gate.
3. Pre-completion review — dispatched automatically at the end of step 2; a fresh-context `pre-completion-reviewer` subagent runs deterministic checks and a judgment checklist before recommending `/ship-issue`.
4. `/ship-issue #N` — push, verify CI, close the issue, merge the release-please PR.
5. `/retro` — review the session(s) for workflow improvements, persist retro notes.

Each prompt template writes a stage entry to `docs/retro/NNNN-<slug>.md` (or `packages/<PKG>/docs/retro/`) before finishing.
These entries accumulate across sessions and serve as the cross-session context bridge — when a later stage starts, it reads the retro file to pick up decisions, observations, and warnings from prior sessions.

Release batching is plan-driven: `/plan-improvements` annotates each roadmap step with a grep-able `Release:` tag (and a `Release batches` subsection), `/plan-issue` derives a `Release Recommendation` from those annotations, and `/ship-issue` reads the plan's `**Release:**` marker early — asking only when it is `mid-batch — defer`, otherwise releasing now.
A `refactor:`/`style:`/`test:`/`build:`/`ci:` commit is a `hidden: true` changelog type and does not cut a release on its own; such work lands on `main` and auto-batches into the next `feat:`/`fix:`/unhidden-`docs:` release.
So a refactor-only plan's `Release Recommendation` rationale must not claim it will cut a release (Refs #479).
Release is driven by the release-please PR merge over `main` commits, independent of any issue's open/closed state: holding an issue open does not defer its already-merged `fix:`/`feat:` commits from releasing at the next merge, and the only lever to defer a release is leaving the release-please PR unmerged (Refs #625).

Release-please PRs merge by **rebase** (linear `chore: release main`), per `defaultMergeMethod: rebase` (`.pi/extensions/pi-github-tools/config.json`) — set in `cacc724f`.
Prefer `release_pr_merge`; on its `UNSTABLE`-no-checks refusal, fall back to `gh pr merge <N> --rebase`, never `--merge`.
Do not infer the method from older history — releases before `cacc724f` are merge commits.
This holds for releases cut outside `/ship-issue` (e.g. an extended review session), where the ship-prompt guidance is not loaded.

The `release-please` CI job pins a `last-release-sha` baseline in `release-please-config.json`, auto-advanced by a `ci.yml` write-back step after each release, to cap its history walk (Refs #468).
Do not remove either — without the baseline, release-please walks the default 500 commits every run and the deep walk fails with `Bad credentials` (secondary rate limit) on this monorepo.
The write-back reads the release commit from a path-prefixed `<path>--sha` output, not a top-level `sha`: every component lives at a non-root path, so release-please emits no top-level `sha`.

### Background agent guardrails

When delegating lint-fix or refactoring work to a background agent:

- Do not change function semantics (removing comparisons, altering control flow, removing defensive checks).
- Only add `eslint-disable` comments or make type-safe transformations (removing unused imports, adding type annotations).
- Include `pnpm -r run test` as a verification step before reporting completion.

### Parallel peer sessions (git worktrees)

Run two agents in parallel by giving each its own git worktree and its own interactive Pi session.
Use `/worktree <issue>` (the project-local `.pi/extensions/worktree.ts` command) or `scripts/worktree-new.sh <issue> [initial-command]` directly.
The launcher creates branch `issue-<N>-<slug>` off `origin/main`, checks out a worktree at `~/development/pi/pi-packages-worktrees/issue-<N>`, runs `pnpm install`, and spawns a new WezTerm tab whose CWD is the worktree, launching `pi --approve "/plan-issue <N>"`.

Key properties:

- CWD is set at spawn (`wezterm cli spawn --cwd`), never via `cd` — the peer session is born in its worktree, so the `pi-permission-system` `external_directory` gate never fires for its own work.
- `--approve` is required: Pi keys project trust by directory path, so each fresh worktree is untrusted and would otherwise block on a startup trust prompt.
- The launcher also runs `mise trust` on the worktree: `mise` gates trust by config-file path too, so a fresh worktree's `mise.toml` `[env]` block (the `scripts/bin` `npm -> pnpm` PATH shims) is skipped until trusted — trusting before `pnpm install` keeps the shims on PATH for both the install and the peer session.
- The initial slash command is passed as Pi's first positional message, which interactive mode runs through `session.prompt()` — the same path as typed input — so the prompt template expands and runs on startup.
- Tear down with `scripts/worktree-rm.sh <issue> [--delete-branch]`.

Convergence (the two-session ship flow):

The trunk `/ship-issue` assumes linear `main` and breaks for a worktree branch, so the convergence is split across the peer and root sessions:

1. Peer session — `/ship-worktree <N>`: run pre-push checks, write a **ship** stage note (committed on the branch so it rides the land), then `git fetch origin` + `git rebase origin/main`.
   The peer never touches `main`, never pushes the branch, never force-pushes — worktrees share the same `.git`, so the root sees the branch ref directly.
   The peer writes only stage breadcrumbs (planning/TDD/ship); the deliberate, interactive final `/retro` does not run here.
2. Root session — `/land-worktree <N>`: `git merge --ff-only <branch>` into `main`, push, verify CI, `issue_close`, then release.
   If the ff-merge is not a fast-forward (another peer landed first), the peer re-runs `/ship-worktree <N>` to rebase onto the new `origin/main`.
3. Release is the root's serialized responsibility — only the root merges the single release-please PR (by rebase), so peers never race on it.
   It honors the plan's `**Release:**` marker: `mid-batch — defer` leaves the PR open.
4. `/land-worktree` ends by running `scripts/worktree-rm.sh <N> --delete-branch`, then names `/retro <N>` as the final step.
5. Root session — `/retro <N>`: the deliberate, interactive final retrospective, run at the root on `main` after the land (commits straight to `main`, no branch needed) — mirroring the trunk flow's terminal `/retro`.
   Run it on your preferred model; the stage breadcrumbs from the peer session are already on `main` for it to synthesize.

Guardrails:

- Partition work by package — one package per peer.
  Two peers touching `pnpm-lock.yaml`, `release-please-config.json`, or the same package's source is the main parallel-work hazard.
- `/ship-issue` is trunk-only; ship a worktree branch with `/ship-worktree` (peer) + `/land-worktree` (root), never `/ship-issue`.
- Whoever lands second rebases first: if `/land-worktree`'s ff-merge fails, the peer re-runs `/ship-worktree` to rebase onto the new `origin/main` (a non-linear merge into `main` is rejected by design).
- Land a pending worktree branch before committing unrelated work to `main`.
  An intervening root commit to `main` stales the peer's completed `/ship-worktree` rebase, so the ff-merge is rejected and the peer must re-rebase (Refs #549).
- A first launch in each worktree reinstalls `.pi/npm/` (gitignored, so it does not carry over) — a one-time cost Pi handles automatically.

### Session naming convention

Each prompt template calls `set_session_name` (from `pi-session-tools`) to label the session automatically:

| Stage                | Session name format            |
| -------------------- | ------------------------------ |
| PR review            | `#N PR Review — <title>`       |
| Planning             | `#N Planning — <title>`        |
| TDD implementation   | `#N TDD — <title>`             |
| Build implementation | `#N Build — <title>`           |
| Shipping             | `#N Ship — <title>`            |
| Worktree ship (peer) | `#N Ship (worktree) — <title>` |
| Worktree land (root) | `#N Land — <title>`            |
| Retrospective        | `#N Retrospective — <title>`   |

Each prompt template sets the appropriate name automatically via `set_session_name`.

### Retro file format

Get each stage timestamp from `date -u +"%Y-%m-%dT%H:%M:%SZ"` — never write one from memory; a model has no clock (Refs #653).

Retro files use YAML frontmatter and accumulate `## Stage:` entries:

````markdown
---
issue: 42
issue_title: "Extract ExtensionPaths value object"
---

# Retro: #42 — Extract ExtensionPaths value object

## Stage: Planning (2026-05-20T14:00:00Z)

### Session summary

...

### Observations

...

## Stage: Implementation — TDD (2026-05-21T10:00:00Z)

### Session summary

...

### Observations

...

## Stage: Final Retrospective (2026-05-22T16:00:00Z)

### Session summary

...

### Diagnostic details

- **Model-performance correlation** — Explore subagent ran on claude-sonnet-4-20250514; appropriate for read-only codebase search.
- **Escalation-delay tracking** — 8 consecutive tool calls on the same lint error in TDD step 3 before switching approach.
- **Feedback-loop gap analysis** — `pnpm run check` ran only after step 6; should have run after step 4 (interface change).
````

The `### Diagnostic details` subsection is optional — include it only when the `/retro` prompt's diagnostic lenses produce actionable findings.
Omit it when all lenses find nothing notable.

### Pre-completion reviewer

The `pre-completion-reviewer` agent (`.pi/agents/pre-completion-reviewer.md`) is dispatched automatically by `/tdd-plan` and `/build-plan` after all implementation steps are complete.
It runs as a fresh-context subagent (no implementation bias) and produces a PASS / WARN / FAIL report covering: deterministic checks (`pnpm run check`, `pnpm run lint`, `pnpm run test`, `pnpm fallow dead-code`), acceptance criteria verification, conventional commits, documentation staleness, code design, test artifacts, Mermaid diagrams, cross-step invariant preservation (a later phase step must not regress an earlier step's documented `Outcome:` invariant), and planned follow-up filing (a follow-up the plan names must carry a recorded issue number).
The `pre-completion` skill (`.pi/skills/pre-completion/SKILL.md`) encodes the dispatch protocol loaded by both templates.
The agent's `model:` frontmatter must use the `provider/id` alias form the Pi CLI/UI accepts (e.g. `anthropic/claude-sonnet-4-6`); an ID absent from the model registry silently falls back to the parent session's model.

### Craftsmanship subagents

Two read-only subagents carry the micro / craftsmanship lens (SOLID at the method scale, Test-Driven **Design**, self-documenting code) so it is examined systematically rather than left to whoever has spare context:

- `tidy-first-assessor` (`.pi/agents/tidy-first-assessor.md`) — dispatched at the **start** of `/tdd-plan` (and `/build-plan` for code-touching plans) via the `tidy-first` skill (`.pi/skills/tidy-first/SKILL.md`).
  It reads the files the change will touch and proposes preparatory `refactor:`/`test:` commits that shrink the change (make the change easy, then make the easy change).
  Advisory; the impl agent triages.
  Strictly change-scoped — it must not propose tidying code the change will not touch.
- `craftsmanship-scout` (`.pi/agents/craftsmanship-scout.md`) — dispatched during `/plan-improvements` discovery (Step 5).
  It **opens** (does not grep) the largest test files and sweeps method-level design, naming, and test-code quality (taxonomy Category G) into a scored debt inventory, flagging each cluster concentrated vs. scattered.
  The concentrated/scattered split drives the deferral gate: concentrated debt in a hot area is a legitimate craftsmanship lean phase; scattered trivia defers to the `tidy-first` boy-scout path.

Both use the same `provider/id` model-alias rule as the reviewer above.

Use `/retro-note` to capture quick observations mid-session without interrupting the workflow.
Use `scripts/issue-context.sh <N>` to gather all available context for an issue (plan, retro, commits, branches) when bootstrapping a new session.

## Code Style

This project uses **pnpm** exclusively — never `npm` or `npx`.
Before implementing, refactoring, or reviewing code, load the `code-design` skill — it covers naming, SOLID and structural design heuristics, TypeScript conventions, pnpm/ES2024 tooling rules, Pi SDK boundaries, and Biome/ESLint conflict workarounds.
Use `colgrep` for intent-based codebase exploration and convention discovery; use `grep` for exact symbol matching.
Quote a glob pattern meant for a command rather than the shell — `--include='*.ts'`, `find . -name '*.ts'`.
Unquoted, it expands against the cwd first: bash silently substitutes a matched filename, and zsh aborts with `no matches found`.
Do not start a bash word with `=` — zsh's `equals` expansion reads `=word` as a command-path lookup, so a decorative `echo ===` separator aborts with `zsh:1: == not found` and discards the rest of an `A; B; C` chain.
Use `echo ---`.
A shell snippet quoted inside a `/* */` block comment must not contain `*/` — a `sed 's/,.*//'` closes the comment and breaks the file's parse.
Use `cut -d, -f1`.

## Markdown

Before writing or editing markdown files, load the `markdown-conventions` skill — it covers the formatting rules (one-sentence-per-line, fence languages, list numbering, table style) and the YAML frontmatter schema for plans and retros.

## Mermaid

Before authoring or reviewing Mermaid diagrams, load the `mermaid` skill.

## Testing

Before writing or debugging tests, load the `testing` skill for Vitest mock patterns and TDD planning rules.

## Commits

Use Conventional Commits.
For a breaking change, place the `!` **after** the scope: `fix(pkg)!:` / `feat(pkg)!:` — never `fix!(pkg):`, which the grammar rejects so release-please drops the commit and skips the major bump (Refs #452).
A `commit-msg` hook runs [`committed`](https://github.com/crate-ci/committed) (wired via `prek`, installed by `pnpm install`) and enforces this deterministically: a malformed header fails locally before it can mis-version a release (Refs #457, #468).
When a `prek` hook fails to **install** (a network error building the hook env — e.g. `uv` fetching `setuptools`, not a lint/grammar failure), it blocks the commit without having run any check.
Run the equivalent gate manually (`pnpm exec rumdl check`, `pnpm run lint`) and, once clean, commit with `--no-verify`.
This applies only to a hook *install* failure — a hook that runs and *reports* a violation is a real gate; fix it, never `--no-verify` past it.
Commit at meaningful checkpoints without waiting for an explicit reminder.
Prefer small, reviewable commits that leave the repository in a valid state.
Do not gate a commit (or any `&&` step) on a check piped through `tail`/`head` — a pipeline's exit status is the filter's, so a failed `pnpm run lint`/`check` is masked and the commit still runs.
Run the check unpiped, or test `${PIPESTATUS[0]}`.
To keep the output short without losing the gate, redirect rather than pipe: `pnpm run check >/dev/null && git commit …`.
When a shell loop or script needs a status variable, do not name it `status` — zsh reserves `$status` (an alias for `$?`) as read-only, so the assignment aborts with `read-only variable: status`; use `state`/`rc` instead.
Do not edit `CHANGELOG.md` — release-please owns it.
Before naming a remediation in a breaking-change migration note (CLI flag, config key, API call), verify it exists in the real surface (SDK types, `--help`, schema) — do not infer a config key by analogy.
The note ships to the `BREAKING CHANGE:` footer, the release-please CHANGELOG (uneditable), and the issue close comment.
Do not put `Closes #N` / `Fixes #N` / `Resolves #N` in commit messages.
`/ship-issue` posts a curated close comment (implemented-in SHA, behavior summary) via `issue_close`; a commit keyword auto-closes the issue on push and pre-empts that comment, leaving the issue with no summary.
Reference issues as `(#N)` in the subject or `Refs #N` in the body instead.
Still separate footer tokens (`Refs #N`, `BREAKING CHANGE:`) from the body with a blank line for readability; it is not enforced — `committed` validates only the header grammar and parses a body-line `#N` correctly, so the `conventional-commits-parser` footer false positive that motivated the swap no longer applies (Refs #468).
When a commit-lint or format gate fires a false positive, disable the single offending check (the specific `committed.toml` field), not the whole gate.
Avoid `git rebase -i` in this environment — `$EDITOR` opens an interactive editor that aborts non-interactively.
Reorder or fix unpushed commits with `git reset` + re-commit, or set `GIT_SEQUENCE_EDITOR`/`EDITOR=true`.
After `git reset --soft HEAD~N`, all N commits' changes are staged together — to re-split into separate commits, run `git reset` (mixed) first, then `git add` per commit.
Staged deletions from `git rm` ride along with the next `git commit` even when you `git add` only unrelated paths — commit with an explicit pathspec (`git commit -- <paths>`) or check `git status` first.
Before `git commit --amend`, confirm HEAD is your own commit (`git log -1`) — a concurrent session may have committed since yours, and amend rewrites whatever HEAD points at.
