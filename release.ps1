param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Version
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Version = $Version.Trim().TrimStart("v")
if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$') {
    throw "Version must be semantic, for example 0.2.0 or 0.2.0-beta.1."
}

$root = $PSScriptRoot
$tag = "v$Version"
Push-Location $root
try {
    $branch = (git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne "main") {
        throw "Releases must be created from the main branch. Current branch: $branch"
    }

    if (git status --porcelain) {
        throw "The working tree is not clean. Commit or stash changes before creating a release."
    }

    git fetch origin main --tags
    if ($LASTEXITCODE -ne 0) { throw "Could not fetch origin." }

    if (git tag --list $tag) {
        throw "Tag $tag already exists."
    }

    node scripts/version.mjs set $Version
    if ($LASTEXITCODE -ne 0) { throw "Could not update project versions." }

    & "$root\build-windows.cmd"
    if ($LASTEXITCODE -ne 0) { throw "Local release build failed." }

    git diff --check
    if ($LASTEXITCODE -ne 0) { throw "Version changes contain whitespace errors." }

    git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
    git commit -m "chore: release $tag"
    if ($LASTEXITCODE -ne 0) { throw "Could not create the release commit." }

    git tag -a $tag -m "PortLens $tag"
    if ($LASTEXITCODE -ne 0) { throw "Could not create tag $tag." }

    git push origin main
    if ($LASTEXITCODE -ne 0) { throw "Could not push the release commit." }

    git push origin $tag
    if ($LASTEXITCODE -ne 0) { throw "Could not push tag $tag." }

    Write-Host "Published $tag. GitHub Actions is building the release." -ForegroundColor Green
    Write-Host "https://github.com/xirfly/portlens/actions/workflows/release.yml"
}
finally {
    Pop-Location
}
