# Manual Deployment Script for Windows
$repo = "https://github.com/easymoneyfomy-pixel/Arma-Reforger-navigation-system-for-artillery.git"

Write-Host "Building project..." -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed!"
    exit 1
}

Write-Host "Preparing dist folder for deployment..." -ForegroundColor Cyan
cd dist

# Create a fresh git repo in the dist folder
git init
# Configure identity for this sub-repo
git config user.email "easymoneyfomy-pixel@users.noreply.github.com"
git config user.name "easymoneyfomy-pixel"

git add .
git commit -m "Deploy to GitHub Pages"

Write-Host "Pushing to gh-pages branch..." -ForegroundColor Cyan
# Push the current branch (regardless of name) to the remote gh-pages branch
git push --force $repo HEAD:gh-pages

Write-Host "Deployment complete!" -ForegroundColor Green
cd ..
