@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0" || exit /b 1
if not exist ".venv\Scripts\python.exe" (
    echo 找不到项目的 .venv\Scripts\python.exe，请先安装项目依赖。
    pause
    popd
    exit /b 1
)
set "PATH=%CD%\.venv\Scripts;%PATH%"
".venv\Scripts\python.exe" start.py %*
set "result=%errorlevel%"
if not "%result%"=="0" pause
popd
exit /b %result%
