# Install version-controlled git hooks for this repository.
$ErrorActionPreference = 'Stop'

$RepoRoot = git rev-parse --show-toplevel
if (-not $RepoRoot) {
	throw 'Not inside a git repository.'
}

Set-Location $RepoRoot

git config core.hooksPath githooks

$hooks = @(
	'githooks/_strip-cursor-attribution.sh',
	'githooks/prepare-commit-msg',
	'githooks/commit-msg'
)

foreach ($hook in $hooks) {
	if (-not (Test-Path $hook)) {
		throw "Missing hook file: $hook"
	}
	git add -- $hook
	git update-index --chmod=+x -- $hook
}

Write-Host "Installed git hooks (core.hooksPath=githooks)."
Write-Host "Cursor attribution trailers will be stripped before commits complete."
