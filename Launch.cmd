@echo off
pushd "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is not installed. Run npx --yes npm@11 install, then npm run build:desktop.
  pause
  exit /b 1
)
if not exist "apps\electron\out\main\index.js" (
  echo The app has not been built. Run npm run build:desktop.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "apps\electron"
popd
