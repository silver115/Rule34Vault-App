@echo off
echo ========================================
echo   Rule34Vault APK Builder
echo ========================================
echo.

:: Check if eas-cli is installed
where eas >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] eas-cli not found. Install it with:
    echo   npm install -g eas-cli
    exit /b 1
)

:: Navigate to project directory
cd /d "%~dp0"

echo Building APK via EAS Cloud...
echo Profile: preview (internal distribution)
echo.

eas build --platform android --profile preview

echo.
echo ========================================
echo   Build complete! Check the URL above
echo   to download your APK.
echo ========================================
pause
