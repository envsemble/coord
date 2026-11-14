# Remote access

Remote access lets you work on another computer's projects from Coord on this one: a desktop's plans from a laptop, or a server's from either. Coord on that computer runs a small server, the **Coord host**. Coord on your other device pairs with it once, then works on that computer as it does on its own.

Pairing is for **your own devices**. A paired device can do what Coord does on that computer: see its projects (the planning folders in its Coord home) and open their plans, rename projects and create new ones (choosing the folders a project covers, which are paths on that computer, stays with the Coord app there).

It cannot reveal files in that computer's file explorer, and Coord never edits plans, here or there.

Remote access is off by default. It works while Coord (or `coord serve`) runs on that computer.

## Turn it on

On the computer whose projects you want to reach, open **Settings › Computers** (**File › Settings…**, or **Computer settings…** in the computer menu, the computer's name in the title bar). **Devices that can reach** the computer holds remote access:

1. **Allow paired devices to connect to this computer** turns the network listener on or off. The change applies at once. Turning it on, or moving it to another address, asks first when it does not follow your click or key press, for example with a screen reader.
2. **Reach this computer via** picks the address the host listens on:
   - **Tailscale** (recommended): the computer's [Tailscale](https://tailscale.com) address. Tailscale encrypts traffic end to end, and only devices on your tailnet can reach it, from anywhere.
   - **Local network**: an address on your home or office network. Traffic is **not encrypted**, so anyone who can watch that network could read the plans and the device's access token, and use that token as the device. Use it only on a network you trust.
   - **This machine** (127.0.0.1): only programs on this computer can connect. Useful for trying remote access out.

   Coord suggests Tailscale when this computer has it, and otherwise this machine only, so a local network is always a deliberate choice. An address in Tailscale's range that is not Tailscale's (another VPN, or a mobile carrier's network) is listed last as **VPN or other network**, because other people may share that network.

3. **Port** is 7346 unless you change it (1024–65535).
4. **Pair a device** asks for what the pairing link grants, before it creates the link:
   - **Device label** (optional) names the device in **Paired devices**, for example "Work laptop". Without one, the device's own computer name is used.
   - **Use this computer** is what every paired device gets: working on this computer's projects and their plans, with their sessions and references, and creating projects.
   - **Manage access** (off unless you tick it) also lets the device create pairing links and list and revoke paired devices. Tick it for the device you manage a headless `coord serve` from.

   On a local-network address, the step warns again that the connection is not encrypted.

5. **Create pairing link** asks once more in a system dialog, then shows a link with a QR code, such as `http://100.64.1.2:7346/pair#token=<code>`, where the code looks like `7K3M-Q9TX-H2RW-5ZNC`. Above the link, Coord restates what it grants.
   - The link works **once** and expires after **five minutes**.
   - **Copy link** copies the whole link, and **Copy code only** copies the code.
   - **Revoke** cancels the link before anyone uses it, and turning remote access off cancels every open link.
   - The QR code holds the same link, for a phone app later.

   Treat the link like a password until it is used or expires.

6. **Paired devices** lists each device by name, marks the ones with **Manage access**, and shows when each paired, whether it is connected and when it was last seen. **Revoke…** removes a device: its connection closes immediately and its credential stops working.

On Windows, the first time the host listens on a network address, Windows Defender Firewall may ask whether Coord may communicate on networks. Allow it for private networks; Tailscale's network is usually treated as one. If the address goes away (Tailscale disconnects, or the network changes), Coord says so in Settings and tries again every 30 seconds.

## Connect from another device

On the other device, choose **Connect to Another Coord…** in **Settings › Computers**, and paste the pairing link. If you only have the address and the code, type the address (`http://100.64.1.2:7346`) and Coord asks for the code. Then **Show** that computer: the window's hub lists its plans.

## Work on another computer

Each window says where it works: the **computer menu** (the computer's name in the title bar, after the back and forward arrows and the menus) and the plans its hub lists.

- **The computer menu** lists this computer and every computer this one is paired with, to switch between them. Computers that do not answer are marked **Offline**. Choosing a computer works on it in this window: the hub lists its plans. **Computer settings…** opens **Settings › Computers**.
- **Other computers**, in **Settings › Computers**, lists the computers this one is paired with. **↗** opens a computer in a new window. **Forget** forgets a paired computer here; press it again to confirm. Windows showing it close; if this window showed it, it shows this computer instead. To cut its access on that computer too, revoke the device there. **Connect to Another Coord…** pairs with one more.
- **The projects** are the planning folders in that computer's Coord home, on the **Projects** page as this computer's are. **New project** there creates one on that computer, and **Rename…** changes a project's name in its `planning.json` there, for every device; choosing the folders a project covers, which are paths on that computer, stays with Coord there. The order of the projects and whether one is archived are this device's own.

A window on another computer shows the computer's name in its title (`desk — Coord`). The hub, plans, ledgers, statistics, diagrams and search work as they do locally; only **Show in Folder** is not offered.

Windows showing another computer reopen on the next start while the computer is still paired. When that computer is unreachable (asleep, Coord closed, or the network down), its windows keep showing the last view with a notice and reconnect on their own.

- Both sides check the connection every 30 seconds, so a connection that died silently is noticed within two minutes.
- When this device wakes from sleep, it checks its connections at once and replaces any that died.
- A window restored at start while its computer is unreachable shows its projects as soon as the computer answers.
- When the device is revoked, the window says so. Pair again with a new link, and the computer's windows read through the new pairing.

What each device shows stays its own: its windows, the places they show, scrolling, and the order and state of the projects. A project's name and its planning folder belong to the computer.

### Managing access from another device

A device paired with **Manage access** can manage that computer's pairings from its own windows. In a window on that computer, **Devices that can reach** that computer, in **Settings › Computers**, creates pairing links (with the same label and Manage access choice) and lists and revokes devices. It also shows how that computer is reached: its addresses and whether it listens. The settings for how the computer is reached stay with Coord on that computer, or with `coord serve` there.

## Without the desktop app: coord serve

`coord serve` runs the host from the `coord` command, for a computer you use only from other devices (a desktop left on, or a server):

```sh
coord serve
```

- **Address:** it listens on the computer's Tailscale address unless `--address` names another address of the computer, on port 7346 unless `--port` gives another one.
- **Projects:** paired devices see the projects in its Coord home.
- **Pairing:** it prints a pairing link with a QR code in the terminal. In an interactive terminal:
  - **Enter** prints a new link;
  - `manage` prints a link that also grants Manage access;
  - `devices` lists paired devices;
  - `revoke <device-id>` revokes one;
  - `quit` stops it.

  Ctrl+C also stops it. Pair your main device with `manage`, and you can pair the others from it.

- **Home:** `--home` uses another Coord home.
- **Output:** it prints warnings and errors to the terminal and keeps no log file.

One process per Coord home manages remote access.

- **The lock:** the managing process holds a lock that the system releases when the process ends, however it ends (a named pipe on Windows, an abstract socket on Linux). The lock is named after a secret in the home, so every path to the same home finds it, and other users cannot predict its name. A program that takes the name anyway cannot prove it read the secret: Coord then says that a program that is not Coord holds the lock, and remote access stays off.
- **Unreadable settings:** the host's identity, settings and paired devices are in the [home database](command.md#the-coord-home). If it cannot be opened, because it is damaged or another version of Coord made it, neither the app nor `coord serve` starts on it, and both say why.
- **The app and `coord serve` together:**
  - while `coord serve` runs, the app's **Remote Access** dialog shows remote access as managed by it and changes nothing;
  - once `coord serve` stops, the app takes over within 15 seconds, or when the dialog opens;
  - `coord serve` refuses to start while the app manages remote access.

  Devices paired with either one stay paired with the computer.

## How it works

The Coord host (`packages/coord/src/host`) is a Node server written with [Hono](https://hono.dev). It reads planning folders with the same code as the `coord` command, watches them for changes and pushes those changes to connected clients.

The desktop app runs the host in a separate utility process and is its first client. Its main process connects to the host as the **owner**, over a loopback listener on a random port, with a token created at each start and kept only in memory. The app's windows still talk to their main process through the checked message list, and never reach the host directly.

A crashed host restarts, at most three times a minute; after that, Coord says so and leaves it stopped until Coord starts again. The app reconnects, follows its windows' projects again, and they carry on.

A paired device connects to the **network listener** that remote access turns on. Clients use a JSON request and event protocol over one WebSocket (`/api/connect`), and HTTP for files in documents. Requests on the computer's projects are `projects.*` (list, create, update, statistics, and subscribe and unsubscribe to one); requests on one project are `project.*` (its snapshot, work, documents, diagrams and statistics). These, `work.*` (a work item's sessions and timeline) and `references.resolve` name the project by its `projectId`, the `id` the project list gives it. The host pushes `project.changed` to the clients that subscribed to a project when it changes, and `projects.changed` when the list does.

| Route                                  | Purpose                                                                        | Credential       |
| -------------------------------------- | ------------------------------------------------------------------------------ | ---------------- |
| `GET /api/host`                        | The host's protocol version, ID, name and Coord version.                       | None             |
| `GET /pair`                            | A short page saying the link belongs in Coord, for a link opened in a browser. | None             |
| `POST /api/pair`                       | Exchange a pairing code for a device token (remote access address only).       | The pairing code |
| `GET /api/connect`                     | The WebSocket for requests and change events.                                  | Bearer token     |
| `GET /api/projects/:projectId/files/*` | A file in a project's planning folder (images and attachments in documents).   | Bearer token     |

Every request has a declared scope, checked before anything else:

- **`computer`:** every paired device has it. It covers the project list, creating and renaming projects, reading them, and their statistics.
- **`access:manage`:** a device has it when its pairing link granted Manage access. It covers pairing links, the paired devices list, revocation, and the remote access status.
- **`owner`:** changing how the computer is reached and choosing the folders a project covers are for the owner only.

The loopback listener accepts only the owner credential, and only from this computer. The network listener accepts only device credentials.

### Security

- **Pairing codes** are 16 characters of Crockford base32 (80 random bits), shown in groups of four.
  - They live only in the host's memory, work once and expire after five minutes; a restart forgets them.
  - At most 20 links can be open at once.
  - After 20 wrong codes from one address within five minutes, or 200 from all addresses together, the host refuses pairing until the window passes.
- **Device tokens** are 32 random bytes.
  - The host stores only their SHA-256 hash, with what the device may do, in its [home database](command.md#the-coord-home), and compares hashes in constant time.
  - The connecting device stores its token in its home database, encrypted with the system's credential store through Electron's `safeStorage` (DPAPI on Windows; the GNOME keyring or KWallet on Linux). On Linux without a keyring, the token is stored unencrypted.
  - On macOS and Linux, Coord creates the home readable by you only (0700) and the database and its `-wal` and `-shm` files as 0600. On Windows, the home is in your user profile, whose permissions keep other users out.
- **What a device can reach** is what Coord reaches on that computer, as the user who runs it:
  - the files inside the planning folders of its projects, all in its Coord home;
  - new projects it creates there, and project names it changes;
  - new work items it imports into a planning folder;
  - what a plan's references lead to, for those that name their repository in full (`owner/repo#N`, `owner/repo@hash` or a GitHub URL): the page of a PR or commit, and a PR's title, state and checks or a commit's subject, which the host asks `gh` for with that computer's GitHub sign-in, and only for the repositories checked out in the project's folders (which only you set on that computer), so a device learns nothing of the other repositories that sign-in can see. A device never gets a file path;
  - a plan's sessions as that computer's hooks recorded them: model, reasoning effort, state, times, agent time, the commits and PRs they made, and, while one waits, the last message of its turn (your own devices see what the agent wrote to you there). The folder a session runs in and how to resume it stay on that computer.

  - through a work item's [pages](pages.md), which run in the device's window: the files of the planning folder, which a page may also write, and the Coord tools agents use (work items, steps and the rest), run there.

  It cannot read other files, run programs (beyond the Git and `gh` lookups above, which only the host chooses, and the page builds) or change how the computer is reached. A lost or stolen device keeps that reach until you revoke it, so revoke it from the computer, from `coord serve` (`revoke`), or from another device with Manage access.

- **Identity:** before sending its token, over the WebSocket or for a file, a client checks that the address answers with the host ID it paired with, so a different Coord that now has the address does not receive the credential. The host ID is public, so this is no defence against someone deliberately impersonating the host on your network: use Tailscale, which authenticates the computers themselves.
- **Browsers are refused:** any request that carries an `Origin` header is rejected, so no web page can call the host, and the `Host` header must be an IP address or `localhost`, which blocks DNS rebinding. Responses carry a restrictive content security policy.
- **Files:** requests resolve inside the planning folder with the same containment as the app: no paths outside it, and no hidden or excluded folders. Files over 64 MB are not served.
- **Limits:** messages are limited in size.
- **Transport:** the host speaks plain HTTP and relies on the network for encryption. Use Tailscale (WireGuard) across networks; on a local network, traffic can be read by anyone able to watch it.

### Privacy

Remote access sends planning-folder contents only to devices you paired, and only while it is turned on. A paired device can see what the app shows on that computer:

- real paths, which often include the user's name;
- any project's files, Git activity (commit titles and dates, without authors) and work statistics;
- its plans' sessions with their last messages while they wait, and the state of the PRs its plans reference.

A device can also create and rename projects there.

While remote access is on, anyone who can reach the chosen address and port can ask the host who it is (`GET /api/host`). The answer is this computer's name, a host ID and the Coord version, but no projects or content. Over Tailscale, only your tailnet can ask; on a local network, anyone on it can.

What each computer keeps:

- **The computer with the projects:**
  - its home database lists each paired device's name (its label, or the device's own computer name), platform, what it may do, pairing time and last-seen time, until the device is revoked;
  - when the app runs the host, `host.log` records the device's IP address and name when it pairs, its device ID when it connects, and revocations.
- **The connecting device:**
  - its home database holds the paired computer's name, address, the device's credential and whether it may manage access, until you forget the computer there, with the computer's projects as this device orders and archives them, and what each window showed there.

  Forgetting a computer removes all of it. `coord.log` records the computer's name and address when pairing.

- **Logs** rotate by size: 1 MB per file, with three older files kept. Revoking or forgetting a computer does not remove lines already in the log.

**Copy link** and **Copy code only** put the pairing code on the clipboard, where clipboard history or sync may keep it; the code still works only once and only for five minutes.

Nothing goes through an Envsemble or third-party service: devices connect to the host directly, through Tailscale when you choose its address. Coord has no telemetry, and remote access adds none.
