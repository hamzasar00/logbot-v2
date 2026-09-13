@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Discord Log Bot

if not exist node_modules (
  echo Bagimliliklar bulunamadi. Once kurulum.bat dosyasini calistirin.
  pause
  exit /b 1
)
if not exist .env (
  echo .env dosyasi bulunamadi. Once kurulum.bat dosyasini calistirin.
  pause
  exit /b 1
)

call npm start
pause
