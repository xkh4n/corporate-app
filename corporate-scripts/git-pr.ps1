<#
    .SYNOPSIS
    Crea un Pull Request entre dos ramas del modelo de ambientes usando gh.

    .DESCRIPTION
    Pensado para llamarse via `run.ps1 gitpr <destino> <origen>`, p.ej.
    `run.ps1 gitpr testing dev`. Acepta alias de ambiente (dev/testing/prod) o
    nombres de rama.

    Antes de abrir el PR: actualiza la rama origen (`git checkout` + `pull
    --ff-only` + `push`), asegura las etiquetas y evita duplicar un PR ya
    abierto para el mismo par base<-head.

    El PR hacia `master` NO se abre desde aca: master solo recibe desde
    `release/master`, que arma `promote-to-master.ps1`. Usa `run.ps1 pre prod`.

    .PARAMETER Destino
    Rama base del PR (a donde se mergea). Alias: testing, prod/master, dev.

    .PARAMETER Origen
    Rama head del PR (de donde salen los cambios). Alias: dev, testing.
#>
param(
    [Parameter(Mandatory)] [string]$Destino,
    [Parameter(Mandatory)] [string]$Origen
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

. "$PSScriptRoot\gh-common.ps1"

$base = Resolve-BranchAlias $Destino
$head = Resolve-BranchAlias $Origen

if ($base -eq $head) {
    Write-Error "Origen y destino son la misma rama ('$base')."
    exit 1
}
if ($base -eq 'master') {
    Write-Error "El PR hacia master se arma con la rama limpia release/master. Corre:  .\run.ps1 pre prod"
    exit 1
}

$gh = Assert-GhReady

# 1. Actualizar la rama origen y publicarla.
Write-Host "Actualizando '$head'..." -ForegroundColor Cyan
git fetch origin --quiet
git checkout $head
if ($LASTEXITCODE -ne 0) { Write-Error "No se pudo cambiar a '$head'."; exit 1 }
git pull --ff-only origin $head
if ($LASTEXITCODE -ne 0) { Write-Error "Fallo git pull --ff-only en '$head' (hay divergencia, resolvela a mano)."; exit 1 }
git push origin $head
if ($LASTEXITCODE -ne 0) { Write-Error "Fallo git push de '$head'."; exit 1 }

# 2. Etiquetas segun el destino.
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
if ($base -eq 'testing') {
    $labels = 'release,testing'
    Set-GhLabel -GhPath $gh -Name 'release' -Color 'BFD4F2'
    Set-GhLabel -GhPath $gh -Name 'testing' -Color 'FBCA04'
    $title = "Release: $head -> testing ($stamp)"
    $body = @"
## Cambios incluidos

- **Fecha:** $stamp
- **Rama origen:** $head
- **Rama destino:** testing

### Descripcion
Promueve los cambios de desarrollo al entorno pre-productivo (testing).

### Checklist
- [ ] Codigo revisado
- [ ] Tests unitarios pasan
- [ ] Tests de integracion pasan
- [ ] Documentacion actualizada
"@
}
else {
    $labels = 'release'
    Set-GhLabel -GhPath $gh -Name 'release' -Color 'BFD4F2'
    $title = "PR: $head -> $base ($stamp)"
    $body = @"
## Cambios incluidos

- **Fecha:** $stamp
- **Rama origen:** $head
- **Rama destino:** $base
"@
}

# 3. No duplicar un PR ya abierto.
$existing = & $gh pr list --base $base --head $head --state open --json number --jq '.[0].number'
if ($existing) {
    Write-Host "Ya existe un PR abierto $head -> $base (#$existing). Abriendo en el navegador..." -ForegroundColor Yellow
    & $gh pr view $existing --web
    exit 0
}

# 4. Crear el PR.
Write-Host "Creando PR $head -> $base..." -ForegroundColor Green
& $gh pr create --base $base --head $head --title $title --body $body --label $labels --assignee '@me'
if ($LASTEXITCODE -ne 0) {
    Write-Error "Fallo la creacion del PR."
    exit 1
}
Write-Host "PR creado: $head -> $base" -ForegroundColor Green
