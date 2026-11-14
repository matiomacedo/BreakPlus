@echo off
setlocal EnableExtensions
title Break+ESTG - arranque
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

echo ============================================
echo   Break+ESTG - a ligar API e paginas
echo ============================================
echo.

rem --- Prerequisitos ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instala em https://nodejs.org/
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERRO] npm nao encontrado.
  pause
  exit /b 1
)

if not exist "%ROOT%\server\.env" (
  echo [ERRO] Falta "%ROOT%\server\.env".
  echo        Copia server\.env.example para server\.env e preenche os valores.
  pause
  exit /b 1
)
if not exist "%ROOT%\terminal\config.js" (
  echo [ERRO] Falta "%ROOT%\terminal\config.js".
  echo        Copia terminal\config.example.js para terminal\config.js.
  pause
  exit /b 1
)

if not exist "%ROOT%\server\node_modules" (
  echo A instalar dependencias da API ^(npm install^)...
  pushd "%ROOT%\server"
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    popd
    echo [ERRO] npm install falhou.
    pause
    exit /b 1
  )
  popd
)

rem --- Python para servir as paginas ---
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo [ERRO] Python nao encontrado. Instala em https://www.python.org/downloads/
  pause
  exit /b 1
)

rem --- API (porta 3000) ---
set "API_RUNNING="
for /f "tokens=*" %%L in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do set "API_RUNNING=1"
if defined API_RUNNING (
  echo [i] Porta 3000 ja ocupada - a API parece estar a correr.
) else (
  echo A arrancar API em http://localhost:3000 ...
  start "Break+ESTG API" /D "%ROOT%\server" cmd /k "npm run dev"
)

rem --- Paginas (porta 8000) ---
set "WEB_RUNNING="
for /f "tokens=*" %%L in ('netstat -ano ^| findstr /R /C:":8000 .*LISTENING"') do set "WEB_RUNNING=1"
if defined WEB_RUNNING (
  echo [i] Porta 8000 ja ocupada - as paginas parecem estar a correr.
) else (
  echo A arrancar paginas em http://localhost:8000 ...
  start "Break+ESTG Paginas" /D "%ROOT%" cmd /k "%PY% -m http.server 8000"
)

rem --- Abrir as duas apps no browser ---
if /I "%~1"=="/nobrowser" goto done
echo A abrir a app dos alunos e o terminal no browser...
ping -n 6 127.0.0.1 >nul
start "" "http://localhost:8000/"
start "" "http://localhost:8000/terminal/"

:done
echo.
echo Tudo a arrancar.
echo Fecha as janelas "Break+ESTG API" e "Break+ESTG Paginas" para parar.
echo.
ping -n 6 127.0.0.1 >nul
exit /b 0
