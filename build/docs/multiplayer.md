# Multiplayer and phone controllers

Comfy Fighter Z has several ways to play the same game. The roster, introductions, specials, supers and round rules are shared across modes. Arcade, local Versus and Training run in one browser; the two network modes below use the bundled Node server.

| Title-screen button | Players and screens |
| --- | --- |
| **ARCADE** | One player against a CPU ladder that ends with the final boss, using the keyboard, a gamepad or the game's on-screen buttons. **VERSUS** and **TRAINING** are local modes beside it. |
| **ONLINE VERSUS** | Two human players, each viewing the game on their own computer. Join by invitation. |
| **PHONE / TV** | One shared TV or computer display, with one phone against the CPU or two phones against each other. |

These modes are included in newly built games. Earlier downloaded ZIPs keep their original runtime: rebuild their `sources/` folder with the current builder to add multiplayer without generating new artwork.

## Start the game server

To build from a repository checkout, install Node.js 22 or newer and run:

```sh
npm ci
npm run example
npm start
```

This builds the included fictional assets and serves `output/game/`. It makes no cloud generation calls. See the [main README](../../README.md#1-build-the-included-example) for installation details.

If you already have a newly exported game ZIP, extract it and open a terminal inside its game folder:

```sh
npm start
```

Exports bundle the server and its dependencies, so **do not run `npm install` in the exported game**. Node.js 22 or newer is still required. Leave the terminal running. The server prints a local address and, when available, a **Phone / LAN** address such as `http://192.168.1.25:8080`.

## Online Versus: invite a friend

1. Open the game and choose **ONLINE VERSUS** on the title screen.
2. Select **CREATE A ROOM** and **COPY INVITE**.
3. Send the link to your opponent. They can open it directly, or choose **ONLINE VERSUS**, paste the invitation or 12-character room code and select **JOIN ROOM**.
4. Each player chooses a fighter and selects **READY TO FIGHT**. Use **NOT READY / CHANGE FIGHTER** to change your selection before the match starts.
5. Watch or skip the fighter introductions, then play. Both players use arrows and ASDF on their own keyboards. The **ONLINE / P1** or **ONLINE / P2** badge reopens the room panel; after the match, ready up again for a rematch.

An invite must point to a server both computers can reach. For two computers on your home network, create the room from the printed LAN address. For friends on different networks, use a publicly hosted HTTPS game with its multiplayer server running; a private `192.168.x.x` address is not an Internet invitation.

Rooms are private by invitation; there is no public matchmaking lobby or account signup. Both players must use the same game URL and roster. The root demo and `/phone-photo-demo/` have separate rooms.

## Phone / TV: play on a shared display

The TV or computer shows the full game. Phones show fighter selection and touch controls; no controller app is needed.

1. Connect the display computer and phones to the same Wi-Fi when using a local server.
2. On the **display computer**, open the printed **Phone / LAN** address. Do this before making a session. For a hosted game, use its public HTTPS URL instead.
3. Choose **PHONE / TV** on the title screen, then select **One phone vs CPU** or **Two phones / versus**.
4. Select **START SHARED SCREEN**. Scan Player 1's QR code with the first phone and tap **CONNECT AS PLAYER 1**. For two-player mode, scan Player 2's code with the second phone and tap **CONNECT AS PLAYER 2**.
5. Choose a fighter on each phone and tap its Ready button. Keep the game visible on the display and the controller pages visible on the phones.
6. Drag the phone's thumbstick to move, jump or crouch, and use the **A / S / D / F** attack buttons. Press two buttons together for a roll (A+S), blowback (S+D) or super (F+D); the **TAUNT** pill under the stick drains the opponent's power gauge. Use **FULLSCREEN** on the display to fill the TV.

**Do not create a local phone session at `127.0.0.1` or `localhost`.** Those addresses mean “this device,” so the QR code would send a phone to itself. Opening the LAN address on the display makes the generated controller links point to the computer running the server.

The session panel can refresh unclaimed QR codes or release a paired phone so another player can join that seat. The CPU seat needs no phone. Controller links are seat-specific; scan the code for the intended player.

## Controls and pauses

| Control | Action |
| --- | --- |
| Left / right arrows | Move; hold away from the opponent to block |
| Up / down arrows | Jump / crouch |
| A / S / D / F | Punch / kick / heavy strike / special |
| Space | Skip the optional opening or fighter introductions |
| Escape / session panel | Pause local play or open the network session panel |
| Phone thumbstick and A / S / D / F | The same movement and attacks on a paired controller |

Combat waits for the introductions. Network matches also pause when a required screen or controller loses focus, switches to another tab or disconnects. Return to every required page and close the session panel to continue. This prevents one player from fighting an absent opponent.

The client reconnects automatically after a brief interruption. Keep the original tab open: it stores that seat's reconnect token for the current browser session. The server reserves a disconnected seat for **45 seconds**. If it expires, create a new online room or scan a fresh phone code. If the shared display fails to reconnect in time, start a new shared-screen session.

Rooms and matches live in the server's memory. Restarting or deploying the server ends active sessions; there is no saved online match to restore afterward.

## Host a game for other people

A static host is enough for the default single-player CPU game. Online rooms and QR phone pairing require the included Node server. An HTTPS site must proxy the game's WebSocket endpoint as **WSS**, alongside its runtime configuration endpoint. Use one server process for a game; independent processes do not share rooms.

The repository includes [a systemd service](../deploy/comfy-fight-z.service) and [an Nginx configuration](../deploy/comfy-fight-z.nginx.conf). The [hosting guide](../deploy/README.md) explains the static/runtime split, environment variables and separate demo mounts.

## Common fixes

| Problem | Fix |
| --- | --- |
| The title has no multiplayer buttons | Rebuild the export using the current repository. Existing artwork can be reused. |
| A phone cannot open its QR link | Open the game at the printed LAN address on the display and create a fresh session. Put both devices on the same Wi-Fi; guest-network isolation or a blocked local server port can prevent access. |
| An invitation works only on the host's computer | Replace a loopback URL with the LAN address for local play, or use a publicly hosted game for remote friends. Create the room from that reachable URL. |
| The room keeps reconnecting on a static website | Run the Node backend and proxy its WebSocket endpoint. Static files alone cannot host rooms. |
| The match says it is on hold | Return to every game/controller tab, unlock the phones and close the session panel. |
| A seat expired or the server restarted | Create a new room or shared-screen session. Old room and controller links cannot restore a deleted session. |
| Changes are missing from `output/game/` | Rebuild the included example with `npm run example`, or rebuild your own bundle using the current builder. `npm run build` installs the canonical source preview instead. |
| Port 8080 is busy | Stop the previous server with Ctrl+C, or set `PORT` before running `npm start`. |

Playing, hosting and rebuilding accepted assets do not call ComfyUI or spend cloud credits.
