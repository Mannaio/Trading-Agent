#!/bin/bash
# Launch Chrome with remote debugging enabled for Playwright CDP connection.
# Run this ONCE instead of opening Chrome normally.
# Uses a dedicated profile directory so CDP can bind to the debug port.
# Your bookmarks, extensions, and login sessions carry over from the default profile
# on first launch (Chrome copies them). Subsequent launches reuse this profile.
USER_DATA_DIR="$HOME/Library/Application Support/Google/Chrome-Debug"

/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$USER_DATA_DIR" \
  "$@"
