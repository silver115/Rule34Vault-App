@echo off
echo Starting Rule34Vault preview and proxy...
echo.

:: Start proxy server in background
start "Proxy Server" cmd /c "cd /d %~dp0 && node proxy-server.js"

:: Wait a moment for proxy to start
timeout /t 3 /nobreak >nul

:: Start Expo preview
echo Opening Expo preview in browser...
start http://localhost:8081
npx expo start --web --port 8081

pause
