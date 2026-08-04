@echo off
title DemandIQ - Demand Forecasting & Inventory Management
color 0A
echo.
echo  ============================================================
echo    DemandIQ - AI Demand Forecasting ^& Inventory Management
echo  ============================================================
echo.
echo  [1/2] Starting Flask API backend on http://localhost:5000 ...
echo.

cd /d "%~dp0"
start "DemandIQ Backend" cmd /k "python backend\app.py"

echo  Waiting for backend to initialize...
timeout /t 5 /nobreak >nul

echo  [2/2] Opening frontend in your default browser...
start "" "%~dp0frontend\index.html"

echo.
echo  ============================================================
echo   DemandIQ is now running!
echo.
echo   Backend API : http://localhost:5000/api/health
echo   Frontend    : frontend\index.html (opened in browser)
echo.
echo   To stop: close the "DemandIQ Backend" window
echo  ============================================================
echo.
pause
