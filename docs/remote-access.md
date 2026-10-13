# Remote access

Remote access lets you work on another computer's planning folders from Atlas on this one: a desktop's plans from a laptop, or a server's from either. Atlas on that computer runs a small server, the **Atlas host**. Atlas on your other device pairs with it once, then works on that computer as it does on its own.

Pairing is for **your own devices**. A paired device can do what Atlas does on that computer:

- browse its folders;
- open any planning folder there;
- import and export plans;
- have its views counted in that computer's document use.

It cannot reveal files in that computer's file explorer, and Atlas never edits plans, here or there.

Remote access is off by default. It works while Atlas (or `atlas serve`) runs on that computer.

## Turn it on

Choose **File › Remote Access…** on the computer whose folders you want to reach:

1. **Allow paired devices to connect to this computer** turns the network listener on or off. The change applies at once. Turning it on, or moving it to another address, asks first when it does not follow your click or key press, for example with a screen reader.
2. **Reach this computer via** picks the address the host listens on:
   - **Tailscale** (recommended): the computer's [Tailscale](https://tailscale.com) address. Tailscale encrypts traffic end to end, and only devices on your tailnet can reach it, from anywhere.
   - **Local network**: an address on your home or office network. Traffic is **not encrypted**, so anyone who can watch that network could read the plans and the device's access token, and use that token as the device. Use it only on a network you trust.
   - **This machine** (127.0.0.1): only programs on this computer can connect. Useful for trying remote access out.

   Atlas suggests Tailscale when this computer has it, and otherwise this machine only, so a local network is always a deliberate choice. An address in Tailscale's range that is not Tailscale's (another VPN, or a mobile carrier's network) is listed last as **VPN or other network**, because other people may share that network.

3. **Port** is 7346 unless you change it (1024–65535).
4. **Pair a device** asks for what the pairing link grants, before it creates the link:
   - **Device label** (optional) names the device in **Paired devices**, for example "Work laptop". Without one, the device's own computer name is used.
   - **Use this computer** is what every paired device gets: browsing, opening any planning folder, and importing and exporting plans.
   - **Manage access** (off unless you tick it) also lets the device create pairing links and list and revoke paired devices. Tick it for the device you manage a headless `atlas serve` from.

   On a local-network address, the step warns again that the connection is not encrypted.

5. **Create pairing link** asks once more in a system dialog, then shows a link with a QR code, such as `http://100.64.1.2:7346/pair#token=<code>`, where the code looks like `7K3M-Q9TX-H2RW-5ZNC`. Above the link, Atlas restates what it grants.
   - The link works **once** and expires after **five minutes**.
   - **Copy link** copies the whole link, and **Copy code only** copies the code.
   - **Revoke** cancels the link before anyone uses it, and turning remote access off cancels every open link.
   - The QR code holds the same link, for a phone app later.

   Treat the link like a password until it is used or expires.

6. **Paired devices** lists each device by name, marks the ones with **Manage access**, and shows when each paired, whether it is connected and when it was last seen. **Revoke…** removes a device: its connection closes immediately and its credential stops working.

On Windows, the first time the host listens on a network address, Windows Defender Firewall may ask whether Atlas may communicate on networks. Allow it for private networks; Tailscale's network is usually treated as one. If the address goes away (Tailscale disconnects, or the network changes), Atlas says so in the dialog and tries again every 30 seconds.

## Connect from another device

On the other device, choose **File › Connect to Another Atlas…** (also on the welcome page and in the computer menu) and paste the pairing link. If you only have the address and the code, type the address (`http://100.64.1.2:7346`) and Atlas asks for the code. Atlas then lists that computer's planning folders. Choose one to open it, or **Open Folder on …** to browse that computer for another.

## Work on another computer

Each window says where it works: the **computer menu** (the computer's name in the title bar, after the menus) and the folder's name above the explorer.

- **The computer menu** lists this computer and every computer this one is paired with. Computers that do not answer are marked **Offline**.
  - Choosing a computer works on it in this window. Atlas opens:
    - its only planning folder;
    - else the one this device last showed there;
    - else its most recent;
    - and with none, that computer's welcome page, to open one.

    On a welcome page, choosing a computer shows its folder list instead.

  - **Connect to Another Atlas…** pairs with one more.
  - **Manage Computers…** lists them all. **↗** opens a computer in a new window. **Forget** forgets a paired computer here; press it again to confirm. Windows showing it close; if this window showed it, it shows this computer instead. To cut its access on that computer too, revoke the device there.

- **File › Open Recent** lists the computer's planning folders, newest first, then **Manage Folders…** (on macOS, **File › Manage Folders…**); **File › Open Folder…** opens another one:
  - on this computer, **Open Folder…** opens the system's dialog;
  - on another, it opens the **folder browser**. It lists that computer's folders (never files), marks planning folders (those with a `planning.json`) and opens only those. It starts beside the folder the window shows; **Home** goes to the home folder and the drives.
  - **Manage Folders…** lists every folder with its path, its number of work items and when it was last opened, and marks the one this window shows. **↗** opens a folder in a new window, and **×** takes it off the list on every device.
  - **File › Close Folder** goes back to the computer's welcome page.
- **Choosing a folder or a computer** opens it in this window. In a folder list, Ctrl+click (⌘+click on macOS) or **↗** opens it in a new window. A folder that is already open somewhere brings that window forward.
- **The welcome page**, in a window without a folder, has the same computer menu and lists the chosen computer's folders.

A window on another computer shows the computer's name in its title (`planning — desk — Atlas`). Everything works as it does locally:

- the work list, plans, ledgers, statistics, diagrams and quick open;
- **Export Plan…**, which saves the export on this device;
- **Import Plan…**, which sends the chosen file to that computer and adds the plan to the folder there.

Only **Reveal in File Explorer** is not offered. Your views count in that computer's document use.

Windows showing another computer's folders reopen on the next start while the computer is still paired. When that computer is unreachable (asleep, Atlas closed, or the network down), its windows keep showing the last view with a notice and reconnect on their own.

- Both sides check the connection every 30 seconds, so a connection that died silently is noticed within two minutes.
- When this device wakes from sleep, it checks its connections at once and replaces any that died.
- A window restored at start while its computer is unreachable opens the folder as soon as the computer answers.
- When the device is revoked, the window says so. Pair again with a new link, and the computer's windows read through the new pairing.

### The folder list

Each computer keeps one **folder list**, in `host/folders.json` in its Atlas data folder.

- **Joining:** a planning folder joins the list when it is opened there from any device, from the command line, or with `atlas serve --folder`.
- **Everyone sees the same list:** File › Open Recent and the welcome page, on this computer and on every paired device. A folder opened on one device appears on the others at once.
- **Leaving:** a folder stays until someone removes it with **×** in a folder list, which removes it for every device.
- **Missing folders:** a folder that was moved or deleted is marked **Missing**.
- **The first list** starts from the folders this Atlas recently opened and, from the first version of remote access, the folders it shared.

What each device shows stays its own: its windows, the folder each window shows, tabs, scrolling and the sidebar.

### Managing access from another device

A device paired with **Manage access** can manage that computer's pairings from its own windows. In a window on that computer, **File › Remote Access…** creates pairing links (with the same label and Manage access choice) and lists and revokes devices. It also shows how that computer is reached: its addresses and whether it listens. The settings for how the computer is reached stay with Atlas on that computer, or with `atlas serve` there.

## Without the desktop app: atlas serve

`atlas serve` runs the host from the `atlas` command, for a computer you use only from other devices (a desktop left on, or a server):

```sh
atlas serve
```

- **Address:** it listens on the computer's Tailscale address unless `--address` names another address of the computer, on port 7346 unless `--port` gives another one.
- **Folders:** paired devices open folders from its folder list or its folder browser. `--folder <planning-root>` (repeatable) adds a folder to the list as it starts.
- **Pairing:** it prints a pairing link with a QR code in the terminal. In an interactive terminal:
  - **Enter** prints a new link;
  - `manage` prints a link that also grants Manage access;
  - `devices` lists paired devices;
  - `revoke <device-id>` revokes one;
  - `quit` stops it.

  Ctrl+C also stops it. Pair your main device with `manage`, and you can pair the others from it.

- **Data folder:** `--data-dir` uses another Atlas data folder.
- **Output:** it prints warnings and errors to the terminal and keeps no log file.

One process per Atlas data folder manages remote access.

- **The lock:** the managing process holds a lock that the system releases when the process ends, however it ends (a named pipe on Windows, an abstract socket on Linux). The lock is named after a secret in the data folder, so every path to the same folder finds it, and other users cannot predict its name. A program that takes the name anyway cannot prove it read the secret: Atlas then says that a program that is not Atlas holds the lock, and remote access stays off.
- **Unreadable settings:** if `host/access.json` cannot be read, because it is damaged or a newer Atlas wrote it, Atlas leaves the file as it is, keeps remote access off and says why in **Remote Access**. To start over, remove the file and start Atlas again; paired devices then pair again.
- **The app and `atlas serve` together:**
  - while `atlas serve` runs, the app's **Remote Access** dialog shows remote access as managed by it and changes nothing;
  - once `atlas serve` stops, the app takes over within 15 seconds, or when the dialog opens;
  - `atlas serve` refuses to start while the app manages remote access.

  Devices paired with either one stay paired with the computer.

## How it works

The Atlas host (`packages/host`) is a Node server written with [Hono](https://hono.dev). It reads planning folders with the same code as the `atlas` command, watches them for changes and pushes those changes to connected clients.

The desktop app runs the host in a separate utility process and is its first client. Its main process connects to the host as the **owner**, over a loopback listener on a random port, with a token created at each start and kept only in memory. The app's windows still talk to their main process through the checked message list, and never reach the host directly.

A crashed host restarts, at most three times a minute; after that, Atlas says so and leaves it stopped until Atlas starts again. The app reconnects, opens its windows' folders again, and they carry on.

A paired device connects to the **network listener** that remote access turns on. Clients use a JSON request and event protocol over one WebSocket (`/api/connect`), and HTTP for files in documents, plan exports and plans sent for import.

| Route                                 | Purpose                                                                        | Credential       |
| ------------------------------------- | ------------------------------------------------------------------------------ | ---------------- |
| `GET /api/host`                       | The host's protocol version, ID, name and Atlas version.                       | None             |
| `GET /pair`                           | A short page saying the link belongs in Atlas, for a link opened in a browser. | None             |
| `POST /api/pair`                      | Exchange a pairing code for a device token (remote access address only).       | The pairing code |
| `GET /api/connect`                    | The WebSocket for requests and change events.                                  | Bearer token     |
| `GET /api/folders/:folderId/files/*`  | A file in a planning folder (images and attachments in documents).             | Bearer token     |
| `POST /api/folders/:folderId/imports` | A plan export sent from another device, read for an import preview.            | Bearer token     |
| `GET /api/exports/:token`             | A prepared plan export, once.                                                  | Bearer token     |

Every request has a declared scope, checked before anything else:

- **`computer`:** every paired device has it. It covers the folder list, the folder browser, opening any planning folder, reading it, document use, and plan export and import.
- **`access:manage`:** a device has it when its pairing link granted Manage access. It covers pairing links, the paired devices list, revocation, and the remote access status.
- **`owner`:** changing how the computer is reached is for the owner only.

The loopback listener accepts only the owner credential, and only from this computer. The network listener accepts only device credentials.

### Security

- **Pairing codes** are 16 characters of Crockford base32 (80 random bits), shown in groups of four.
  - They live only in the host's memory, work once and expire after five minutes; a restart forgets them.
  - At most 20 links can be open at once.
  - After 20 wrong codes from one address within five minutes, or 200 from all addresses together, the host refuses pairing until the window passes.
- **Device tokens** are 32 random bytes.
  - The host stores only their SHA-256 hash, with what the device may do, in `<Atlas data folder>/host/access.json`, and compares hashes in constant time.
  - The connecting device stores its token in `connections.json` in its data folder, encrypted with the system's credential store through Electron's `safeStorage` (DPAPI on Windows; the GNOME keyring or KWallet on Linux). On Linux without a keyring, the token is stored unencrypted.
  - Both files are written with owner-only permissions on Linux; on Windows, the data folder is in your user profile.
- **What a device can reach** is what Atlas reaches on that computer, as the user who runs it:
  - the names of folders it may list;
  - the files inside planning folders;
  - new work items it imports into a planning folder.

  It cannot read other files, run programs, edit plans or change how the computer is reached. A lost or stolen device keeps that reach until you revoke it, so revoke it from the computer, from `atlas serve` (`revoke`), or from another device with Manage access.

- **Identity:** before sending its token, over the WebSocket or for a file, a client checks that the address answers with the host ID it paired with, so a different Atlas that now has the address does not receive the credential. The host ID is public, so this is no defence against someone deliberately impersonating the host on your network: use Tailscale, which authenticates the computers themselves.
- **Browsers are refused:** any request that carries an `Origin` header is rejected, so no web page can call the host, and the `Host` header must be an IP address or `localhost`, which blocks DNS rebinding. Responses carry a restrictive content security policy.
- **Files:** requests resolve inside the planning folder with the same containment as the app: no paths outside it, and no hidden or excluded folders. Files over 64 MB are not served.
- **Limits:**
  - messages are limited in size;
  - each device prepares one plan export at a time and holds at most two, and prepared exports expire after ten minutes;
  - a plan sent for import is at most 512 MB, one at a time per device, kept in a private temporary file only while it is read.
- **Transport:** the host speaks plain HTTP and relies on the network for encryption. Use Tailscale (WireGuard) across networks; on a local network, traffic can be read by anyone able to watch it.

### Privacy

Remote access sends planning-folder contents only to devices you paired, and only while it is turned on. A paired device can see what the app shows on that computer:

- the names of folders it browses, anywhere the computer's user may list;
- real paths, which often include the user's name;
- any planning folder's files, Git activity (commit titles and dates, without authors) and work statistics;
- document-use counts and last-use dates.

Its views are recorded in that computer's document use, like views there. A device can also save a plan export, a copy its user then keeps, and import plans into a planning folder on that computer.

While remote access is on, anyone who can reach the chosen address and port can ask the host who it is (`GET /api/host`). The answer is this computer's name, a host ID and the Atlas version, but no folders or content. Over Tailscale, only your tailnet can ask; on a local network, anyone on it can.

What each computer keeps:

- **The computer with the folders:**
  - `access.json` lists each paired device's name (its label, or the device's own computer name), platform, what it may do, pairing time and last-seen time, until the device is revoked;
  - `folders.json` lists the planning folders opened there, from any device, until they are removed from the list;
  - when the app runs the host, `host.log` records the device's IP address and name when it pairs, its device ID when it connects, and revocations.
- **The connecting device:**
  - `connections.json` holds the paired computer's name, address, the device's credential and whether it may manage access, until you forget the computer there;
  - `desktop-state.json` remembers the folder last shown on each computer, and the window layout of each folder.

  Forgetting a computer removes both. `atlas.log` records the computer's name and address when pairing.

- **Logs** rotate by size: 1 MB per file, with three older files kept. Revoking or forgetting a computer does not remove lines already in the log.

**Copy link** and **Copy code only** put the pairing code on the clipboard, where clipboard history or sync may keep it; the code still works only once and only for five minutes.

Nothing goes through an Envsemble or third-party service: devices connect to the host directly, through Tailscale when you choose its address. Atlas has no telemetry, and remote access adds none.
