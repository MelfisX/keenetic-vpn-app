#!/bin/bash
# mac start wrapper for Keenetic VPN app
# EDIT: set APP_DIR to the full absolute path where you copied the project on the Mac
APP_DIR="/Users/youruser/path/to/keenetic-vpn-app"
# EDIT: set NPM_BIN if npm is not in /usr/local/bin
NPM_BIN="/usr/local/bin/npm"

cd "$APP_DIR" || exit 1
# make sure common binary locations are in PATH
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
# if you use nvm, uncomment the next line and adjust
# [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"

# run the app (adjust npm script if you want `run web` or `start`)
exec "$NPM_BIN" start
