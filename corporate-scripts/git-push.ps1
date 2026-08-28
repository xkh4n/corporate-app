<#
    .SYNOPSIS
    Commitea (si hay cambios) y hace push de la rama del ambiente indicado.

    .DESCRIPTION
    Pensado para llamarse via `run.ps1 gitpush <dev|testing> ["mensaje..."]`.
    - Solo admite `dev` (-> develop) y `testing` (-> testing). `master` no recibe
      push directo: se promociona con `run.ps1 pre prod`.
    - Verifica que estes parado en la rama que corresponde antes de tocar nada.
    - Si el working tree tiene cambios, exige un mensaje de commit, hace
      `git add -A` + `git commit` y luego push. Si esta limpio, solo push.

    .PARAMETER Ambiente
    `dev` o `testing`.

    .PARAMETER Message
    Palabras del mensaje de commit (se juntan con espacios). Obligatorio solo si
    hay cambios sin commitear.
#>
param(
    [Parameter(Mandatory)]
    [ValidateSet('dev', 'testing')]
    [string]$Ambiente,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Message
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$branch = @{ dev = 'develop'; testing = 'testing' }[$Ambiente]

# 1. Tenes que estar parado en la rama que vas a pushear (evita pushear develop
#    estando en un feature branch por accidente).
$current = (git rev-parse --abbrev-ref HEAD).Trim()
if ($current -ne $branch) {
    Write-Error "Estas en '$current' pero pediste push de '$branch'. Corre primero:  git checkout $branch"
    exit 1
}

# 2. Commit condicional.
$commitMessage = (($Message | Where-Object { $_ }) -join ' ').Trim()
$dirty = git status --porcelain

if ($dirty) {
    if (-not $commitMessage) {
        Write-Error "Hay cambios sin commitear. Pasa un mensaje:  .\run.ps1 gitpush $Ambiente `"tu mensaje`""
        exit 1
    }
    Write-Host "Commiteando cambios en '$branch'..." -ForegroundColor Cyan
    git add -A
    git commit -m $commitMessage
    if ($LASTEXITCODE -ne 0) { Write-Error "Fallo git commit."; exit 1 }
}
elseif ($commitMessage) {
    Write-Host "No hay cambios para commitear; se ignora el mensaje y solo se hace push." -ForegroundColor Yellow
}

# 3. Push.
Write-Host "Push de '$branch' -> origin..." -ForegroundColor Cyan
git push origin $branch
exit $LASTEXITCODE
