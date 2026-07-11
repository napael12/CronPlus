; ============================================================================
; CronPlus - Inno Setup Installer Script
;
; Prerequisites (on the build machine):
;   - Inno Setup 6.x  (https://jrsoftware.org/isinfo.php)
;   - nssm.exe present at service\nssm.exe
;     (download from https://nssm.cc/download)
;
; Prerequisites (on the target machine):
;   - Windows 10 / Server 2019 or later (64-bit)
;   - Python 3.11+ installed and present in PATH
;   - Frontend already built:  cd frontend && npm run build
;
; To compile:
;   iscc setup.iss
;   -- or open in Inno Setup IDE and press Compile (Ctrl+F9)
;
; Output: ..\dist\CronPlus-Setup-<version>.exe
; ============================================================================

#define AppName    "CronPlus"
#define AppVersion "1.0.0"
#define AppPublisher "CronPlus"
#define SvcWeb     "CronPlus"
#define SvcWorker  "CronPlusWorker"

[Setup]
AppId={{B7A4E6F3-3C21-4D8A-9B12-E5F07A1C3D29}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppVerName={#AppName} {#AppVersion}
DefaultDirName={commonpf64}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=CronPlus-Setup-{#AppVersion}
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=no
DisableDirPage=no
DisableReadyPage=no
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\service\nssm.exe
ChangesEnvironment=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; ── Files ─────────────────────────────────────────────────────────────────────

[Files]
; Backend Python application
; Excludes: compiled bytecode, dev databases, test suite, cached statics
Source: "..\backend\*"; \
    DestDir: "{app}\backend"; \
    Flags: recursesubdirs createallsubdirs ignoreversion; \
    Excludes: "__pycache__\*,__pycache__,*.pyc,*.pyo,*.pyd, \
               cronplus.db,cronplus.db-shm,cronplus.db-wal, \
               huey.db,huey.db-shm,huey.db-wal, \
               .pytest_cache,staticfiles,tests,.env"

; Service tools
Source: "nssm.exe";        DestDir: "{app}\service"; Flags: ignoreversion
Source: "install.bat";     DestDir: "{app}\service"; Flags: ignoreversion
Source: "uninstall.bat";   DestDir: "{app}\service"; Flags: ignoreversion
Source: "create_admin.py"; DestDir: "{app}\service"; Flags: ignoreversion

; ── Directories ───────────────────────────────────────────────────────────────

[Dirs]
Name: "{app}\logs"
Name: "{app}\dist"

; ── Start Menu ────────────────────────────────────────────────────────────────

[Icons]
Name: "{group}\Open CronPlus";          Filename: "{app}\service\CronPlus.url"
Name: "{group}\Edit Configuration";     Filename: "{app}\backend\.env"
Name: "{group}\View Logs";              Filename: "{app}\logs"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"

; ── Uninstall ─────────────────────────────────────────────────────────────────

[UninstallRun]
; Stop and remove Windows services before uninstalling files
Filename: "{app}\service\uninstall.bat"; \
    Parameters: """{app}"""; \
    Flags: runhidden waituntilterminated; \
    RunOnceId: "StopServices"

[UninstallDelete]
; Remove runtime-generated files that the uninstaller won't know about
; Data files (databases, .env) are intentionally NOT deleted to preserve user data.
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\venv"
Type: files;          Name: "{app}\service\CronPlus.url"
Type: files;          Name: "{app}\service\admin.cred"

; ── Custom Messages ───────────────────────────────────────────────────────────

[CustomMessages]
FinishedLabel=CronPlus has been installed successfully.%n%nThe web interface is available at:%n%n    http://localhost:%1/%n%nLog in with the admin credentials you specified during setup.%n%nService logs are written to:%n    {app}\logs\

; ============================================================================
; Pascal Code — wizard pages, validation, .env generation, setup execution
; ============================================================================

[Code]

var
  ConfigPage: TInputQueryWizardPage;  // Port + Allowed Hosts
  AdminPage:  TInputQueryWizardPage;  // Admin email + password
  SetupLog:   String;                 // Accumulated execution log

{ ── Secret key generation ─────────────────────────────────────────────────── }

function GenerateSecretKey: String;
var
  Chars: String;
  Key:   String;
  i:     Integer;
begin
  //Randomize;
  Chars := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#%^*-_=+';
  Key   := '';
  for i := 1 to 50 do
    Key := Key + Chars[Random(Length(Chars)) + 1];
  Result := Key;
end;

{ ── Wizard initialisation ──────────────────────────────────────────────────── }

procedure InitializeWizard;
begin
  ConfigPage := CreateInputQueryPage(wpSelectDir,
    'Server Configuration',
    'Configure the CronPlus web server',
    'Specify the port CronPlus will listen on and which host names are permitted.');
  ConfigPage.Add('Port number:', False);
  ConfigPage.Values[0] := '8000';
  ConfigPage.Add('Allowed hosts (comma-separated):', False);
  ConfigPage.Values[1] := 'localhost,127.0.0.1';

  AdminPage := CreateInputQueryPage(ConfigPage.ID,
    'Administrator Account',
    'Create the initial CronPlus administrator',
    'These credentials will be used to log into CronPlus after installation.');
  AdminPage.Add('Admin email:', False);
  AdminPage.Values[0] := 'admin@example.com';
  AdminPage.Add('Admin password (minimum 8 characters):', True);
  AdminPage.Values[1] := '';
end;

{ ── Per-page validation ────────────────────────────────────────────────────── }

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Port: Integer;
begin
  Result := True;

  if CurPageID = ConfigPage.ID then
  begin
    Port := StrToIntDef(Trim(ConfigPage.Values[0]), 0);
    if (Port < 1) or (Port > 65535) then
    begin
      MsgBox('Please enter a valid port number between 1 and 65535.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if Trim(ConfigPage.Values[1]) = '' then
    begin
      MsgBox('Allowed hosts cannot be empty. Enter at least one hostname or IP address.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;

  if CurPageID = AdminPage.ID then
  begin
    if Pos('@', AdminPage.Values[0]) = 0 then
    begin
      MsgBox('Please enter a valid email address for the admin account.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if Length(AdminPage.Values[1]) < 8 then
    begin
      MsgBox('The admin password must be at least 8 characters long.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;
end;

{ ── Check Python is available before starting ──────────────────────────────── }

function InitializeSetup: Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  if not Exec(ExpandConstant('{sys}\cmd.exe'), '/c python --version',
              '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or
     (ResultCode <> 0) then
  begin
    MsgBox(
      'Python 3.11 or later is required but was not found in PATH.' + #13#10#13#10 +
      'Please install Python from https://www.python.org/downloads/' + #13#10 +
      'and ensure "Add Python to PATH" is checked during installation,' + #13#10 +
      'then run this installer again.',
      mbCriticalError, MB_OK);
    Result := False;
  end;
end;

{ ── File writers ───────────────────────────────────────────────────────────── }

procedure WriteEnvFile;
var
  Port:    String;
  Hosts:   String;
  Content: String;
begin
  Port  := Trim(ConfigPage.Values[0]);
  Hosts := Trim(ConfigPage.Values[1]);

  Content :=
    '# CronPlus configuration — generated by installer' + #13#10 +
    '# Edit this file to change settings, then restart both Windows services.' + #13#10 +
    '' + #13#10 +
    'SECRET_KEY=' + GenerateSecretKey + #13#10 +
    'DEBUG=false' + #13#10 +
    'ALLOWED_HOSTS=' + Hosts + #13#10 +
    'CSRF_TRUSTED_ORIGINS=' +
        'http://localhost:' + Port + ',' +
        'http://127.0.0.1:' + Port + #13#10 +
    '' + #13#10 +
    'DB_NAME=cronplus.db' + #13#10 +
    'HUEY_WORKERS=4' + #13#10 +
    'SESSION_COOKIE_AGE=86400' + #13#10 +
    'LOG_MAX_OUTPUT_BYTES=10485760' + #13#10 +
    'LOG_RETENTION_DAYS=60' + #13#10 +
    '' + #13#10 +
    '# SMTP notifications (optional — configure in Admin -> Settings UI instead)' + #13#10 +
    '#NOTIFICATION_MAILHOST=smtp.example.com:587' + #13#10 +
    '#NOTIFICATION_SENDER=cronplus@example.com' + #13#10 +
    '#CRONPLUS_INSTANCE_NAME=' + ExpandConstant('{#AppName}') + #13#10;

  if not SaveStringToFile(ExpandConstant('{app}\backend\.env'), Content, False) then
    MsgBox('Warning: could not write .env file. Check permissions on ' +
           ExpandConstant('{app}\backend\'), mbError, MB_OK);
end;

procedure WriteCredFile;
begin
  { Write credentials to a temporary file read by create_admin.py.
    The script deletes this file immediately after reading it. }
  SaveStringToFile(
    ExpandConstant('{app}\service\admin.cred'),
    AdminPage.Values[0] + #13#10 + AdminPage.Values[1] + #13#10,
    False
  );
end;

procedure WriteUrlShortcut;
var
  Port: String;
begin
  Port := Trim(ConfigPage.Values[0]);
  SaveStringToFile(
    ExpandConstant('{app}\service\CronPlus.url'),
    '[InternetShortcut]' + #13#10 +
    'URL=http://localhost:' + Port + '/' + #13#10,
    False
  );
end;

{ ── Command runner with progress label and log ─────────────────────────────── }

function RunCmd(Exe, Params, WorkDir, StatusMsg: String): Boolean;
var
  ResultCode: Integer;
begin
  WizardForm.StatusLabel.Caption := StatusMsg;
  SetupLog := SetupLog + '> ' + Exe + ' ' + Params + #13#10;
  Result := Exec(Exe, Params, WorkDir, SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if (not Result) or (ResultCode <> 0) then
  begin
    SetupLog := SetupLog + '  FAILED (exit code ' + IntToStr(ResultCode) + ')' + #13#10;
    MsgBox(
      StatusMsg + ' failed.' + #13#10#13#10 +
      'Command:   ' + Exe + ' ' + Params + #13#10 +
      'Exit code: ' + IntToStr(ResultCode) + #13#10#13#10 +
      'Check that Python 3.11+ is installed and all prerequisites are met.' + #13#10 +
      'See ' + ExpandConstant('{app}\logs\') + ' for service logs after first boot.',
      mbError, MB_OK
    );
    Result := False;
  end else
    SetupLog := SetupLog + '  OK' + #13#10;
end;

{ ── Main post-install sequence ─────────────────────────────────────────────── }

procedure CurStepChanged(CurStep: TSetupStep);
var
  AppDir:     String;
  BackendDir: String;
  VenvPython: String;
  ServiceDir: String;
  Port:       String;
begin
  if CurStep <> ssPostInstall then Exit;

  AppDir     := ExpandConstant('{app}');
  BackendDir := AppDir + '\backend';
  VenvPython := AppDir + '\venv\Scripts\python.exe';
  ServiceDir := AppDir + '\service';
  Port       := Trim(ConfigPage.Values[0]);

  { 1. Write configuration and credential files }
  WriteEnvFile;
  WriteCredFile;
  WriteUrlShortcut;

  { 2. Create Python virtual environment }
  if not RunCmd(
    ExpandConstant('{sys}\cmd.exe'),
    '/c python -m venv "' + AppDir + '\venv"',
    AppDir,
    'Creating Python virtual environment...'
  ) then Exit;

  { 3. Upgrade pip silently }
  RunCmd(
    VenvPython,
    '-m pip install --upgrade pip --quiet',
    BackendDir,
    'Upgrading pip...'
  );

  { 4. Install Python dependencies }
  if not RunCmd(
    VenvPython,
    '-m pip install -r "' + BackendDir + '\requirements.txt" --quiet',
    BackendDir,
    'Installing Python dependencies (this may take a minute)...'
  ) then Exit;

  { 5. Run database migrations }
  if not RunCmd(
    VenvPython,
    '"' + BackendDir + '\manage.py" migrate --noinput',
    BackendDir,
    'Running database migrations...'
  ) then Exit;

  { 6. Collect static files }
  if not RunCmd(
    VenvPython,
    '"' + BackendDir + '\manage.py" collectstatic --noinput',
    BackendDir,
    'Collecting static files...'
  ) then Exit;

  { 7. Create admin user }
  if not RunCmd(
    VenvPython,
    '"' + ServiceDir + '\create_admin.py"',
    BackendDir,
    'Creating administrator account...'
  ) then Exit;

  { 8. Register and start Windows services }
  if not RunCmd(
    ServiceDir + '\install.bat',
    '"' + AppDir + '" "' + VenvPython + '" "' + Port + '"',
    ServiceDir,
    'Registering Windows services...'
  ) then Exit;
end;

{ ── Customise the Finished page label ─────────────────────────────────────── }

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo,
  MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result :=
    MemoDirInfo + NewLine + NewLine +
    'Server port:   ' + Trim(ConfigPage.Values[0]) + NewLine +
    'Allowed hosts: ' + Trim(ConfigPage.Values[1]) + NewLine +
    'Admin email:   ' + AdminPage.Values[0];
end;

