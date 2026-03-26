#!/bin/bash
# Launch Chrome with remote debugging enabled for Playwright CDP connection.
# Run this ONCE instead of opening Chrome normally.
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  "$@"
