@echo off
setlocal

call "%~dp0launcher\knowmesh.cmd" %*
exit /b %ERRORLEVEL%
