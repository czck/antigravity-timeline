@echo off
chcp 65001 >nul
echo 正在安装 Antigravity Chat Timeline...
node "%~dp0scripts\install.js" %*
pause
