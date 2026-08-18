# Deploy the web app to the Hetzner box.
#
#   ./deploy-hetzner.ps1
#
# Builds the production bundle and copies it to the server, where Caddy serves
# it as static files. No restart is needed - Caddy reads the files live from a
# mounted volume, so the new build is served the moment the copy finishes.
#
# The app is same-origin with the API (VITE_API_URL is left empty), so nothing
# here configures an API URL.

$ErrorActionPreference = "Stop"
$Server = "root@178.105.84.137"
$WebDir = "/root/center-backend/web"

Write-Host "building..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "build failed"; exit 1 }

# Clear old hashed bundles first so they do not pile up over many deploys, then
# copy the fresh build. index.html always points at the current hashes, so the
# brief gap is invisible in practice.
Write-Host "uploading to $Server ..." -ForegroundColor Cyan
ssh -o BatchMode=yes $Server "rm -rf $WebDir/*"
scp -r -o BatchMode=yes dist/* "${Server}:$WebDir/"
if ($LASTEXITCODE -ne 0) { Write-Error "upload failed"; exit 1 }

Write-Host "done - live now at https://178.105.84.137.sslip.io" -ForegroundColor Green
