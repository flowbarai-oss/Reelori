Unicode true
!include "MUI2.nsh"
!ifndef APP_VERSION
  !error "APP_VERSION is required"
!endif
!ifndef PACKAGE_DIR
  !error "PACKAGE_DIR is required"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is required"
!endif
!ifndef UNINSTALL_FILES
  !error "UNINSTALL_FILES is required"
!endif

Name "Reelori"
OutFile "${OUTPUT_FILE}"
Icon "${__FILEDIR__}\Reelori.ico"
UninstallIcon "${__FILEDIR__}\Reelori.ico"
InstallDir "$LOCALAPPDATA\Programs\Reelori"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetShellVarContext current
  StrCmp $INSTDIR "$LOCALAPPDATA\Programs\Reelori" +2 0
    Abort "Unsupported install path"
  IfFileExists "$INSTDIR\current.txt" 0 +2
    Abort "Existing Reelori installation found. Upgrade transactions are not enabled in this preview."
FunctionEnd

Section "Reelori" SecMain
  SetOutPath "$INSTDIR\versions\${APP_VERSION}"
  File /r "${PACKAGE_DIR}\*.*"
  SetOutPath "$INSTDIR"
  File "${__FILEDIR__}\Launch.ps1"
  File "${__FILEDIR__}\Reelori.ico"
  FileOpen $0 "$INSTDIR\current.txt" w
  FileWrite $0 "${APP_VERSION}"
  FileClose $0
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Reelori"
  CreateShortCut "$SMPROGRAMS\Reelori\Reelori.lnk" "$INSTDIR\versions\${APP_VERSION}\desktop\Reelori.exe" "" "$INSTDIR\versions\${APP_VERSION}\Reelori.ico"
  CreateShortCut "$DESKTOP\Reelori.lnk" "$INSTDIR\versions\${APP_VERSION}\desktop\Reelori.exe" "" "$INSTDIR\versions\${APP_VERSION}\Reelori.ico"
  CreateShortCut "$SMPROGRAMS\Reelori\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reelori" "DisplayName" "Reelori"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reelori" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reelori" "DisplayIcon" "$INSTDIR\versions\${APP_VERSION}\Reelori.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reelori" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  StrCmp $INSTDIR "$LOCALAPPDATA\Programs\Reelori" +2 0
    Abort "Unsupported uninstall path"
  Delete "$SMPROGRAMS\Reelori\Reelori.lnk"
  Delete "$DESKTOP\Reelori.lnk"
  Delete "$SMPROGRAMS\Reelori\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Reelori"
  Delete "$INSTDIR\Launch.ps1"
  Delete "$INSTDIR\Reelori.ico"
  Delete "$INSTDIR\current.txt"
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR\versions\${APP_VERSION}"
  RMDir "$INSTDIR\versions"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reelori"
  ; Never touch $LOCALAPPDATA\Reelori: that directory contains user work.
SectionEnd
