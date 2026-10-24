# The Tube Desktop: the installer's "Choose your settings" page.
# electron-builder includes this file in both the installer and uninstaller builds,
# so everything the uninstaller never uses sits behind BUILD_UNINSTALLER (warnings are errors).

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var ttdFresh        ; 1 when there are no settings yet (a first install)
  Var ttdDesktop
  Var ttdStartup
  Var ttdTray
  Var ttdHideWatched
  Var ttdSponsor
  Var ttdDislikes
  Var ttdBoxDesktop
  Var ttdBoxStartup
  Var ttdBoxTray
  Var ttdBoxHideWatched
  Var ttdBoxSponsor
  Var ttdBoxDislikes

  !macro customInit
    StrCpy $ttdDesktop ${BST_CHECKED}
    StrCpy $ttdStartup ${BST_UNCHECKED}
    StrCpy $ttdTray ${BST_UNCHECKED}
    StrCpy $ttdHideWatched ${BST_UNCHECKED}
    StrCpy $ttdSponsor ${BST_CHECKED}
    StrCpy $ttdDislikes ${BST_CHECKED}
    # Settings live in the user's own AppData, even for an install for everyone.
    SetShellVarContext current
    ${If} ${FileExists} "$APPDATA\${PRODUCT_NAME}\settings.json"
      StrCpy $ttdFresh 0
    ${Else}
      StrCpy $ttdFresh 1
    ${EndIf}
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    Page custom ttdOptionsShow ttdOptionsLeave

    Function ttdOptionsShow
      # Updates keep the shortcut and settings the user already has.
      ${If} ${isUpdated}
        Abort
      ${EndIf}
      !insertmacro MUI_HEADER_TEXT "Choose your settings" "You can change all of these later in Settings (Ctrl+,)."
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateCheckbox} 0 0 100% 12u "Create a desktop shortcut"
      Pop $ttdBoxDesktop
      ${NSD_SetState} $ttdBoxDesktop $ttdDesktop

      ${If} $ttdFresh == 1
        ${NSD_CreateCheckbox} 0 20u 100% 12u "Start The Tube Desktop when I sign in to Windows"
        Pop $ttdBoxStartup
        ${NSD_SetState} $ttdBoxStartup $ttdStartup
        ${NSD_CreateCheckbox} 0 36u 100% 12u "Keep running in the tray when I close the window"
        Pop $ttdBoxTray
        ${NSD_SetState} $ttdBoxTray $ttdTray
        ${NSD_CreateCheckbox} 0 52u 100% 12u "Hide videos I've already watched"
        Pop $ttdBoxHideWatched
        ${NSD_SetState} $ttdBoxHideWatched $ttdHideWatched
        ${NSD_CreateCheckbox} 0 68u 100% 12u "Skip sponsor segments (SponsorBlock)"
        Pop $ttdBoxSponsor
        ${NSD_SetState} $ttdBoxSponsor $ttdSponsor
        ${NSD_CreateCheckbox} 0 84u 100% 12u "Show dislike counts (Return YouTube Dislike)"
        Pop $ttdBoxDislikes
        ${NSD_SetState} $ttdBoxDislikes $ttdDislikes
      ${Else}
        ${NSD_CreateLabel} 0 24u 100% 24u "Your existing settings will be kept."
        Pop $0
      ${EndIf}

      nsDialogs::Show
    FunctionEnd

    Function ttdOptionsLeave
      ${NSD_GetState} $ttdBoxDesktop $ttdDesktop
      ${If} $ttdFresh == 1
        ${NSD_GetState} $ttdBoxStartup $ttdStartup
        ${NSD_GetState} $ttdBoxTray $ttdTray
        ${NSD_GetState} $ttdBoxHideWatched $ttdHideWatched
        ${NSD_GetState} $ttdBoxSponsor $ttdSponsor
        ${NSD_GetState} $ttdBoxDislikes $ttdDislikes
      ${EndIf}
    FunctionEnd
  !macroend

  # Writes "key": true|false for a checkbox state.
  !macro ttdWriteBool handle key state comma
    ${If} ${state} == ${BST_CHECKED}
      FileWrite ${handle} '  "${key}": true${comma}$\r$\n'
    ${Else}
      FileWrite ${handle} '  "${key}": false${comma}$\r$\n'
    ${EndIf}
  !macroend

  !macro customInstall
    ${IfNot} ${isUpdated}
      ${If} $ttdDesktop == ${BST_CHECKED}
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      ${EndIf}

      # The app reads this once on its first start, applies it and deletes it
      # (src/main/installOptions.ts).
      ${If} $ttdFresh == 1
        SetShellVarContext current
        CreateDirectory "$APPDATA\${PRODUCT_NAME}"
        FileOpen $0 "$APPDATA\${PRODUCT_NAME}\install-options.json" w
        ${If} $0 != ""
          FileWrite $0 '{$\r$\n'
          !insertmacro ttdWriteBool $0 startWithWindows $ttdStartup ","
          !insertmacro ttdWriteBool $0 closeToTray $ttdTray ","
          !insertmacro ttdWriteBool $0 hideWatched $ttdHideWatched ","
          !insertmacro ttdWriteBool $0 sponsorBlock $ttdSponsor ","
          !insertmacro ttdWriteBool $0 showDislikes $ttdDislikes ""
          FileWrite $0 '}$\r$\n'
          FileClose $0
        ${EndIf}
        ${If} $installMode == "all"
          SetShellVarContext all
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !macroend
!endif

# The desktop shortcut is ours (createDesktopShortcut is off), so remove it ourselves,
# except during an update, which keeps it.
!macro customUnInstall
  ${ifNot} ${isKeepShortcuts}
    WinShell::UninstShortcut "$oldDesktopLink"
    Delete "$oldDesktopLink"
  ${endIf}
!macroend
