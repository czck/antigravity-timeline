@echo off
chcp 65001 >nul
echo 正在卸载 Antigravity Chat Timeline...
node "%~dp0scripts\uninstall.js" %*
pause
