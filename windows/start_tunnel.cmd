@echo off
setlocal EnableExtensions

set "CONFIG=%USERPROFILE%\.claude-ball\tunnel.conf"
set "LOG=%USERPROFILE%\claude-status-ball-tunnel.log"

if not exist "%CONFIG%" (
  echo [%date% %time%] Missing config: %CONFIG%>>"%LOG%"
  echo Copy windows\tunnel.conf.example to that path and set SERVER.>>"%LOG%"
  exit /b 1
)

for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CONFIG%") do set "%%A=%%B"

if not defined SERVER (
  echo [%date% %time%] SERVER is empty in %CONFIG%>>"%LOG%"
  exit /b 1
)
if not defined SSH_PORT set "SSH_PORT=22"
if not defined REMOTE_PORT set "REMOTE_PORT=47831"
if not defined LOCAL_PORT set "LOCAL_PORT=47831"

if not defined SSH_EXE set "SSH_EXE=%SystemRoot%\System32\OpenSSH\ssh.exe"
if not exist "%SSH_EXE%" set "SSH_EXE=%SystemRoot%\Sysnative\OpenSSH\ssh.exe"
if not exist "%SSH_EXE%" (
  echo [%date% %time%] ssh.exe not found. Set SSH_EXE in %CONFIG%.>>"%LOG%"
  exit /b 1
)

:loop
echo [%date% %time%] ssh=%SSH_EXE% server=%SERVER%>>"%LOG%"
"%SSH_EXE%" -E "%LOG%" -N -p "%SSH_PORT%" -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R "%REMOTE_PORT%:127.0.0.1:%LOCAL_PORT%" "%SERVER%"
echo [%date% %time%] ssh exited: %errorlevel%>>"%LOG%"
ping -n 11 127.0.0.1 >nul
goto loop
