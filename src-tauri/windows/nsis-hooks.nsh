; Copy load-time ORT helper DLLs next to AuroraBook.exe after install.
; Windows only resolves these beside the exe (not under resources/).
; Mapping them to the install root via bundle.resources map breaks tauri_build
; on Windows ("The system cannot find the path specified"), so we ship them
; under resources/ort-dylibs/ and promote them here at install time.
!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\resources\ort-dylibs\webgpu_dawn.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\ort-dylibs\webgpu_dawn.dll" "$INSTDIR\"

  IfFileExists "$INSTDIR\resources\ort-dylibs\DirectML.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\ort-dylibs\DirectML.dll" "$INSTDIR\"

  IfFileExists "$INSTDIR\resources\ort-dylibs\dxil.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\ort-dylibs\dxil.dll" "$INSTDIR\"

  IfFileExists "$INSTDIR\resources\ort-dylibs\dxcompiler.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\ort-dylibs\dxcompiler.dll" "$INSTDIR\"
!macroend
