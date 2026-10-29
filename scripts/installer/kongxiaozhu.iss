; 控小助完整离线安装器。通过 scripts/build-installer.ps1 构建。
; 发布清单在构建时逐文件验哈希，不能直接用目录通配符替代。
#ifndef AppVersion
  #error 请使用 scripts/build-installer.ps1 构建。
#endif

[Setup]
AppId={{A270743A-50A0-4557-AB34-8B9A9B440F14}
AppName=控小助
AppVersion={#AppVersion}
AppVerName=控小助 {#AppVersion}
AppPublisher=控小助项目
DefaultDirName={userdesktop}\控小助程序
UsePreviousAppDir=no
DisableDirPage=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDirectory}
OutputBaseFilename={#SetupFileName}
SetupIconFile={#BrandIconFile}
Compression=lzma2/max
SolidCompression=yes
LZMANumBlockThreads=1
WizardStyle=modern
WizardResizable=no
UninstallDisplayIcon={app}\控小助.exe
UninstallDisplayName=控小助 {#AppVersion}
CreateUninstallRegKey=IntegrationEnabled
CloseApplications=no
RestartApplications=no
SetupMutex=KongxiaozhuSetup
SetupLogging=yes
AllowNoIcons=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Messages]
chinesesimplified.WelcomeLabel2=本安装包包含控小助所需的全部运行库，无需安装 Node.js 或单独下载浏览器。%n%n更新前请在控小助中保存实验并正常退出。安装和卸载均保留当前用户的实验记录与模型设置。%n%n默认安装到桌面的“控小助程序”文件夹。
chinesesimplified.FinishedLabel=控小助已经安装完成。您可以通过桌面快捷方式打开软件。

[Files]
#include ReleaseInclude

[Icons]
Name: "{userdesktop}\控小助"; Filename: "{app}\控小助.exe"; WorkingDir: "{app}"; IconFilename: "{app}\resources\app\dist\brand\app.ico"; AppUserModelID: "cn.kongxiaozhu.desktop"; Comment: "控小助 AI 控制实验工作台"; Check: IntegrationEnabled
Name: "{userprograms}\控小助"; Filename: "{app}\控小助.exe"; WorkingDir: "{app}"; IconFilename: "{app}\resources\app\dist\brand\app.ico"; AppUserModelID: "cn.kongxiaozhu.desktop"; Check: IntegrationEnabled

[Run]
Filename: "{app}\控小助.exe"; Description: "打开控小助"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Code]
const
  GENERIC_WRITE = $40000000;
  OPEN_EXISTING = 3;
  INVALID_FILE_ATTRIBUTES = $FFFFFFFF;

function CreateFile(FileName: string; DesiredAccess, ShareMode, SecurityAttributes, CreationDisposition, FlagsAndAttributes, TemplateFile: Cardinal): THandle;
  external 'CreateFileW@kernel32.dll stdcall';
function CloseHandle(Handle: THandle): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';
function GetFileAttributes(FileName: string): Cardinal;
  external 'GetFileAttributesW@kernel32.dll stdcall';

function IntegrationEnabled: Boolean;
begin
  { 仅用于本地隔离验收：仍解包同一完整安装器，跳过真实快捷方式和卸载注册。 }
  Result := ExpandConstant('{param:KXISOLATED|0}') <> '1';
end;

function HasReparseAncestor(Directory: string): Boolean;
var
  Attributes: Cardinal;
  Parent: string;
begin
  Result := False;
  while Length(Directory) > 3 do begin
    Attributes := GetFileAttributes(Directory);
    if (Attributes <> INVALID_FILE_ATTRIBUTES) and ((Attributes and FILE_ATTRIBUTE_REPARSE_POINT) <> 0) then begin
      Result := True;
      Exit;
    end;
    Parent := ExtractFileDir(Directory);
    if Parent = Directory then Exit;
    Directory := Parent;
  end;
end;

function ContainsReparsePoint(Directory: string): Boolean;
var
  Entry: TFindRec;
begin
  Result := False;
  if FindFirst(Directory + '\*', Entry) then begin
    try
      repeat
        if (Entry.Name <> '.') and (Entry.Name <> '..') then begin
          if (Entry.Attributes and FILE_ATTRIBUTE_REPARSE_POINT) <> 0 then begin
            Result := True;
            Exit;
          end;
          if ((Entry.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0) and ContainsReparsePoint(Directory + '\' + Entry.Name) then begin
            Result := True;
            Exit;
          end;
        end;
      until not FindNext(Entry);
    finally
      FindClose(Entry);
    end;
  end;
end;

function ValidateDestination: string;
var
  Directory, DataDirectory, Compact: string;
  ManifestText: AnsiString;
  Entry: TFindRec;
  IsEmpty: Boolean;
begin
  Result := '';
  Directory := RemoveBackslashUnlessRoot(ExpandFileName(ExpandConstant('{app}')));
  DataDirectory := RemoveBackslashUnlessRoot(ExpandConstant('{userappdata}\控小助'));
  if (Length(Directory) <= 3) or (CompareText(Directory, ExpandConstant('{userdesktop}')) = 0) or
      (CompareText(Copy(Directory + '\', 1, Length(DataDirectory) + 1), DataDirectory + '\') = 0) or
      (CompareText(Directory, ExpandConstant('{userappdata}')) = 0) or
      (CompareText(Copy(Directory + '\', 1, Length(ExpandConstant('{win}')) + 1), ExpandConstant('{win}\')) = 0) then begin
    Result := '请选择独立的“控小助程序”文件夹，不能安装到桌面根目录、系统目录或实验数据目录。';
    Exit;
  end;
  if HasReparseAncestor(Directory) then begin
    Result := '安装目录不能包含符号链接或目录联接，请选择普通文件夹。';
    Exit;
  end;
  if not DirExists(Directory) then Exit;
  IsEmpty := True;
  if FindFirst(Directory + '\*', Entry) then begin
    try
      repeat
        if (Entry.Name <> '.') and (Entry.Name <> '..') then IsEmpty := False;
      until not FindNext(Entry);
    finally
      FindClose(Entry);
    end;
  end;
  if IsEmpty then Exit;
  if not LoadStringFromFile(Directory + '\发布清单.json', ManifestText) then begin
    Result := '所选目录不为空，且没有控小助发布清单。请使用独立文件夹，避免覆盖其他文件。';
    Exit;
  end;
  Compact := string(ManifestText);
  StringChangeEx(Compact, ' ', '', True);
  StringChangeEx(Compact, #9, '', True);
  StringChangeEx(Compact, #13, '', True);
  StringChangeEx(Compact, #10, '', True);
  if Pos('"app":"kongxiaozhu-desktop"', Compact) = 0 then begin
    Result := '现有目录不属于控小助，未覆盖任何文件。';
    Exit;
  end;
  if ContainsReparsePoint(Directory) then
    Result := '现有程序目录内存在符号链接或目录联接，未覆盖任何文件。请先检查目录。';
end;

function InitializeUninstall: Boolean;
var
  Executable: string;
  Handle: THandle;
begin
  Result := True;
  Executable := ExpandConstant('{app}\控小助.exe');
  if FileExists(Executable) then begin
    Handle := CreateFile(Executable, GENERIC_WRITE, 0, 0, OPEN_EXISTING, 0, 0);
    if Handle = THandle(-1) then begin
      SuppressibleMsgBox('控小助正在运行或程序文件不可写。请先保存实验并正常退出，再运行卸载。', mbError, MB_OK, IDOK);
      Result := False;
    end else CloseHandle(Handle);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): string;
var
  Executable: string;
  Handle: THandle;
begin
  Result := ValidateDestination;
  if Result <> '' then Exit;
  Executable := ExpandConstant('{app}\控小助.exe');
  if FileExists(Executable) then begin
    { 只探测写入锁，不写入文件，也不强制结束运行中的软件。 }
    Handle := CreateFile(Executable, GENERIC_WRITE, 0, 0, OPEN_EXISTING, 0, 0);
    if Handle = THandle(-1) then
      Result := '控小助正在运行或程序文件不可写。请先保存实验并正常退出控小助，再重试安装。'
    else
      CloseHandle(Handle);
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Problem: string;
begin
  Result := True;
  if (CurPageID = wpSelectDir) and not WizardSilent then begin
    Problem := ValidateDestination;
    if Problem <> '' then begin
      MsgBox(Problem, mbError, MB_OK);
      Result := False;
    end;
  end;
end;
