@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (echo Install Node.js 22.13 or newer first. & pause & exit /b 1)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<13))process.exit(1)"
if errorlevel 1 (echo Node.js 22.13 or newer is required. & pause & exit /b 1)
if not exist node_modules (call npm ci & if errorlevel 1 (pause & exit /b 1))
call npm run setup
if errorlevel 1 (pause & exit /b 1)
call npm run build
if errorlevel 1 (pause & exit /b 1)
echo Open http://localhost:3001 in your browser after startup.
call npm start
pause
