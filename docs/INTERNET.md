# Internet sharing by device ID — v0.2.0

Each AgentBridge installation has a stable ID such as `AB-123456-ABCDEF-123456-ABCDEF`. Your other computer can request a connection using this ID, even on another network or behind NAT. You approve the request before sessions can be exchanged.

**Internet mode requires a running HTTPS relay.** This repository includes a deployable relay server and Docker Compose configuration. Publishing the repository to GitHub does not start the relay. There is no bundled public relay service or assumed production endpoint.

## Desktop workflow

1. Open **Internet sharing** on both computers.
2. Configure the same **HTTPS relay URL** and **relay access code**, enable Internet sharing, and save. The access code is set by whoever operates your relay.
3. Copy the ID shown on computer B.
4. On A, paste B's ID into **Connect using an ID** and choose **Request connection**.
5. On B, choose **Check requests & sync** or wait for its periodic mailbox check. Compare A's ID with the ID displayed on A, then choose **Approve connection**.
6. On A, check requests to receive B's approval. Both computers now show an Internet connection.
7. Open a real session and turn on **Share with paired devices**. It is shared over whichever LAN/Internet channels are enabled, with every approved peer on those channels.
8. Choose **Check requests & sync** on the Internet screen. Your paired computer receives a searchable **Internet copy** and can create a context handoff.

The device ID is an identifier, not a password. The relay access code alone also does not authorize a device to read another device's mailbox. Authenticated device requests and approval are both required. Rejecting a request blocks the ID; the **Blocked IDs** section lets you unblock it before a new connection request. Native state restoration limitations remain as described in the main README.

## Host the relay on a public server

Use a VPS/server with Docker Compose and a domain name pointing to its public IP. Allow incoming TCP ports 80 and 443 on that server. Your desktop computers only need outbound HTTPS; no incoming desktop port or public desktop IP is required.

```sh
git clone https://github.com/workspaccode/agentbridge.git
cd agentbridge/relay
cp .env.example .env
```

Edit `.env`:

```dotenv
RELAY_DOMAIN=relay.your-domain.com
RELAY_ACCESS_TOKEN=<your-strong-random-access-code>
```

Generate an access code with Node.js:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Start the service:

```sh
docker compose up -d --build
docker compose logs --tail=50
```

Caddy serves HTTPS and forwards to the private relay container. Its certificate storage and the relay mailbox use persistent Docker volumes. Configure the app with `https://relay.your-domain.com` and the generated code. Never commit `.env`, private device stores, or the actual access code.

The `/health` endpoint reports the protocol and health without listing devices or sessions. The relay API requires the access code and signed device requests.

## Local development without Docker

Set a 32–200 character `AGENTBRIDGE_RELAY_TOKEN` environment variable, then run:

```sh
npm run relay
```

The relay listens on port 8787. For development on one computer, configure the app with `http://127.0.0.1:8787`. Internet mode rejects non-local HTTP endpoints. The Node server is an HTTP origin server intended to run behind TLS; do not expose its port directly for production traffic.

Configuration:

| Variable | Purpose | Default |
| --- | --- | --- |
| `AGENTBRIDGE_RELAY_TOKEN` | Shared access code for registration and relay API access | Required |
| `AGENTBRIDGE_RELAY_DATA` | Directory containing persistent relay state | `relay/.data` |
| `PORT` | HTTP listener port behind your proxy | `8787` |
| `HOST` | Listener interface | `0.0.0.0` |

## Encryption and approval

- A device creates Ed25519 signing keys and X25519 agreement keys on first run. The displayed 96-bit fingerprint binds both public keys. Device registration includes a signed proof, checked against the ID.
- Relay operations are signed with the device's Ed25519 private key and bind the route, body, timestamp and nonce. The relay rejects expired requests and persisted request replays. A common relay access code gates the service but never substitutes for device authentication.
- Devices verify the other device's public keys against its ID. X25519 agreement plus HKDF produces encryption keys. An explicit accepted request creates a new random channel salt; snapshots on unknown, unapproved or old channels are rejected.
- Session payloads and private device details are sealed with AES-256-GCM **before** leaving the desktop. Direction, sender ID, recipient ID and channel are authenticated. The relay has public keys and encrypted packets, not the device private keys required to read them.
- Snapshot ownership uses the sender's cryptographic ID rather than an arbitrary device UUID. Persisted sequence numbers reject stale snapshot replays.

The relay sees public IDs, public keys, sender/recipient relationships, channel markers, timestamps and message sizes. It can delay or discard deliveries. Static X25519 keys do not provide forward secrecy if device private keys are later compromised. This custom protocol has not had an independent security audit. Local private keys, relay access codes and transcripts remain in the OS-protected local file; application-level encryption at rest and OS credential-vault integration remain planned.

## Offline behavior and limits

The relay retains undelivered encrypted messages for up to seven days. A queued update is not proof the other computer received it. The UI distinguishes **Update queued** from **Update received**. New snapshots replace older queued snapshots for the same approved device channel. Data is acknowledged only after local processing; processed-message IDs and received sequence numbers survive client restarts.

Defaults: 500 registered devices, 200 queued messages per recipient, 2,000 total queued messages, 128 MB queued encrypted message data, 24 MB per request, and 300 authenticated API requests per source IP per minute. Very large deployments need indexed storage and a more scalable relay. Current storage is atomic JSON. Persistent volumes and backups are required if you want mailbox continuity across server replacements.

LAN synchronization still uses direct LAN invitations and its original origin UUID. Internet copies use cryptographic origins; a session received by both transports may appear twice. Origin unification/deduplication is a later enhancement.

## Revocation

**Revoke Internet access** immediately removes the local trust relationship and blocks incoming data from that ID. When the relay is reachable, it purges that sender's queued messages to the peer and sends an encrypted revocation notification. An unreachable relay cannot erase already queued or downloaded data; the UI reports whether notification succeeded. Previously downloaded sessions cannot be recalled. Reconnecting requires unblocking as needed and completing a fresh approval, which creates a new channel.

## Validation

Automated tests exercise independent clients through a real local relay listener, including approval, unauthorized access, signed-request replay across relay restart, forged identities, selected-only sharing, encrypted mailbox persistence, delayed/offline delivery, client identity persistence, rejection/blocking and revocation. This verifies the protocol and application flow, not a deployment to an Internet-hosted server or OS firewall behavior.
