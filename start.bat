@echo off
cd /d "%~dp0"
start "" http://127.0.0.1:5004
python -m http.server 5004
