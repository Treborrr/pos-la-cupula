@echo off
chcp 65001 > nul
title Desinstalar POS La Cupula

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo   Hay que ejecutarlo como ADMINISTRADOR.
    pause
    exit /b 1
)

echo.
echo   Esto quita el PROGRAMA pero NO borra los datos.
echo   Las ventas quedan en C:\POSCupula\datos
echo.
set /p CONFIRMA="Seguro? (S/N): "
if /i not "%CONFIRMA%"=="S" exit /b 0

"%~dp0nssm.exe" stop POSCupula
"%~dp0nssm.exe" remove POSCupula confirm
if exist "C:\POSCupula\app" rmdir /S /Q "C:\POSCupula\app"
del "%USERPROFILE%\Desktop\POS La Cupula.url" 2>nul

echo.
echo   Listo. Los datos siguen en C:\POSCupula\datos
pause
