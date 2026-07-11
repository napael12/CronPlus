@echo off
setlocal

:: ============================================================================
:: CronPlus - Windows Service Removal
:: Called by the Inno Setup uninstaller, or run manually.
::
:: Usage:
::   uninstall.bat [install_dir]
::
::   install_dir  Full path to the CronPlus installation directory.
::                Defaults to the parent of this batch file's directory.
:: ============================================================================

set "INSTALL_DIR=%~1"
if "%INSTALL_DIR%"=="" set "INSTALL_DIR=%~dp0.."

set "NSSM=%INSTALL_DIR%\service\nssm.exe"
set "SVC_WEB=CronPlus"
set "SVC_WORKER=CronPlusWorker"

echo.
echo ============================================================
echo  CronPlus - Removing Windows Services
echo ============================================================

:: Stop worker first (depends on web service)
sc query "%SVC_WORKER%" >nul 2>&1
if not errorlevel 1 (
    echo Stopping %SVC_WORKER%...
    net stop "%SVC_WORKER%" 2>nul
    if exist "%NSSM%" (
        "%NSSM%" remove "%SVC_WORKER%" confirm
    ) else (
        sc delete "%SVC_WORKER%"
    )
    echo %SVC_WORKER% removed.
) else (
    echo %SVC_WORKER% not found, skipping.
)

sc query "%SVC_WEB%" >nul 2>&1
if not errorlevel 1 (
    echo Stopping %SVC_WEB%...
    net stop "%SVC_WEB%" 2>nul
    if exist "%NSSM%" (
        "%NSSM%" remove "%SVC_WEB%" confirm
    ) else (
        sc delete "%SVC_WEB%"
    )
    echo %SVC_WEB% removed.
) else (
    echo %SVC_WEB% not found, skipping.
)

echo.
echo Services removed. Application data (databases, logs) were not deleted.
echo.

endlocal
exit /b 0
