@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Discord Log Bot - Kurulum

echo Discord Log Bot kurulumu basliyor...
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js bulunamadi. Node.js 22 veya 24 LTS kurun: https://nodejs.org/
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%v"
if %NODE_MAJOR% LSS 22 (
  echo Node.js surumu cok eski. Node.js 22 veya 24 LTS kurun.
  pause
  exit /b 1
)
if %NODE_MAJOR% GEQ 25 (
  echo Node.js 25 ve ustu bu proje icin onerilmiyor. Node.js 22 veya 24 LTS kurun.
  pause
  exit /b 1
)

if not exist package.json (
  echo package.json bulunamadi. ZIP dosyasinin tamamini cikardiginizdan emin olun.
  pause
  exit /b 1
)

if not exist .env (
  copy /Y .env.example .env >nul
  echo .env dosyasi olusturuldu. Kurulumdan sonra token bilgilerini doldurun.
)

call npm install
if errorlevel 1 (
  echo.
  echo Bagimlilik kurulumu basarisiz oldu. Node.js 22/24 LTS kullandiginizi kontrol edin.
  pause
  exit /b 1
)

echo.
echo Kurulum tamamlandi. .env dosyasini doldurduktan sonra baslat.bat dosyasini calistirin.
pause
