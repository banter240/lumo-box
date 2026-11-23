import { CDP, PORTS } from './const.js';

/** Print a message to the user's terminal (bypasses console shim). */
export function print(text: string, newline = true): void {
  process.stdout.write(text + (newline ? '\n' : ''));
}

export const BUSY_INDICATOR = '...';

export function clearBusyIndicator(): void {
  // Backspace over "..."
  process.stdout.write('\b\b\b   \b\b\b');
}

export function printHelp(): void {
  print(`
lumo-box - Use Proton Lumo on the command line

Usage:
  lumo_box                      Interactive chat mode
  lumo_box "your prompt"        One-shot query
  lumo_box auth [method]        Authenticate to Proton
  lumo_box auth status          Show authentication status
  lumo_box update [apply]       Check GitHub / apply a Docker image update
  lumo_box server               Start API server
  lumo_box --help               Show this help

Commands:
  auth                       Authenticate to Proton (login, browser, or rclone)
  update                     Check GitHub for a new release; apply via docker.sock
  server                     Start OpenAI-compatible API server

Options:
  -h, --help         Show help
  --home <dir>       User data dir (config, vault, sessions). Or set BOX_HOME.

`);
}

export function printAuthHelp(): void {
  print(`
lumo_box auth - Authenticate to Proton

Usage:
  lumo_box auth                 Open /auth in your browser (Proton sign-in)
  lumo_box auth login           Password (scripts)
  lumo_box auth browser         Sidecar / CDP extract
  lumo_box auth rclone          Paste rclone config
  lumo_box auth status          Show current authentication status
  lumo_box auth --help          Show this help

`);
}

export function printServerHelp(): void {
  print(`
lumo_box server - Start OpenAI-compatible API server

Usage:
  lumo_box server               Start the API server
  lumo_box server --help        Show this help

The server listens on the port configured in config.yaml (default: ${PORTS.BOX}).
`);
}

export function printUpdateHelp(): void {
  print(`
lumo_box update - Check GitHub and apply a Docker image update

Usage:
  lumo_box update               Check the configured channel (dev or stable)
  lumo_box update apply         Pull GHCR and recreate this container (needs docker.sock)
  lumo_box update --help        Show this help

Channel and repository live in config.yaml (updates.*). Apply needs
/var/run/docker.sock mounted on this container (see docs/updates.md).
`);
}

