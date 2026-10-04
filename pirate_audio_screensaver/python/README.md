# Ecran Veille Volumio

Ecran de veille Python pour Volumio sur Raspberry Pi Zero 2 W avec Pimoroni Pirate Audio 1W Amp / Audio 1W HAT.

Il affiche l'heure au format 24 h sur l'ecran ST7789 240x240. Les deux points clignotent chaque seconde sans faire bouger les minutes. L'heure change de position, de police et de couleur aleatoirement toutes les minutes, avec des couleurs suffisamment lumineuses pour rester lisibles sur fond noir.

Un petit triangle blanc `play` est affiche en haut a gauche pour rappeler le bouton physique haut-gauche du HAT permettant de reprendre la lecture.

## Comportement

- L'ecran de veille s'active apres 5 minutes sans musique (`status` different de `play`).
- Il se masque automatiquement quand la musique demarre depuis l'interface Web Volumio ou depuis le bouton play/pause du HAT.
- Par defaut, le service ne lit pas les 4 boutons du HAT afin de ne pas entrer en conflit avec le plugin Pirate Audio/Volumio qui les utilise deja.
- Les polices integrees sont chargees depuis `volumio_screensaver/fonts/`.

## Installation depuis SSH

Connecte-toi au Raspberry Pi depuis PuTTY ou un terminal SSH :

```bash
ssh volumio@volumio.local
```

Puis lance l'installation :

```bash
curl -fsSL https://raw.githubusercontent.com/arut16/Ecran-Veille-Volumio/main/install.sh | sudo bash
```

Le script installe les dependances, clone la derniere version GitHub dans un dossier temporaire, reinstalle le package Python, cree `/etc/volumio-screensaver.env` s'il n'existe pas encore, active le service `systemd`, puis redemarre `volumio-screensaver`.

La meme commande sert pour les mises a jour du code ou l'ajout/suppression de polices dans `volumio_screensaver/fonts/`.

## Configuration

La configuration locale se trouve ici :

```bash
sudo nano /etc/volumio-screensaver.env
sudo systemctl restart volumio-screensaver
```

Les options utiles :

```bash
VOLUMIO_URL=http://127.0.0.1:3000
IDLE_DELAY_SECONDS=300
FONT_SIZE=58
DISPLAY_ROTATION=90
BLANK_TURNS_BACKLIGHT_OFF=true
LOG_LEVEL=INFO
```

`IDLE_DELAY_SECONDS=300` correspond a 5 minutes. Pour tester rapidement, tu peux temporairement mettre `10`, puis redemarrer le service.

## Boutons du HAT

Le screensaver ne surveille pas les boutons par defaut. C'est volontaire : Volumio/Pirate Audio les gere deja, et une double surveillance GPIO peut provoquer des actions parasites dans le menu.

Si tu veux experimenter la lecture directe des boutons par le screensaver, tu peux ajouter ces lignes dans `/etc/volumio-screensaver.env` :

```bash
BUTTONS_ENABLED=true
BUTTON_PINS=5,6,16,24
```

Si le journal affiche `Failed to add edge detection`, ou si le menu Pirate Audio se deplace tout seul, reviens a :

```bash
BUTTONS_ENABLED=false
BUTTON_PINS=
```

## Polices

Les polices doivent etre placees dans :

```text
volumio_screensaver/fonts/
```

Extensions prises en charge :

```text
.ttf .TTF .otf .OTF
```

Avant d'ajouter une police au depot, verifie qu'elle affiche correctement tous les caracteres suivants :

```text
00:00 11:11 22:22 33:33 44:44 55:55 66:66 77:77 88:88 99:99
```

Apres ajout ou suppression de polices sur GitHub, mets le Raspberry Pi a jour avec :

```bash
curl -fsSL https://raw.githubusercontent.com/arut16/Ecran-Veille-Volumio/main/install.sh | sudo bash
```

Pour voir les polices installees sur le Raspberry Pi :

```bash
find /data/plugins/user_interface/pirate_audio_screensaver/venv/lib/python3.11/site-packages/volumio_screensaver/fonts -iname "*.ttf" -o -iname "*.otf"
```

## Commandes de service

```bash
sudo systemctl status volumio-screensaver
sudo journalctl -u volumio-screensaver -f
sudo systemctl restart volumio-screensaver
sudo systemctl disable --now volumio-screensaver
```

## References materiel

Pimoroni indique que la gamme Pirate Audio utilise un ecran ST7789 240x240 et 4 boutons actifs bas sur BCM 5, 6, 16 et 24. Les exemples officiels mentionnent aussi l'ancien pin BCM 20 pour certaines cartes.
