@echo off
rem just-ai-i18n-docgen-server: the headless server, the app's own exe run as Node (the
rem Electron move, ruling 4) - the same server and UI the desktop app runs, no window.
rem The exe is just_ai_i18n_docgen.exe: a launcher never shares its name (Windows would
rem resolve the bare name to the GUI exe first - JustVoice's CreateProcessW trap).
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0just_ai_i18n_docgen.exe" "%~dp0resources\app.asar\server\src\serve.js" %*
