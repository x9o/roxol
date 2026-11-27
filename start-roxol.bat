@echo off
node "%~dp0tools\mcp\launch-windows.mjs"
if errorlevel 1 (
    pause
    exit /b 1
)
