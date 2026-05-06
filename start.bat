@echo off
cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Python nao encontrado no PATH.
    echo Instale Python 3.x em python.org e marque "Add Python to PATH".
    pause
    exit /b 1
)

start /MIN "Flow Server" python server.py
timeout /t 2 /nobreak > nul
start "" "http://localhost:8765/dashboard.html"
exit
