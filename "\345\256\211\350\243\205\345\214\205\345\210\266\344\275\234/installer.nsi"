; 时迹 · 安装脚本 (NSIS 3, Unicode)
; 用户级安装：无需管理员权限，安装到 %LOCALAPPDATA%\Programs\时迹
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 32
SetDatablockOptimize on

!define APP_NAME      "时迹"
!define APP_EXE       "时迹.exe"
!define APP_VERSION   "1.0.0"
!define APP_PUBLISHER "Velpro"
!define UNINST_KEY    "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
!define DATA_DIR      "$APPDATA\habit-lab"
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=2052 "FileDescription" "${APP_NAME}安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APP_VERSION}"

Name              "${APP_NAME} ${APP_VERSION}"
OutFile           "时迹-${APP_VERSION}-Setup.exe"
InstallDir        "$LOCALAPPDATA\Programs\时迹"
InstallDirRegKey  HKCU "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel user
ShowInstDetails   show
ShowUnInstDetails show
BrandingText      "${APP_NAME} v${APP_VERSION}"
SetOverwrite      on
CRCCheck          on

!include "MUI2.nsh"
!include "nsDialogs.nsh"

!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

!define MUI_ICON   "logo.ico"
!define MUI_UNICON "logo.ico"
!define MUI_ABORTWARNING
!define MUI_UNABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "license.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
Page custom pgFinishCreate pgFinishLeave   ; 完成页：两个可选动作（立即启动 / 设为开机自启）
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

; ============ 完成页（两个勾选项，避免空壳选项） ============
Var CBOX_RUN
Var CBOX_AUTO
Function pgFinishCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 12u 100% 22u "安装完成！${APP_NAME} ${APP_VERSION} 已就绪。"
  ${NSD_CreateCheckBox} 12u 52u 100% 14u "立即启动 ${APP_NAME}"
  Pop $CBOX_RUN
  ${NSD_SetState} $CBOX_RUN ${BST_CHECKED}
  ${NSD_CreateCheckBox} 12u 74u 100% 30u "设为开机自启（登录 Windows 时自动运行，方便随时记录习惯）"
  Pop $CBOX_AUTO
  ${NSD_SetState} $CBOX_AUTO ${BST_CHECKED}
  nsDialogs::Show
FunctionEnd
Function pgFinishLeave
  ${NSD_GetState} $CBOX_RUN $0
  ${NSD_GetState} $CBOX_AUTO $1
  ${If} $1 <> 0
    WriteRegStr HKCU "${RUN_KEY}" "${APP_NAME}" '"$INSTDIR\${APP_EXE}"'
  ${EndIf}
  ${If} $0 <> 0
    ExecShell "" "$INSTDIR\${APP_EXE}"
  ${EndIf}
FunctionEnd

; ============ 安装 ============
Section "主程序 (必需)" SEC_MAIN
  SectionIn RO
  SetShellVarContext current

  ; Wait for the application's own save handshake instead of force-killing drafts.
  wait_app_exit:
  FindWindow $0 "" "${APP_NAME}"
  StrCmp $0 0 app_exited
  MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "请先从托盘正常退出时迹，再点重试。未保存内容会由应用写入磁盘。" /SD IDCANCEL IDRETRY wait_app_exit
  Abort
  app_exited:

  SetOutPath "$INSTDIR"
  File /r "payload\*.*"
  ; 图标单独安装：electron-builder 的 win-unpacked 不含 logo.ico，
  ; 而下面 5 处（DisplayIcon + 3 个快捷方式 + 卸载项）都引用 $INSTDIR\logo.ico。
  ; 不加这一行 → 快捷方式与卸载项图标全部为空（历史漏装）。
  File "logo.ico"

  ; 卸载程序与卸载信息
  WriteUninstaller "$INSTDIR\uninst.exe"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr   HKCU "${UNINST_KEY}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr   HKCU "${UNINST_KEY}" "UninstallString" "$INSTDIR\uninst.exe"
  WriteRegStr   HKCU "${UNINST_KEY}" "QuietUninstallString" "$INSTDIR\uninst.exe /S"
  WriteRegStr   HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayIcon"     "$INSTDIR\logo.ico"
  WriteRegStr   HKCU "${UNINST_KEY}" "HelpLink"        ""
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" 221000
SectionEnd

Section "开始菜单快捷方式" SEC_STARTMENU
  SectionIn 1 2
  SetShellVarContext current
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\logo.ico" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "$INSTDIR\uninst.exe" "" "$INSTDIR\logo.ico" 0
SectionEnd

Section "桌面快捷方式" SEC_DESKTOP
  SectionIn 1 2
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\logo.ico" 0
SectionEnd

LangString DESC_SEC_MAIN      ${LANG_SimpChinese} "程序本体与运行时（约 214 MB）"
LangString DESC_SEC_STARTMENU ${LANG_SimpChinese} "在开始菜单创建程序与卸载入口"
LangString DESC_SEC_DESKTOP   ${LANG_SimpChinese} "在桌面创建图标，双击即可打开"

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MAIN}      $(DESC_SEC_MAIN)
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_STARTMENU} $(DESC_SEC_STARTMENU)
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP}   $(DESC_SEC_DESKTOP)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ============ 卸载 ============
Section "Uninstall"
  SetShellVarContext current

  wait_uninstall_exit:
  FindWindow $0 "" "${APP_NAME}"
  StrCmp $0 0 uninstall_app_exited
  MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "请先从托盘正常退出时迹，再点重试。" /SD IDCANCEL IDRETRY wait_uninstall_exit
  Abort
  uninstall_app_exited:

  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegValue HKCU "${RUN_KEY}" "${APP_NAME}"    ; 清掉完成页勾选写入的开机自启
  RMDir /r "$SMPROGRAMS\${APP_NAME}"
  ; Generated from this build's payload; unknown files and data/ are preserved.
  !include "payload-uninstall.nsh"
  Delete "$INSTDIR\logo.ico"
  Delete "$INSTDIR\uninst.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${UNINST_KEY}"

  ; 删除数据必须【用户显式点「是」】才执行——点「否」或直接关掉对话框都保留数据。
  ; /SD IDNO：静默卸载（uninst.exe /S，即「设置→应用→卸载」与 QuietUninstallString）
  ;   下 MessageBox 的默认返回值。**必须是 IDNO**：数据删除是不可恢复操作，
  ;   静默路径绝不能替用户做「删除」这个决定。
  ;   历史坑：此处原先无 /SD，曾注释为「静默卸载 MessageBox 自动返回 IDOK」——那是错的。
  ;   NSIS 只在给了 /SD 时才在静默模式自动应答；没有 /SD 的 MessageBox 在 /S 下会
  ;   照常弹框而无人应答，表现为「卸载卡住不完成」。切勿改成 /SD IDYES。
  MessageBox MB_YESNO|MB_DEFBUTTON2|MB_ICONQUESTION \
    "是否删除默认用户目录中的打卡数据？$\r$\n$\r$\n选择「是」将删除默认目录中的记录（不可恢复）。$\r$\n选择「否」保留记录。程序旁的 data 文件夹和自定义目录始终保留。" \
    /SD IDNO \
    IDYES del_data
  Goto keep_data
  del_data:
  IfFileExists "${DATA_DIR}\*.*" 0 keep_data
    RMDir /r "${DATA_DIR}"
  keep_data:
SectionEnd
