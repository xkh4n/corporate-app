<#
    .SYNOPSIS
    Prepara la promoción de "testing" a "master" en una rama intermedia
    (release/master), quitando del merge todo lo que nunca debe llegar a
    producción (tests unitarios/integración, compose.dev.yml/compose.test.yml,
    configs de test runner — ver master-excluded-paths.txt).

    .DESCRIPTION
    Este script empuja "release/master" a origin con el diff ya limpio y —si
    "gh" está disponible y con sesión— abre el Pull Request
    "release/master -> master" por vos (pasá -NoPr para saltarte ese paso y
    abrirlo a mano con el link que imprime al final). El PR sigue pasando por
    revisión y por el chequeo de CI
    (.github/workflows/master-no-testing-artifacts.yml), que es quien realmente
    bloquea si algo prohibido se coló igual.

    Se invoca normalmente via  .\run.ps1 pre prod  ["motivo"].

    .PARAMETER Reason
    Texto libre que se agrega al mensaje de commit de la promoción (por
    ejemplo, referencia al PR o milestone que se está promoviendo).

    .PARAMETER NoPr
    No abrir el Pull Request con gh; solo dejar "release/master" publicada.
#>
param(
    [string]$Reason = "promocion de rutina",
    [switch]$NoPr
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

# Rama desde la que se invoco: se restaura al terminar (el script hace checkout de release/master).
$originalBranch = (git branch --show-current).Trim()

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
# Un merge con conflictos NO corta aqui: es lo normal cuando testing modifico un archivo de solo-testing que master
# no tiene (modify/delete: p. ej. un *.integration.test.ts o compose.test.yml). Esos conflictos se resuelven solos
# mas abajo, borrando el archivo; solo un conflicto en una ruta NO excluida detiene la promocion.

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

$removed = @()

# 3b. Conflictos del merge. Los de rutas excluidas se resuelven borrando el archivo (master no debe tenerlo);
#     si queda alguno en una ruta normal, hay que resolverlo a mano.
$unmerged = @(git diff --name-only --diff-filter=U)
if ($mergeExit -ne 0 -and $unmerged.Count -eq 0) {
    Write-Warning "El merge de testing -> $releaseBranch fallo sin dejar conflictos resolubles; se aborta."
    git merge --abort 2>$null
    git checkout $originalBranch 2>$null | Out-Null
    exit 1
}
$realConflicts = @()
foreach ($f in $unmerged) {
    if (Test-ExcludedPath -RelPath $f -Patterns $patterns) {
        git rm -f -q -- $f
        $removed += $f
    }
    else {
        $realConflicts += $f
    }
}
if ($realConflicts.Count -gt 0) {
    Write-Warning "El merge de testing -> $releaseBranch tiene conflictos reales (rutas NO excluidas):"
    $realConflicts | ForEach-Object { Write-Warning "  - $_" }
    Write-Warning "Resuelvelos a mano en el working tree y dejá todo en stage; luego 'git commit' y 'git push origin $releaseBranch --force-with-lease'."
    Write-Warning "Si preferís abortar: git merge --abort  (y  git checkout $originalBranch)"
    exit 1
}

# 4. Revisa SOLO los archivos que este merge realmente toca (no todo el repo).
$changedFiles = git diff --cached --name-only

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
        # "git rm -f" (sin --cached) quita el archivo del indice Y del working tree.
        git rm -f -q -- $f
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
    git checkout $originalBranch 2>$null | Out-Null
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

# 6. Abrir el Pull Request 'release/master -> master' con gh (best-effort: si gh
#    no está o no tiene sesión, se cae al link de compare para hacerlo a mano).
#    El chequeo de CI vuelve a validar que no haya rutas prohibidas igual.
$prOpened = $false
if (-not $NoPr) {
    . "$PSScriptRoot\gh-common.ps1"
    $gh = Get-GhCli
    if (-not $gh) {
        Write-Warning "gh no encontrado; abrí el PR a mano (link abajo)."
    }
    elseif (-not (Test-GhAuth $gh)) {
        Write-Warning "gh sin sesión ('gh auth login'); abrí el PR a mano (link abajo)."
    }
    else {
        Set-GhLabel -GhPath $gh -Name 'release' -Color 'BFD4F2'
        Set-GhLabel -GhPath $gh -Name 'production' -Color 'D93F0B'
        $existing = & $gh pr list --base master --head $releaseBranch --state open --json number --jq '.[0].number'
        if ($existing) {
            Write-Host "Ya existe un PR abierto '$releaseBranch -> master' (#$existing). Abriéndolo..." -ForegroundColor Yellow
            & $gh pr view $existing --web
            $prOpened = $true
        }
        else {
            $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
            $prBody = @"
## Release a Producción

- **Fecha:** $stamp
- **Rama origen:** $releaseBranch (armada desde testing, ya sin rutas de solo-testing)
- **Rama destino:** master (producción)
- **Motivo:** $Reason

### Validaciones previas
- [ ] Pruebas en ambiente testing completadas
- [ ] Aprobación de QA
- [ ] Aprobación de negocio
- [ ] Sin regresiones detectadas

### Rollback
En caso de incidente, revertir este PR o hacer rollback al commit anterior.

---
**IMPORTANTE:** Este PR despliega a PRODUCCIÓN. Requiere aprobación obligatoria.
El chequeo de CI 'Guardia de master' bloquea el merge si se coló alguna ruta de
solo-testing.
"@
            & $gh pr create --base master --head $releaseBranch `
                --title "Production Release: $releaseBranch -> master ($(Get-Date -Format 'yyyy-MM-dd'))" `
                --body $prBody `
                --label "release,production" `
                --assignee "@me"
            if ($LASTEXITCODE -eq 0) {
                Write-Host "PR '$releaseBranch -> master' creado." -ForegroundColor Green
                $prOpened = $true
            }
            else {
                Write-Warning "Fallo 'gh pr create'; abrí el PR a mano (link abajo)."
            }
        }
    }
}

Write-Host ""
if (-not $prOpened) {
    Write-Host "Abrí el Pull Request '$releaseBranch -> master' acá (el chequeo de CI vuelve a validar que no haya rutas prohibidas):" -ForegroundColor Green
    Write-Host $compareUrl -ForegroundColor Green
}
else {
    Write-Host "Compare/diff por si lo necesitás: $compareUrl" -ForegroundColor DarkGray
}

# Vuelve a la rama desde la que se invoco (el merge y el commit ya quedaron publicados en release/master).
git checkout $originalBranch 2>$null | Out-Null
