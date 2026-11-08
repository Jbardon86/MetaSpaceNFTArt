# Building the installable app (Phase 3)

Turn the project into a real app your staff install on the iPads — no Expo Go,
no browser. Built in the cloud with **Expo EAS Build**.

## Prerequisites
- **Free Expo account** — sign up at https://expo.dev
- **Apple Developer account ($99/year)** — required for any iOS install:
  https://developer.apple.com/programs/  (Android needs no account.)

## One-time setup
Run these in Terminal from `tradeshow-app` (the GitHub Desktop copy):

```bash
# 1. Log in to Expo (create a free account first at expo.dev)
npx eas-cli login

# 2. Link this project to your Expo account (creates the project on EAS)
npx eas-cli init
```

## Build for the iPads (internal distribution)
```bash
npx eas-cli build --platform ios --profile preview
```
- When prompted, log in with your **Apple Developer** account. EAS creates the
  signing certificates and provisioning profile for you automatically.
- The build runs in the cloud (~15–25 min). When done, EAS prints a **link + QR
  code**.
- On each iPad: open that link in Safari and tap **Install**. (Internal-distribution
  builds install directly; no App Store review.)

> Note: internal iOS builds install only on devices registered to your Apple
> Developer account. EAS walks you through registering them the first time.
> For a smoother path with more testers, use **TestFlight** (see below).

## Alternative: TestFlight (recommended for wider staff use)
```bash
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --latest
```
Staff install Apple's **TestFlight** app, then get the kiosk app through it.
No per-device registration; up to 100 internal testers.

## Android (optional, free)
```bash
npx eas-cli build --platform android --profile preview
```
Produces an **APK** you can install on any Android tablet directly — no account,
no fee.

## Locking the iPad as a kiosk
Once installed, use iOS **Guided Access** (Settings → Accessibility → Guided
Access) or **Single App Mode** to lock each iPad to just this app, so customers
can't leave it. This is an iPad setting, not part of the app.

## Updating the app later
Two ways:
- **Over-the-air (instant):** `npx eas-cli update --channel preview` pushes JS/UI
  changes to already-installed apps without a rebuild. Great for tweaks.
- **Full rebuild:** re-run the `build` command when you change native config
  (icon, permissions, SDK).

## App identity (already configured)
- Name: **Endless Fun Orders** (`app.json` → `name`)
- Bundle ID: `biz.endlessfun.orders` (`app.json` → `ios.bundleIdentifier`)
- Icon: `assets/icon.png` — swap this for the Endless Fun logo before building.
