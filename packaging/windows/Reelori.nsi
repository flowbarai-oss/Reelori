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
  ; Never overwrite a version that might be running. A different version is staged
  ; beside the current one; the verified updater switches current.txt afterwards.
  IfFileExists "$INSTDIR\current.txt" 0 init_done
    FileOpen $0 "$INSTDIR\current.txt" r
    FileRead $0 $1
    FileClose $0
    StrCmp $1 "${APP_VERSION}" 0 init_done
      Abort "This Reelori version is already active."
  init_done:
FunctionEnd

Section "Reelori" SecMain
  SetOutPath "$INSTDIR\versions\${APP_VERSION}"
  File /r "${PACKAGE_DIR}\*.*"
  SetOutPath "$INSTDIR"
  File "${__FILEDIR__}\Launch.ps1"
  File "${__FILEDIR__}\Reelori.ico"
  IfFileExists "$INSTDIR\current.txt" staged_install
    FileOpen $0 "$INSTDIR\current.txt" w
    FileWrite $0 "${APP_VERSION}"
    FileClose $0
    Goto pointer_done
  staged_install:
    FileOpen $0 "$INSTDIR\staged.txt" w
    FileWrite $0 "${APP_VERSION}"
    FileClose $0
  pointer_done:
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Reelori"
  CreateShortCut "$SMPROGRAMS\Reelori\Reelori.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $\"$INSTDIR\Launch.ps1$\"" "$INSTDIR\Reelori.ico"
  CreateShortCut "$DESKTOP\Reelori.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $\"$INSTDIR\Launch.ps1$\"" "$INSTDIR\Reelori.ico"
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
  Delete "$INSTDIR\current.next"
  Delete "$INSTDIR\current.bak"
  Delete "$INSTDIR\staged.txt"
  Delete "$INSTDIR\previous.txt"
  ; User projects live under $LOCALAPPDATA\Reelori, outside this program root.
  RMDir /r "$INSTDIR\versions"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reelori"
  ; Never touch $LOCALAPPDATA\Reelori: that directory contains user work.
SectionEnd
