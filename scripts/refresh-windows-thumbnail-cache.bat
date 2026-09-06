@echo off
setlocal
title Refresh Kea3D thumbnails

set "THUMB_CACHE=%LocalAppData%\Microsoft\Windows\Explorer"

echo This will close Windows Explorer and clear its thumbnail cache.
echo Explorer will restart automatically. Your model files will not be changed.
echo.
choice /C YN /N /M "Continue? [Y/N] "
if errorlevel 2 exit /b 0

if not exist "%THUMB_CACHE%" (
  echo.
  echo Thumbnail cache directory was not found:
  echo %THUMB_CACHE%
  pause
  exit /b 1
)

taskkill /F /IM explorer.exe >nul 2>&1
timeout /T 2 /NOBREAK >nul
del /A /F /Q "%THUMB_CACHE%\thumbcache_*.db" >nul 2>&1
set "DELETE_RESULT=%ERRORLEVEL%"
start "" explorer.exe

echo.
if "%DELETE_RESULT%"=="0" (
  echo Thumbnail cache cleared. Explorer is rebuilding model previews now.
) else (
  echo Some cache files could not be removed. Close preview applications and try again.
)
echo You can also change Explorer to Large or Extra large icons to request fresh previews.
pause
exit /b %DELETE_RESULT%
