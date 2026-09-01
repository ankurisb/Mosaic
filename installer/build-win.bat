@echo off
REM Build the Mosaic installer for Windows (x64). Produces an NSIS .exe under dist\.
REM Run on Windows (electron-builder cannot produce an NSIS installer from macOS).
cd /d "%~dp0"

echo ==^> Refreshing bundled deploy files from the repo...
if exist deploy\docker rmdir /S /Q deploy\docker
copy /Y ..\docker-compose.yml deploy\docker-compose.yml
xcopy /E /I /Y ..\docker deploy\docker
copy /Y ..\NETWORK.md deploy\NETWORK.md

echo ==^> Installing installer dependencies...
call npm install

echo ==^> Building Windows installer (NSIS, x64)...
call npm run build:win

echo ==^> Done. Installer is in dist\
dir dist\*.exe
