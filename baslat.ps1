# Reblebi baslatici
# Kullanim: PowerShell'de  .\baslat.ps1   ya da baslat.cmd dosyasina cift tikla
# Parametre: .\baslat.ps1 -Uretim   (derlenmis surumu tek porttan calistirir)

param(
    [switch]$Uretim
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "  Reblebi" -ForegroundColor Magenta
Write-Host "  ===========" -ForegroundColor DarkGray
Write-Host ""

# --- Node surumu ---
try {
    $nodeVersion = (node --version) -replace "v", ""
    $major = [int]($nodeVersion -split "\.")[0]
    if ($major -lt 22) {
        Write-Host "  HATA: Node.js $nodeVersion bulundu, en az 22 gerekiyor." -ForegroundColor Red
        Write-Host "  Indir: https://nodejs.org" -ForegroundColor Yellow
        Read-Host "`n  Kapatmak icin Enter"
        exit 1
    }
    Write-Host "  Node.js $nodeVersion" -ForegroundColor DarkGray
} catch {
    Write-Host "  HATA: Node.js bulunamadi. https://nodejs.org adresinden kur." -ForegroundColor Red
    Read-Host "`n  Kapatmak icin Enter"
    exit 1
}

# --- Bagimliliklar ---
if (-not (Test-Path "node_modules")) {
    Write-Host "  Bagimliliklar kuruluyor (ilk calistirmada birkac dakika surer)..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  HATA: npm install basarisiz." -ForegroundColor Red
        Read-Host "`n  Kapatmak icin Enter"
        exit 1
    }
}

# --- .env ---
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "  .env olusturuldu (.env.example kopyalandi)." -ForegroundColor Yellow
        Write-Host "  Kanal baglamadan once doldurman gerekecek: docs\KURULUM.md" -ForegroundColor Yellow
    }
}

# --- APP_SECRET uyarisi ---
$envContent = Get-Content ".env" -Raw -ErrorAction SilentlyContinue
if ($envContent -match "APP_SECRET=degistir-bunu") {
    Write-Host ""
    Write-Host "  UYARI: APP_SECRET hala varsayilan deger." -ForegroundColor Yellow
    Write-Host "  Su komutla uret ve .env icine yaz:" -ForegroundColor DarkGray
    Write-Host '    -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })' -ForegroundColor DarkGray
}

# --- Mesgul portlari bildir ---
foreach ($port in @(4100, 5173)) {
    $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($busy) {
        $pidList = ($busy | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
        Write-Host ""
        Write-Host "  NOT: $port portu zaten kullanimda (PID $pidList)." -ForegroundColor Yellow
        Write-Host "  Muhtemelen Reblebi arka planda calisiyor. Durdurmak icin:" -ForegroundColor DarkGray
        Write-Host "    Stop-Process -Id $pidList -Force" -ForegroundColor DarkGray
    }
}

Write-Host ""
if ($Uretim) {
    Write-Host "  Uretim surumu derleniyor..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  HATA: derleme basarisiz." -ForegroundColor Red
        Read-Host "`n  Kapatmak icin Enter"
        exit 1
    }
    # Uretimde panel API ile ayni adresten sunulur: APP_URL = PUBLIC_URL
    # (.env'deki APP_URL gelistirme icin 5173'u gosterebilir; OAuth donusu ve MCP onay ekrani oraya gitmesin)
    $publicUrl = "http://localhost:4100"
    if ($envContent -match "(?m)^PUBLIC_URL=(\S+)") { $publicUrl = $Matches[1].Trim() }
    $env:APP_URL = $publicUrl
    Write-Host ""
    Write-Host "  Panel: $publicUrl" -ForegroundColor Green
    Write-Host "  MCP:   $publicUrl/mcp" -ForegroundColor DarkGray
    Write-Host "  Durdurmak icin Ctrl+C" -ForegroundColor DarkGray
    Write-Host ""
    npm start
} else {
    Write-Host "  Panel:  http://localhost:5173" -ForegroundColor Green
    Write-Host "  API:    http://localhost:4100" -ForegroundColor DarkGray
    Write-Host "  Durdurmak icin Ctrl+C" -ForegroundColor DarkGray
    Write-Host ""
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:5173"
    npm run dev
}
