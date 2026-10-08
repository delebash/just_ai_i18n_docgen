@echo off
rem just-ai-i18n-docgen: the command line (translate, check, escalate, accept, extract) - the
rem same brain as the app, no window; the app's own exe run as Node (the Electron move).
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0just_ai_i18n_docgen.exe" "%~dp0resources\app.asar\server\src\cli.js" %*
