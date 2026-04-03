@echo off
title MogCheck - API + site
cd /d "%~dp0"
echo Starting API (port 3001) and Vite (port 5174)...
echo Keep this window open while you use the site.
echo.
call npm run dev
pause
