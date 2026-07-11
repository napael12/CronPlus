@echo off
setlocal EnableDelayedExpansion

:: ============================================================================
:: CronPlus - Windows Service Registration
:: Called by the Inno Setup installer during installation.
::
:: Usage:
::   install.bat <install_dir> <python_exe> <port>
::
::   install_dir  Full path to the CronPlus installation directory
::                e.g. C:\Program Files\CronPlus
::   python_exe   Full path to the Python executable to use for services
::                e.g. C:\Program Files\CronPlus\venv\Scripts\python.exe
::   port         TCP port the web server listens on (default: 8000)
:: ============================================================================

set "INSTALL_DIR=%~1"
set "PYTHON_EXE=%~2"
set "PORT=%~3"

if "%INSTALL_DIR%"=="" (
    echo ERROR: Install directory not specified.
    echo Usage: install.bat ^<install_dir^> ^<python_exe^> ^<port^>
    exit /b 1
)
if "%PYTHON_EXE%"=="" set "PYTHON_EXE=%INSTALL_DIR%\venv\Scripts\python.exe"
if "%PORT%"=="" set "PORT=8000"

set "NSSM=%INSTALL_DIR%\service\nssm.exe"
set "BACKEND=%INSTALL_DIR%\backend"
set "LOGS=%INSTALL_DIR%\logs"

set "SVC_WEB=CronPlus"
set "SVC_WORKER=CronPlusWorker"

echo.
echo ============================================================
echo  CronPlus - Registering Windows Services
echo ============================================================
echo   Install dir : %INSTALL_DIR%
echo   Python      : %PYTHON_EXE%
echo   Port        : %PORT%
echo   NSSM        : %NSSM%
echo.

if not exist "%NSSM%" (
    echo ERROR: nssm.exe not found at %NSSM%
    exit /b 1
)
if not exist "%PYTHON_EXE%" (
    echo ERROR: Python executable not found at %PYTHON_EXE%
    exit /b 1
)

:: Create log directory if it does not exist
if not exist "%LOGS%" mkdir "%LOGS%"

:: ── Remove existing services if already registered ────────────────────────────
sc query "%SVC_WORKER%" >nul 2>&1
if not errorlevel 1 (
    echo Removing existing %SVC_WORKER% service...
    net stop "%SVC_WORKER%" 2>nul
    "%NSSM%" remove "%SVC_WORKER%" confirm
)

sc query "%SVC_WEB%" >nul 2>&1
if not errorlevel 1 (
    echo Removing existing %SVC_WEB% service...
    net stop "%SVC_WEB%" 2>nul
    "%NSSM%" remove "%SVC_WEB%" confirm
)

:: ── CronPlus — Daphne ASGI web server ────────────────────────────────────────
echo Registering %SVC_WEB% (Daphne web server on port %PORT%)...
"%NSSM%" install "%SVC_WEB%" "%PYTHON_EXE%"
"%NSSM%" set "%SVC_WEB%" AppDirectory         "%BACKEND%"
"%NSSM%" set "%SVC_WEB%" AppParameters        "-m daphne -b 0.0.0.0 -p %PORT% cronplus.asgi:application"
"%NSSM%" set "%SVC_WEB%" DisplayName          "CronPlus Web Server"
"%NSSM%" set "%SVC_WEB%" Description          "CronPlus ASGI web server (Daphne). Serves the web UI and REST API."
"%NSSM%" set "%SVC_WEB%" Start                SERVICE_AUTO_START
"%NSSM%" set "%SVC_WEB%" AppStdout            "%LOGS%\daphne.log"
"%NSSM%" set "%SVC_WEB%" AppStderr            "%LOGS%\daphne-error.log"
"%NSSM%" set "%SVC_WEB%" AppRotateFiles       1
"%NSSM%" set "%SVC_WEB%" AppRotateOnline      1
"%NSSM%" set "%SVC_WEB%" AppRotateSeconds     86400
"%NSSM%" set "%SVC_WEB%" AppRotateBytes       10485760
"%NSSM%" set "%SVC_WEB%" AppRestartDelay      3000
if errorlevel 1 ( echo ERROR: Failed to register %SVC_WEB%. & exit /b 1 )

:: ── CronPlusWorker — Huey task queue ─────────────────────────────────────────
echo Registering %SVC_WORKER% (Huey task worker)...
"%NSSM%" install "%SVC_WORKER%" "%PYTHON_EXE%"
"%NSSM%" set "%SVC_WORKER%" AppDirectory       "%BACKEND%"
"%NSSM%" set "%SVC_WORKER%" AppParameters      "manage.py run_huey"
"%NSSM%" set "%SVC_WORKER%" DisplayName        "CronPlus Task Worker"
"%NSSM%" set "%SVC_WORKER%" Description        "CronPlus Huey task queue worker. Runs scheduled and queued workflow jobs."
"%NSSM%" set "%SVC_WORKER%" Start              SERVICE_AUTO_START
"%NSSM%" set "%SVC_WORKER%" AppStdout          "%LOGS%\huey.log"
"%NSSM%" set "%SVC_WORKER%" AppStderr          "%LOGS%\huey-error.log"
"%NSSM%" set "%SVC_WORKER%" AppRotateFiles     1
"%NSSM%" set "%SVC_WORKER%" AppRotateOnline    1
"%NSSM%" set "%SVC_WORKER%" AppRotateSeconds   86400
"%NSSM%" set "%SVC_WORKER%" AppRotateBytes     10485760
"%NSSM%" set "%SVC_WORKER%" AppRestartDelay    3000
"%NSSM%" set "%SVC_WORKER%" AppDependencies    "%SVC_WEB%"
if errorlevel 1 ( echo ERROR: Failed to register %SVC_WORKER%. & exit /b 1 )

:: ── Start services ────────────────────────────────────────────────────────────
echo Starting %SVC_WEB%...
net start "%SVC_WEB%"
if errorlevel 1 ( echo WARNING: %SVC_WEB% did not start cleanly. Check %LOGS%\daphne-error.log )

echo Starting %SVC_WORKER%...
net start "%SVC_WORKER%"
if errorlevel 1 ( echo WARNING: %SVC_WORKER% did not start cleanly. Check %LOGS%\huey-error.log )

echo.
echo ============================================================
echo  Installation complete.
echo  CronPlus is available at: http://localhost:%PORT%/
echo  Service logs:             %LOGS%\
echo ============================================================
echo.

endlocal
exit /b 0
