@echo off
title Vercel Backend Host
echo Starting API Backend on port 3001...
start cmd /k "cd backend && npm run dev"
echo Waiting for backend to start...
timeout /t 5 >nul
echo Starting Cloudflare Tunnel...
start cmd /k "cloudflared tunnel --url http://localhost:3001"
echo.
echo ==============================================================================
echo IMPORTANT NEXT STEPS FOR VERCEL:
echo 1. In the NEW window that just opened (Cloudflared), look for the URL
echo    that ends in .trycloudflare.com (e.g. https://xyz.trycloudflare.com)
echo.
echo 2. Go to Vercel.com -^> Your Project -^> Settings -^> Environment Variables
echo.
echo 3. Add a new variable:
echo    Key: VITE_API_URL
echo    Value: [The URL you copied]
echo.
echo 4. Go to Deployments in Vercel and hit "Redeploy" so it uses the new URL!
echo ==============================================================================
echo Keep BOTH of the new black windows open while you want the AI to be online!
pause