# Remote access

Remote access lets one computer read the planning folders another computer shares, for example a laptop following the plans on a desktop. Atlas on the sharing computer runs a small server, the **Atlas host**; Atlas on the other computer pairs with it once and then opens its shared folders **read-only**: paired devices cannot change anything in them. Nothing is shared until the sharing computer's owner turns remote access on, shares a folder and pairs a device.

Remote access is off by default. It works while Atlas (or `atlas serve`) runs on the sharing computer.

## Share this computer's folders

Choose **File › Remote Access…**:

1. **Allow paired devices to connect to this computer** turns the network listener on or off. The change applies at once.
2. **Reach this computer via** picks the address the host listens on:
   - **Tailscale** (recommended): the computer's [Tailscale](https://tailscale.com) address. Tailscale encrypts traffic end to end, and only devices on your tailnet can reach it, from anywhere.
   - **Local network**: an address on your home or office network. Traffic is **not encrypted**, so anyone who can watch that network could read the shared plans and the device's access token. Use it only on a network you trust.
   - **This machine** (127.0.0.1): only programs on this computer can connect. Useful for trying remote access out.

   Atlas suggests Tailscale when this computer has it, and otherwise this machine only, so a local network is always a deliberate choice. An address in Tailscale's range that is not Tailscale's (another VPN, or a mobile carrier's network) is listed last as **VPN or other network**: other people may share that network.

3. **Port** is 7346 unless you change it (1024–65535).
4. **Shared planning folders** lists what paired devices may read. **Share this folder** adds the window's folder; **Add folder…** picks another one. Paired devices see nothing until a folder is shared. Stopping sharing ends access to that folder at once, including plan exports a device prepared from it.
5. **Create pairing link** shows a link with a QR code, such as `http://100.64.1.2:7346/pair#token=<code>`, where the code looks like `7K3M-Q9TX-H2RW-5ZNC`. The link works **once** and expires after **five minutes**. **Copy link** copies the whole link and **Copy code only** copies the code. **Revoke** cancels the link before anyone uses it, and turning remote access off cancels every open link. The QR code holds the same link, for a phone app later. Treat the link like a password until it is used or expires.
6. **Paired devices** lists each device by name with when it paired, whether it is connected and when it was last seen. **Revoke…** removes a device: its connection closes immediately and its credential stops working.

On Windows, the first time the host listens on a network address, Windows Defender Firewall may ask whether Atlas may communicate on networks. Allow it for private networks; Tailscale's network is usually treated as one. If the address goes away (Tailscale disconnects, or the network changes), Atlas says so in the dialog and tries again every 30 seconds.

## Connect from another computer

On the other computer, choose **File › Connect to Another Atlas…** (or **Connect to Another Atlas…** on the welcome page) and paste the pairing link. If you only have the address and the code, type the address (`http://100.64.1.2:7346`) and Atlas asks for the code. Atlas then lists the folders the sharing computer shares; choose one to open it.

A folder from another computer opens in its own window, titled with both names (`planning — desk — Atlas`), and the explorer marks it **read-only**. Everything that reads works as it does locally: the work list, plans, ledgers, statistics, diagrams, quick open and **Export Plan…**. What would write or point at the other computer's disk is not offered: **Import Plan…**, **Reveal in File Explorer** and **Show in folder**. Views of a remote folder are not counted in usage statistics on either computer.

The welcome page lists the computers this one is paired with under **Other computers**, with the folders each one shares. **Forget** (×) removes a computer and closes its windows here; to cut its access on the sharing computer too, revoke the device there. Windows showing remote folders reopen on the next start while the computer is still paired.

When the sharing computer is unreachable (asleep, Atlas closed, or the network down), its windows keep showing the last view with a notice and reconnect on their own. Both sides check the connection every 30 seconds, so a connection that died silently is noticed within a minute, and when this computer wakes from sleep it checks its connections at once and replaces any that died. A window restored at start while its computer is unreachable opens the folder as soon as the computer answers. When the device is revoked, the window says so; pair again with a new link, and the computer's windows read through the new pairing.

The connection to another computer stays open while a window shows one of its folders. The welcome page lists shared folders over a short-lived connection, so the sharing computer shows this one as connected only while it reads.

## Without the desktop app: atlas serve

`atlas serve` runs the host from the `atlas` command, for a computer that only shares (a desktop left on, or a server):

```sh
atlas serve --folder /path/to/planning
```

It listens on the computer's Tailscale address unless `--address` names another address of the computer, on port 7346 unless `--port` gives another one. It shares the folders given with `--folder` (repeatable) for as long as it runs, together with any shared in the app. It prints a pairing link with a QR code in the terminal; in an interactive terminal, **Enter** prints a new link, `devices` lists paired devices, `revoke <device-id>` revokes one and `quit` stops. Ctrl+C also stops it. `--data-dir` uses another Atlas data folder. It prints warnings and errors to the terminal and keeps no log file.

One process per Atlas data folder manages remote access. It holds a lock that the system releases when the process ends, however it ends (a named pipe on Windows, an abstract socket on Linux). The lock is named after a secret in the data folder, so every path to the same folder finds it and other users cannot predict its name. A program that takes the name anyway cannot prove it read the secret: Atlas then says that a program that is not Atlas holds the lock, and remote access stays off. If the remote access settings (`host/access.json`) cannot be read, because they are damaged or a newer Atlas wrote them, Atlas leaves the file as it is, keeps remote access off and says why in **Remote Access**. To start over, remove the file and start Atlas again; paired devices then pair again. While `atlas serve` runs, the app's **Remote Access** dialog shows remote access as managed by it and changes nothing; once `atlas serve` stops, the app takes over within 15 seconds, or when the dialog opens. `atlas serve` refuses to start while the app manages remote access. Devices paired with either one stay paired with the computer.

## How it works

The Atlas host (`packages/host`) is a Node server written with [Hono](https://hono.dev). It reads planning folders with the same code as the `atlas` command, watches them for changes and pushes those changes to connected clients. The desktop app runs the host in a separate utility process and is its first client: its main process connects to it as the **owner** over a loopback listener on a random port, with a token that is created at each start and kept only in memory. The app's windows still talk to their main process through the checked message list; they never reach the host directly. A crashed host restarts (at most three times a minute; after that Atlas says so and leaves it stopped until Atlas starts again); the app reconnects, opens its windows' folders again and they carry on.

A paired device connects to the **network listener** that remote access turns on. Clients use a JSON request and event protocol over one WebSocket (`/api/connect`), and HTTP for files in documents and for plan exports.

| Route                                | Purpose                                                                        | Credential       |
| ------------------------------------ | ------------------------------------------------------------------------------ | ---------------- |
| `GET /api/host`                      | The host's protocol version, ID, name and Atlas version.                       | None             |
| `GET /pair`                          | A short page saying the link belongs in Atlas, for a link opened in a browser. | None             |
| `POST /api/pair`                     | Exchange a pairing code for a device token (remote access address only).       | The pairing code |
| `GET /api/connect`                   | The WebSocket for requests and change events.                                  | Bearer token     |
| `GET /api/folders/:folderId/files/*` | A file in a shared folder (images and attachments in documents).               | Bearer token     |
| `GET /api/exports/:token`            | A prepared plan export, once.                                                  | Bearer token     |

Every request has a declared scope. A paired device holds `planning:read`: it may list the shared folders and read their snapshots, documents, models, diagrams and references, and export their plans. Opening other folders, importing plans, recording views and changing remote access are owner-only. The loopback listener accepts only the owner credential, and only from this computer; the network listener accepts only device credentials.

### Security

- **Pairing codes** are 16 characters of Crockford base32 (80 random bits), shown in groups of four. They live only in the host's memory, work once and expire after five minutes; a restart forgets them. At most 20 links can be open at once. After 20 wrong codes from one address within five minutes, or 200 from all addresses together, the host refuses pairing until the window passes.
- **Device tokens** are 32 random bytes. The host stores only their SHA-256 hash in `<Atlas data folder>/host/access.json` and compares hashes in constant time. The connecting computer stores its token in `connections.json` in its data folder, encrypted with the system's credential store through Electron's `safeStorage` (DPAPI on Windows; the GNOME keyring or KWallet on Linux). On Linux without a keyring, the token is stored unencrypted. Both files are written with owner-only permissions on Linux; on Windows, the data folder is in your user profile.
- **Identity:** before sending its token, over the WebSocket or for a file, a client checks that the address answers with the host ID it paired with, so a different Atlas that now has the address does not receive the credential. The host ID is public, so this is no defence against someone deliberately impersonating the host on your network: use Tailscale, which authenticates the computers themselves.
- **Browsers are refused:** any request that carries an `Origin` header is rejected, so no web page can call the host, and the `Host` header must be an IP address or `localhost`, which blocks DNS rebinding. Responses carry a restrictive content security policy.
- **Paths:** a device names folders by an ID derived from the path with a secret only the host knows, so an ID does not confirm a guessed path. A device sees the folder's name in place of its path on the sharing computer, also in error messages and notices. File requests resolve inside the folder with the same containment as the app (no paths outside it, no hidden or excluded folders), and files over 64 MB are not served.
- **Limits:** messages are limited in size, each device prepares one plan export at a time and holds at most two, and prepared exports expire after ten minutes.
- **Transport:** the host speaks plain HTTP and relies on the network for encryption. Use Tailscale (WireGuard) across networks; on a local network, traffic can be read by anyone able to watch it.

### Privacy

Remote access sends planning-folder contents only to devices the owner paired, only for folders the owner shared, and only while it is turned on. A device sees what the app shows for the folder: its files, Git activity (commit titles and dates, without authors) and work statistics, and its document-use counts and last-use dates from the sharing computer's usage statistics. A device can also save a plan export, a copy its user then keeps. Opening a shared folder for a device reads it as the app does, which creates the folder's usage-statistics store in the sharing computer's data folder if it has none; a device's views are not recorded.

While remote access is on, anyone who can reach the chosen address and port can ask the host who it is (`GET /api/host`). The answer is this computer's name, a host ID and the Atlas version, but no folders or content. Over Tailscale, only your tailnet can ask; on a local network, anyone on it can.

What each computer keeps:

- **The sharing computer:** `access.json` lists each paired device's name (the other computer's name), platform, pairing time and last-seen time, until the device is revoked. When the app runs the host, `host.log` records the other computer's IP address and name when it pairs, its device ID when it connects, and revocations.
- **The connecting computer:** `connections.json` holds the paired computer's name, address and the device's credential, until you forget it there. Forgetting also removes the window layout saved for that computer's folders. `atlas.log` records the computer's name and address when pairing.
- Logs rotate by size: 1 MB per file, with three older files kept. Revoking or forgetting a computer does not remove lines already in the log.

**Copy link** and **Copy code only** put the pairing code on the clipboard, where clipboard history or sync may keep it; the code still works only once and only for five minutes.

Nothing goes through an Envsemble or third-party service: devices connect to the host directly, through Tailscale when you choose its address. Atlas has no telemetry, and remote access adds none.
