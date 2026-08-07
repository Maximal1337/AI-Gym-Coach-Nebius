# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

This app is pinned to Expo SDK 54, not the latest SDK. Expo Go's App Store
build lags new SDK releases by months for Apple review, and 55/56/57 have
no approved Expo Go build — only SDK 54 currently works for on-device
testing via Expo Go. Do not bump the SDK without first confirming Expo Go
has an approved build for the target version.

# EAS build/submit: always pass --non-interactive

Credentials for this project are already stored server-side in EAS's
credentials service, including an App Store Connect API key — every
`eas build`/`eas submit` call must include `--non-interactive` so EAS
uses that stored key. Without the flag, EAS instead prompts to log in
with a real Apple ID + password, which on this machine fails with:

```
Authentication with Apple Developer Portal failed!
Security returned a non-successful error code: 36
```

That's a local macOS Keychain write failure inside the interactive
Apple-ID login path (fastlane/spaceship trying to save the password to
Keychain) — not a real credentials problem, and not something to debug.
The fix is simply never triggering that path: add `--non-interactive` and
EAS uses the already-configured API key instead, no Apple ID/password or
Keychain involved at all.

Known-good commands (see git log for exact invocations that already
worked):

```
eas build --platform ios --profile production --non-interactive --no-wait
eas submit --platform ios --id <buildId> --non-interactive
```

An agent cannot complete Apple's interactive login/2FA flow anyway — if
`--non-interactive` ever isn't enough (e.g. the stored credentials
themselves expire), that's a case to hand back to the user rather than
attempt interactively.
