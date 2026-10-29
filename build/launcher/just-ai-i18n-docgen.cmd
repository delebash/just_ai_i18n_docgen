@echo off
rem just-ai-i18n-docgen: the command line (translate, check, escalate, accept, extract) - the
rem same brain as the app, no window; the app's own exe run as Node (the Electron move).
setlocal
set ELECTRON_RUN_AS_NODE=1
rem The OS's certificates trusted too (Node's NODE_USE_SYSTEM_CA), as the server's launcher: a
rem network that inspects TLS signs with a certificate only the OS knows. A value already set is kept.
if not defined NODE_USE_SYSTEM_CA set NODE_USE_SYSTEM_CA=1
rem The server is its own package inside the app (the Quasar move, 2026-10-09).
"%~dp0just_ai_i18n_docgen.exe" "%~dp0resources\app.asar\node_modules\just-ai-i18n-docgen-server\src\cli.js" %*
