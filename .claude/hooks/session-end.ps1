# .claude/hooks/session-end.ps1
#
# SessionEnd hook for Claude Code — Liberty Library Platform
#
# What this does:
#   1. Gets the list of files changed since the last git commit
#   2. Checks if any fall in the tracked source directories
#   3. If yes: writes a CHANGED_FILES.tmp file and invokes the doc-sync subagent
#   4. If no: exits silently — no docs are touched
#
# Registered in Claude Code settings as a SessionEnd hook.
# The hook receives no session context — it only knows what changed in git.
# For sessions with complex architectural changes, invoke /doc-sync manually
# BEFORE the session ends so Claude Code still has full conversation context.

# ── Configuration ────────────────────────────────────────────────────────────

# Directories that should trigger a doc sync when changed
$TRACKED_DIRS = @("app/", "lib/", "prisma/", "worker/")

# Minimum number of changed files required to trigger a sync
# Prevents single-line typo fixes from triggering a full doc pass
$MIN_CHANGED_FILES = 2

# Path to write the changed files list (read by doc-sync subagent)
$CHANGED_FILES_TMP = ".claude/hooks/CHANGED_FILES.tmp"

# ── Get changed files ─────────────────────────────────────────────────────────

# Use git diff to find files changed since last commit
# Falls back to staged files if nothing committed yet this session
$changedFiles = git diff --name-only HEAD 2>$null
if (-not $changedFiles) {
    $changedFiles = git diff --name-only --cached 2>$null
}

# If git is not available or no changes found, exit silently
if (-not $changedFiles) {
    Write-Host "[doc-sync hook] No git changes detected. Skipping doc sync."
    exit 0
}

# ── Check if tracked dirs were touched ───────────────────────────────────────

$relevantFiles = @()
foreach ($file in $changedFiles) {
    foreach ($dir in $TRACKED_DIRS) {
        if ($file.StartsWith($dir)) {
            $relevantFiles += $file
            break
        }
    }
}

# Exit silently if no relevant files changed
if ($relevantFiles.Count -eq 0) {
    Write-Host "[doc-sync hook] No tracked source files changed. Skipping doc sync."
    exit 0
}

# Exit silently if change count is below minimum threshold
if ($relevantFiles.Count -lt $MIN_CHANGED_FILES) {
    Write-Host "[doc-sync hook] Only $($relevantFiles.Count) tracked file(s) changed (minimum: $MIN_CHANGED_FILES). Skipping doc sync."
    Write-Host "[doc-sync hook] Changed: $($relevantFiles -join ', ')"
    exit 0
}

# ── Write changed files list ──────────────────────────────────────────────────

# Ensure the hooks directory exists
$hooksDir = Split-Path $CHANGED_FILES_TMP
if (-not (Test-Path $hooksDir)) {
    New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
}

# Write the list — doc-sync subagent reads this as its CHANGED_FILES input
$relevantFiles | Out-File -FilePath $CHANGED_FILES_TMP -Encoding UTF8

Write-Host "[doc-sync hook] $($relevantFiles.Count) tracked file(s) changed:"
foreach ($f in $relevantFiles) {
    Write-Host "  $f"
}

# ── Invoke doc-sync subagent ──────────────────────────────────────────────────

Write-Host "[doc-sync hook] Invoking doc-sync subagent..."
Write-Host ""
Write-Host "┌─────────────────────────────────────────────────────────────────┐"
Write-Host "│  DOC SYNC — review the updates below before committing          │"
Write-Host "│  Changed files are listed in .claude/hooks/CHANGED_FILES.tmp    │"
Write-Host "│  To skip: close without committing the doc changes              │"
Write-Host "│  To run manually at any time: type /doc-sync in Claude Code     │"
Write-Host "└─────────────────────────────────────────────────────────────────┘"
Write-Host ""

# Claude Code's SessionEnd hook invokes the subagent registered under the name "doc-sync".
# The subagent reads CHANGED_FILES.tmp and updates the relevant .claude/ files.
# No further shell action needed here — Claude Code handles the subagent invocation.

# ── Cleanup ───────────────────────────────────────────────────────────────────

# CHANGED_FILES.tmp is left in place intentionally so the subagent can read it.
# The subagent or the developer should delete it after the sync completes.
# To clean up manually: Remove-Item .claude/hooks/CHANGED_FILES.tmp