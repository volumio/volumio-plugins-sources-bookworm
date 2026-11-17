# Shuffle Playlist (Volumio plugin)

Creates a pre-shuffled copy of any saved playlist and adds " shuffle" to its name.
The original playlist is not changed.

## Why

Volumio's built-in random mode picks tracks at random, so some tracks can play again and again
while others rarely play, and the **Previous** button does not return to the track that actually
played before.

A pre-shuffled playlist avoids both problems by construction:

- every track plays **exactly once per pass**, so no repeats until the list ends;
- the order is fixed, so **Previous works as normal**;
- the built-in random mode stays off, nothing in the player is patched.

It is deliberately simple: the plugin only reorders a copy of a playlist and uses the playback
logic Volumio already has.

## Typical scenario: your library as a personal radio

1. In Volumio, add the folders you want to hear to one big playlist (for example "Library").
   Audiobooks, podcasts and anything else you leave out simply never get into the list, so no
   folder filtering is needed.
2. In this plugin, create the shuffled copy ("Library shuffle").
3. Play it with random mode off. It plays through like a radio station: no repeats, and Previous works.
4. Combine with an autostart plugin (see below) so it continues where it stopped after a restart.

## Usage

1. Open *Plugins → Installed plugins → Shuffle Playlist → Settings*.
2. Pick a playlist and press **Create shuffled copy**.
3. Play the new "... shuffle" playlist with random mode **off**.

Running it again on the same playlist, or on the "... shuffle" copy itself, re-shuffles the copy.

## Recommended: use together with an autostart plugin

Install a plugin that **remembers the queue and continues it** after a restart (for example the
"Autostart" plugin from the Volumio plugin store). Without it, a reboot starts the queue from the
beginning, and the first tracks of the shuffled list will play again. With it, playback resumes where
it stopped and tracks do not repeat across restarts either.

## Limitations

- The copy is a snapshot. If you add tracks to the original playlist, create the copy again.
- With "repeat playlist" on, the second pass uses the same order. Create the copy again to get a new one.
- A playlist already named "<name> shuffle" is overwritten when you shuffle "<name>".

## Installation

Requires Volumio 4 (Bookworm, Node 20+), amd64 or armhf.

From the Volumio plugin store: *Plugins → Search plugins → Miscellanea → Shuffle Playlist → Install*.

Manual installation for testing: copy the plugin folder to the device and run `volumio plugin install`
inside it (see the Volumio plugin development guide).

## Technical notes

Playlists are read from and written to `/data/playlist/` as Volumio stores them, so all track
metadata is kept. The new file is written to a temporary file first and then renamed, so a power
loss cannot leave a half-written playlist. Stale temporary files (hidden, `*.shuffle_tmp`) are removed
when the plugin starts.

The suffix added to the copy's name is stored in `config.json` (`suffix`, default `" shuffle"`).

## License

ISC
