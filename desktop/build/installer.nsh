; Extra steps for the Windows installer, pulled in by electron-builder.yml (nsis.include).
;
; An update is this installer run again, silently, by electron-updater. It replaces Skycord.exe,
; and with it the icon, but Windows keeps showing the old one on pinned taskbar buttons, the Start
; menu and desktop shortcuts until it rebuilds its icon cache, which can take days. Telling the
; shell that associations changed (SHCNE_ASSOCCHANGED, 0x08000000) makes it refresh them at once,
; so a new icon appears the moment the update lands.
!macro customInstall
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; SHChangeNotify alone did not reach the taskbar's pinned button after the 0.20.99 update.
  ; ie4uinit -show (Windows 10 and 11) rebuilds the per-user icon cache; it is harmless if absent.
  nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
!macroend
