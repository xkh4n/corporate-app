<#
    .SYNOPSIS
    Prepara la promoción de "testing" a "master" en una rama intermedia
    (release/master), quitando del merge todo lo que nunca debe llegar a
    producción (tests unitarios/integración, compose.dev.yml/compose.test.yml,
    configs de test runner — ver master-excluded-paths.txt).

    .DESCRIPTION
    Este script NO empuja directo a master ni abre el Pull Request por vos
    (no hay "gh" CLI instalado en este host) — solo deja "release/master"
    publicada y lista en origin, con el diff ya limpio, para que abras el PR
    "release/master -> master" a mano. El PR sigue pasando por revisión y por
    el chequeo de CI (.github/workflows/master-no-testing-artifacts.yml), que
    es quien realmente bloquea si algo prohibido se coló igual.

    .PARAMETER Reason
    Texto libre que se agrega al mensaje de commit de la promoción (por
    ejemplo, referencia al PR o milestone que se está promoviendo).
#>
param(
    [string]$Reason = "promocion de rutina"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# 0. El working tree tiene que estar limpio: este script hace checkout/merge
#    y no queremos mezclar cambios locales sueltos con la promoción.
$dirty = git status --porcelain
if ($dirty) {
    Write-Error "El working tree tiene cambios sin commitear. Commitea o descarta antes de promocionar."
    exit 1
}

Write-Host "Actualizando referencias remotas..." -ForegroundColor Cyan
git fetch origin --quiet

$releaseBranch = "release/master"

# 1. Siempre arranca desde origin/master (no desde un release/master local
#    viejo que pueda haber quedado de una corrida anterior sin pushear).
Write-Host "Creando '$releaseBranch' desde origin/master..." -ForegroundColor Cyan
git checkout -B $releaseBranch origin/master | Out-Null

# 2. Trae testing pero NO commitea todavía -da la chance de curar el
#    resultado (sacar rutas prohibidas) antes de fijar el commit de merge.
Write-Host "Mezclando origin/testing (sin commitear)..." -ForegroundColor Cyan
git merge --no-commit --no-ff origin/testing
$mergeExit = $LASTEXITCODE

if ($mergeExit -ne 0) {
    Write-Warning "El merge de testing -> $releaseBranch tiene conflictos reales (no relacionados a las rutas excluidas)."
    Write-Warning "Resuelvelos a mano en el working tree, dejá todo en stage, y volvé a correr este mismo comando de nuevo NO hace falta -no vuelve a mergear si ya hay un merge en curso-."
    Write-Warning "Si preferís abortar: git merge --abort"
    exit 1
}

# 3. Lee la lista única de rutas/patrones prohibidos.
$excludedListPath = Join-Path $PSScriptRoot 'master-excluded-paths.txt'
if (-not (Test-Path $excludedListPath)) {
    Write-Error "No se encontro $excludedListPath -sin esta lista no hay forma segura de saber que excluir."
    git merge --abort 2>$null
    exit 1
}
$patterns = Get-Content $excludedListPath |
    Where-Object { $_ -and -not $_.TrimStart().StartsWith('#') } |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ }

function Test-ExcludedPath {
    param([string]$RelPath, [string[]]$Patterns)
    $name = Split-Path $RelPath -Leaf
    foreach ($p in $Patterns) {
        if ($p -notmatch '/') {
            if ($name -like $p) { return $true }
        }
        elseif ($RelPath -eq $p) {
            return $true
        }
    }
    return $false
}

# 4. Revisa SOLO los archivos que este merge realmente toca (no todo el repo).
$changedFiles = git diff --cached --name-only
$removed = @()

foreach ($f in $changedFiles) {
    if (-not (Test-ExcludedPath -RelPath $f -Patterns $patterns)) { continue }

    git cat-file -e "HEAD:$f" 2>$null
    $existedInMaster = ($LASTEXITCODE -eq 0)

    if ($existedInMaster) {
        # master ya tenia este archivo (no deberia pasar segun la politica,
        # pero por seguridad restauramos la version de master, no la borramos).
        git checkout HEAD -- $f
    } else {
        # Archivo nuevo que solo existia en testing -se saca del todo del merge.
        git rm -f --cached -- $f | Out-Null
        Remove-Item -Path $f -Force -ErrorAction SilentlyContinue
    }
    $removed += $f
}

if ($removed.Count -gt 0) {
    Write-Host "Excluidas $($removed.Count) ruta(s) de master (tests/config de testing):" -ForegroundColor Yellow
    $removed | ForEach-Object { Write-Host "  - $_" }
} else {
    Write-Host "Ninguna ruta prohibida vino en este merge." -ForegroundColor Green
}

# 5. Si tras excluir no queda nada nuevo respecto a master, no hay nada que promocionar.
$staged = git diff --cached --stat
if (-not $staged) {
    Write-Host "No hay cambios reales para promocionar (testing == master una vez excluidas sus rutas propias)." -ForegroundColor Yellow
    git merge --abort 2>$null
    exit 0
}

$commitMessage = "Promote testing to master ($Reason)"
if ($removed.Count -gt 0) {
    $commitMessage += "`n`nRutas excluidas (nunca van a master): $($removed -join ', ')"
}

git commit -m $commitMessage | Out-Null
Write-Host "Publicando '$releaseBranch' en origin..." -ForegroundColor Cyan
git push origin $releaseBranch --force-with-lease

$compareUrl = "https://github.com/xkh4n/corporate-app/compare/master...$releaseBranch`?expand=1"
Write-Host ""
Write-Host "Listo. Abrí el Pull Request '$releaseBranch -> master' acá (el chequeo de CI vuelve a validar que no haya rutas prohibidas):" -ForegroundColor Green
Write-Host $compareUrl -ForegroundColor Green
