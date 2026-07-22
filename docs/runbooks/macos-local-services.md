# macOS Local Service Supervision

This runbook keeps the local TypeScript voice service and the named Cloudflare tunnel running under the current macOS user account.

## Services

- `npm run deploy:macos-local` builds and copies the compiled runtime to `~/Library/Application Support/LanternBell/`. Keeping the supervised runtime outside `Documents` avoids macOS privacy restrictions on background agents.
- `com.lanternbell.voice-ai` runs the deployed `scripts/start-twilio-local.mjs`. The deployment copies ignored `.env.local` with owner-only permissions, so secrets are not embedded in the LaunchAgent definition.
- `com.lanternbell.cloudflared` runs the deployed, project-pinned `cloudflared` binary with `~/.cloudflared/config.yml` and tunnel `lanternbell-voice`.
- Logs are written under `~/Library/Logs/LanternBell/`.

The LaunchAgents start after the user logs in and restart failed processes. They do not make a logged-out Mac into an unattended production server.

## Inspect

```sh
launchctl print gui/$(id -u)/com.lanternbell.voice-ai
launchctl print gui/$(id -u)/com.lanternbell.cloudflared
curl -fsS https://voice.lanternbell.com/health
```

## Restart

```sh
launchctl kickstart -k gui/$(id -u)/com.lanternbell.voice-ai
launchctl kickstart -k gui/$(id -u)/com.lanternbell.cloudflared
```

## Stop and unload

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.lanternbell.voice-ai.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.lanternbell.cloudflared.plist
```

## Load

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.lanternbell.voice-ai.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.lanternbell.cloudflared.plist
```

After updating application code or dependencies, deploy and restart the supervised runtime:

```sh
npm install
npm run deploy:macos-local
launchctl kickstart -k gui/$(id -u)/com.lanternbell.voice-ai
launchctl kickstart -k gui/$(id -u)/com.lanternbell.cloudflared
```

Then repeat signed readiness plus scenario-matrix checks through `https://voice.lanternbell.com`.
