# Security gate for changes to `master`

Since the 2026-09-17 full security audit (`.claude/agents/cybersecurity-orchestrator.md`, skill `security-audit`), **every change that reaches `master` must pass a security review before it is pushed there.** This is enforced locally by a real git hook, not just a written policy.

## How it works

1. `corporate-scripts/git-hooks/pre-push` blocks `git push` to `master` unless a local marker file (`.security-gate/last-review.json`, gitignored, machine-local) exists **and its `commit` field matches the exact commit you're pushing**.
2. Before pushing to `master`, run a security review for your current `HEAD`:
   - `cybersecurity-orchestrator` agent (invokes the `security-audit`/`security-review` skills), or
   - `/code-review` at high/max effort, or
   - a manual review, if you have a good reason to skip the agent.
3. Once it passes, write the marker:
   - `corporate-scripts/security-gate-mark.sh` (bash) or `.ps1` (PowerShell) — defaults to the current `HEAD` commit.
4. Push. The hook checks the marker's commit against what you're pushing and lets it through only if they match exactly — a new commit after marking invalidates the marker and you review again.

## One-time setup (per clone/machine)

`core.hooksPath` is not versioned by git, so every clone needs to opt in once:

```sh
git config core.hooksPath corporate-scripts/git-hooks
```

(On Windows, run this from Git Bash or PowerShell — it's a plain git config command, works either way.)

This repo has `core.fileMode=false`, so git does not track the executable bit. On a fresh clone on Linux/macOS, also run once:

```sh
chmod +x corporate-scripts/git-hooks/pre-push corporate-scripts/security-gate-mark.sh
```

## What this does and doesn't guarantee

This is a **local, developer-side attestation**, not a cryptographic or server-side control: it stops an accidental push of unreviewed work to `master`, and makes the review step a visible, required part of the workflow. It does **not** stop a developer who deliberately fabricates the marker, and it only applies on machines where `core.hooksPath` has been configured. For an adversarial guarantee (e.g. an intentionally malicious insider), pair this with a server-side required status check / branch protection rule on `master` in GitHub, which is outside what a local git hook can enforce.

## Scope

Only pushes targeting `refs/heads/master` are gated. Pushes to `develop`, feature branches, or any other ref go through unaffected — day-to-day development keeps its normal speed; the friction lands exactly where the risk is highest (code about to ship).
