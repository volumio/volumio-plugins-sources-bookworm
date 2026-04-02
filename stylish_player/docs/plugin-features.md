## Current List of Plugin Features:

Provides a feature rich alternative "Now Playing" screen with controls, animations, spectrum analyzer, and idle screen which has it's own rich set of features.

### Now Playing screen:

1. Player animation on the left side. Multiple choices available (Double click or double tap on player to cycle through different ones below:
   1. Album Art ![Album Art](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/album-cover-player.png)
   2. Vinyl with and without cover ![Vinyl with Cover](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/vinyl-cover-player.png)![Vinyl without Cover](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/vinyl-player.png)
   3. CD with and without cover ![CD with Cover](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/cd-cover-player.png)![CD without Cover](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/cd-player.png)
   4. Cassette ![Cassette](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/cassette-player.png)
   5. Reel 2 Reel ![Reel to Reel](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/reel-to-reel-player.png)
   6. Radio ![Radio](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/web-radio-player.png)
   7. Globe ![Globe](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/globe-player.png)
   8. Random
   9. Match source (Flac -> CD, Qobuz to Globe, Internet Radio to Radio etc.)
2. Player controls on the right, along with track and source information, and playlist management controls
3. Spectrum analyzer / VU Meters on bottom (or right depending on screen size). Provides a slightly delayed visualization based on the audio stream exposed by the device.

### Idle Screen:

When not playing music, after a desired interval, the screen falls back to a different screen with the following options.

1. Digital Clock ![Digital Clock](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/digital-clock.png)
2. Flip Clock ![Flip Clock](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/flip-clock.png)
3. Analog Clock ![Analog Clock](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/analog-clock.png)
4. Wallpaper (optional time and current weather) / slideshow, using Unsplash ![Wallpaper](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/metallic/wallpaper.png)
5. Weather screens (current, daily, 10 day, full details), with live weather effects (rain, fog, etc.) on the current and full weather screens ![Weather Current](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/weather/current.png)![Weather Daily](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/weather/daily.png)![Full Weather](https://file%2B.vscode-resource.vscode-cdn.net/Volumes/Data/projects/volumio-plugins-sources-bookworm/stylish_player/docs/screenshots/weather/full.png)

For providing photos for the Wallpaper, use Unsplash API (requires registration as a developer)

<https://unsplash.com/developers>

API Reference

<https://unsplash.com/documentation#photos>

Example Query <https://api.unsplash.com/photos/random?query=wallpaper&orientation=landscape&count=30>

### Theming Support

Currently has 5 themes to choose from

1. Aqua [README](docs/AQUA-README.md)
2. Flat [README](docs/FLAT-README.md)
3. Metallic [README](docs/METALLIC-README.md)
4. Skeuomorphic [README](docs/SKEUOMORPHIC-README.md)
5. Win95 [README](docs/WIN95-README.md)
