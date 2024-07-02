#!/bin/bash
set -e

echo "Deployment started ..."

# Pull the latest version of the app
git pull origin main
echo "New changes copied to server !"

echo "Installing Dependencies..."
npm install --yes

echo "PM2 Reload"
pm2 reload mq-server

echo "Deployment Finished!!"