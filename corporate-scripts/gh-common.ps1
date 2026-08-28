# gh-common.ps1
# Helpers compartidos para hablar con GitHub CLI (gh) desde los scripts de
# promocion/PR. Se DOT-SOURCEA (. "$PSScriptRoot\gh-common.ps1"), no se ejecuta
# suelto. No hace `exit` por su cuenta: cada script decide que hacer si gh no
# esta o no tiene sesion.
#
# Por que existe: en este host `gh` esta instalado (winget: GitHub.cli) pero el
# instalador agrega el PATH a nivel de usuario y las terminales ya abiertas no
# lo ven hasta reiniciarse. Get-GhCli cae a las rutas fijas de instalacion para
# que los scripts funcionen igual sin reabrir la terminal.

function Get-GhCli {
    <#
      Devuelve la ruta al ejecutable de GitHub CLI, o $null si no se encuentra.
      Primero el PATH, despues las ubicaciones estandar de instalacion.
    #>
    $cmd = Get-Command gh -CommandType Application -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        (Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'GitHub CLI\gh.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\GitHub CLI\gh.exe')
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

function Test-GhAuth {
    <#
      $true si gh tiene una sesion iniciada para el host actual. No escribe nada.
    #>
    param([Parameter(Mandatory)] [string]$GhPath)
    & $GhPath auth status *> $null
    return ($LASTEXITCODE -eq 0)
}

function Assert-GhReady {
    <#
      Devuelve la ruta a gh lista para usar, o corta el script con un mensaje
      claro si falta gh o falta la sesion. Usar en scripts donde el PR es
      obligatorio (git-pr.ps1).
    #>
    $gh = Get-GhCli
    if (-not $gh) {
        Write-Error @"
GitHub CLI (gh) no encontrado.
Instalalo con:  winget install --id GitHub.cli
Si ya lo instalaste, abri una terminal nueva (el PATH recien agregado no lo ven
las terminales que ya estaban abiertas).
"@
        exit 1
    }
    if (-not (Test-GhAuth $gh)) {
        Write-Error @"
GitHub CLI sin sesion iniciada.
Ejecuta una sola vez:  & "$gh" auth login
(elegi GitHub.com -> HTTPS o SSH -> login con el navegador) y volve a intentar.
"@
        exit 1
    }
    return $gh
}

function Resolve-BranchAlias {
    <#
      Traduce el alias de ambiente que usa run.ps1 (dev/testing/prod) al nombre
      real de la rama. Si ya te pasan un nombre de rama, lo devuelve tal cual.
    #>
    param([Parameter(Mandatory)] [string]$Name)
    switch ($Name.ToLower()) {
        'dev'     { 'develop' }
        'develop' { 'develop' }
        'testing' { 'testing' }
        'test'    { 'testing' }
        'prod'    { 'master' }
        'master'  { 'master' }
        default   { $Name }
    }
}

function Set-GhLabel {
    <#
      Crea (o actualiza) una etiqueta en el repo. Idempotente. Si falla -por
      permisos, por ejemplo- avisa pero no corta: la creacion del PR puede
      seguir sin la etiqueta.
    #>
    param(
        [Parameter(Mandatory)] [string]$GhPath,
        [Parameter(Mandatory)] [string]$Name,
        [string]$Color = 'BFD4F2'
    )
    & $GhPath label create $Name --color $Color --force *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "No se pudo crear/actualizar la etiqueta '$Name' (se sigue sin ella)."
    }
}
