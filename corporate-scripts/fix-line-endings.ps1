param()

Write-Host "🔧 Corrigiendo terminaciones de línea para compatibilidad Windows..." -ForegroundColor Cyan

# Buscar TODOS los archivos .sh dentro de corporate-infra y sus subcarpetas
$filesToFix = Get-ChildItem -Path ".\corporate-infra" -Recurse -Filter "*.sh" -File | ForEach-Object { $_.FullName }

if ($filesToFix.Count -eq 0) {
    Write-Host "⚠️  No se encontraron archivos .sh en 'corporate-infra'." -ForegroundColor Yellow
    exit 0
}

$fixedCount = 0
$skippedCount = 0

foreach ($file in $filesToFix) {
    # Mostramos la ruta relativa para mayor claridad
    $relativePath = Resolve-Path -Path $file -Relative
    Write-Host "  🔄 Procesando: $relativePath" -ForegroundColor Yellow

    try {
        # Leer contenido completo
        $content = Get-Content $file -Raw

        if ($content -and $content.Contains("`r`n")) {
            # Reemplazar CRLF por LF
            $fixedContent = $content -replace "`r`n", "`n"

            # Guardar en archivo temporal y reemplazar
            $tempFile = "$file.tmp"
            Set-Content $tempFile -Value $fixedContent -NoNewline
            Move-Item $tempFile $file -Force

            Write-Host "    ✅ Corregido: CRLF -> LF" -ForegroundColor Green
            $fixedCount++
        } else {
            Write-Host "    ✅ Ya tiene formato correcto (LF)" -ForegroundColor Green
            $skippedCount++
        }
    } catch {
        Write-Host "    ❌ Error al procesar: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "📊 Resumen de correcciones:" -ForegroundColor Cyan
Write-Host "  • Archivos corregidos: $fixedCount" -ForegroundColor Green
Write-Host "  • Archivos ya correctos: $skippedCount" -ForegroundColor Yellow
Write-Host "  • Total procesados: $($fixedCount + $skippedCount)" -ForegroundColor White

if ($fixedCount -gt 0) {
    Write-Host ""
    Write-Host "✅ Correcciones aplicadas exitosamente." -ForegroundColor Green
    Write-Host "💡 Ahora puedes levantar el stack de bases de datos con: .\run.ps1 bdd dev" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "✅ No se necesitaron correcciones. El proyecto ya está listo." -ForegroundColor Green
}