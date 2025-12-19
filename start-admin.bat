@echo off
:: PC Utility Pro - Admin Launcher
:: This script requests admin privileges for CPU temperature monitoring

:: Check for admin rights
net session >nul 2>&1
if %errorLevel% == 0 (
    :: Already admin, just run
    cd /d "%~dp0"
    npm start
) else (
    :: Request admin
    echo Requesting administrator privileges for temperature monitoring...
    powershell -Command "Start-Process cmd -ArgumentList '/c cd /d \"%~dp0\" && npm start' -Verb RunAs"
)
