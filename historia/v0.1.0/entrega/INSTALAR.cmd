@echo off
chcp 65001 > nul
title Instalar POS La Cupula
setlocal

REM Hace falta ser administrador para registrar un servicio de Windows.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Hay que ejecutar este archivo como ADMINISTRADOR.
    echo   Cierra esta ventana, haz clic derecho en INSTALAR.cmd
    echo   y elige "Ejecutar como administrador".
    echo.
    pause
    exit /b 1
)

echo.
echo   ========================================
echo    POS LA CUPULA - Instalacion v0.1.0
echo   ========================================
echo.

set DESTINO=C:\POSCupula
set ORIGEN=%~dp0

echo   [1/5] Creando carpetas en %DESTINO%...
if not exist "%DESTINO%\app" mkdir "%DESTINO%\app"
REM ATENCION: la carpeta de datos NO se toca nunca al reinstalar. Ahi viven las
REM ventas. Si se borrara, se pierde el negocio entero.
if not exist "%DESTINO%\datos" mkdir "%DESTINO%\datos"

echo   [2/5] Copiando el programa...
copy /Y "%ORIGEN%pos-cupula.exe" "%DESTINO%\app\" > nul
if exist "%DESTINO%\app\pwa" rmdir /S /Q "%DESTINO%\app\pwa"
xcopy /E /I /Q /Y "%ORIGEN%pwa" "%DESTINO%\app\pwa" > nul

echo   [3/5] Registrando el servicio de Windows...
"%ORIGEN%nssm.exe" stop POSCupula > nul 2>&1
"%ORIGEN%nssm.exe" remove POSCupula confirm > nul 2>&1
"%ORIGEN%nssm.exe" install POSCupula "%DESTINO%\app\pos-cupula.exe"
"%ORIGEN%nssm.exe" set POSCupula AppDirectory "%DESTINO%\app"
"%ORIGEN%nssm.exe" set POSCupula AppEnvironmentExtra POS_DATOS=%DESTINO%\datos PUERTO=7070
"%ORIGEN%nssm.exe" set POSCupula DisplayName "POS La Cupula"
"%ORIGEN%nssm.exe" set POSCupula Description "Punto de venta de LA CUPULA TATTOO BARBER SHOP"
"%ORIGEN%nssm.exe" set POSCupula Start SERVICE_AUTO_START
REM Si el proceso muere, que vuelva solo a los 5 segundos. Sin esto, un fallo
REM a las 3 de la tarde deja la barberia sin poder cobrar hasta que alguien
REM reinicie la PC.
"%ORIGEN%nssm.exe" set POSCupula AppExit Default Restart
"%ORIGEN%nssm.exe" set POSCupula AppRestartDelay 5000
"%ORIGEN%nssm.exe" set POSCupula AppStdout "%DESTINO%\registro\salida.log"
"%ORIGEN%nssm.exe" set POSCupula AppStderr "%DESTINO%\registro\error.log"
"%ORIGEN%nssm.exe" set POSCupula AppRotateFiles 1
"%ORIGEN%nssm.exe" set POSCupula AppRotateBytes 10485760

echo   [4/5] Arrancando...
"%ORIGEN%nssm.exe" start POSCupula
timeout /t 5 /nobreak > nul

echo   [5/5] Creando el acceso directo en el escritorio...
REM --app abre Edge SIN barra de direcciones ni pestanas: se ve y se usa como
REM un programa, y nadie puede navegar a otro lado por error.
set ACCESO=%USERPROFILE%\Desktop\POS La Cupula.url
echo [InternetShortcut] > "%ACCESO%"
echo URL=http://localhost:7070 >> "%ACCESO%"
echo IconFile=%DESTINO%\app\pos-cupula.exe >> "%ACCESO%"
echo IconIndex=0 >> "%ACCESO%"

echo.
echo   ========================================
echo    LISTO
echo   ========================================
echo.
echo    El POS quedo instalado y arranca solo con Windows.
echo.
echo    Ábrelo desde el acceso directo del escritorio,
echo    o entra a:  http://localhost:7070
echo.
echo    Desde un celular en el mismo WiFi, con la IP de esta PC:
ipconfig | findstr /C:"IPv4"
echo.
echo    PRIMERO QUE NADA, en Ajustes:
echo      1. Configura la ticketera y toca "Imprimir ticket de prueba"
echo      2. Configura la carpeta de respaldos externa
echo.
pause
