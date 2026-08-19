# MOTIONS

A mobile-first visual routine app. Today is a tactile card deck; each Motion opens into an immersive checklist or one-task-at-a-time Focus Mode. Progress is stored on the device, and the app can be installed from a supported browser.

## Run locally

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev
```

## Publish with GitHub Pages

1. Create a new GitHub repository and upload/push this project to its `main` branch.
2. On GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. The included “Deploy MOTIONS to GitHub Pages” workflow will build and publish the app automatically.
5. Once the workflow is green, the public URL appears in the deployment summary and in **Settings → Pages**.

Every later push to `main` republishes the site. The GitHub Pages build is static and works correctly at a repository subpath.

## PWA notes

Use the browser’s **Add to Home Screen** / **Install app** action after publishing. The service worker caches visited app resources and Motion artwork for repeat visits. Checklist and Rhythm progress is device-local in this first version.
