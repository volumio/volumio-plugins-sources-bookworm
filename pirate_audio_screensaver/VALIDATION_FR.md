# Validation de la bêta 0.1.6

Base : version 0.1.5 du dépôt `arut16/volumio-plugins-sources-bookworm`, branche `add-pirate-audio-screensaver`, commit `2d889172d637aeefb7c57679a17b4b3ad7542487`.

## Contrôles effectués sur le PC

- 15 tests du plugin avec les vraies bibliothèques `kew` et `v-conf` : migration, interrupteurs, persistance, aperçu individuel, galerie, refus de tout désactiver, erreurs de sauvegarde/redémarrage et cycle d'activation du partage de l'écran.
- 45 tests Python réussis : comportement existant et filtrage des polices, sélection unique, valeurs absentes/invalides, police de secours, tirage aléatoire limité à la sélection ; partage de l'écran, restauration de l'image native, activité des boutons, rotation, reconnexion rapide Socket.IO, arrêt natif, expiration, sérialisation des écritures et communication réelle par flux.
- 10 tests supplémentaires réussis du helper d'autorisations, avec une vraie exécution du shell et des fichiers isolés : validation avant remplacement et migration, limitation aux deux commandes, protection des entrées étrangères, conservation des règles en cas d'échec et retrait à la désinstallation. Sous Windows, `visudo` et `chown` sont simulés ; la validation réelle de la règle et ses droits sont effectués par le helper sur le Pi.
- Un test supplémentaire de socket Unix est ignoré car le runtime Python Windows ne fournit pas `AF_UNIX`. Le protocole client/serveur est testé avec une vraie paire de sockets ; le partage par socket Linux et le matériel ont été vérifiés manuellement sur le Raspberry Pi.
- Génération des 15 aperçus « 12:34 » : images lisibles, centrées, sans rognage et reproductibles.
- Construction du paquet Python 0.1.6 et présence du catalogue et des polices dans le paquet.
- Vérification de la syntaxe des scripts d'installation/désinstallation et du contenu de l'archive.

Ces contrôles ne remplacent pas la validation de l'écran et de l'interface sur le Raspberry Pi. Aucune soumission au magasin n'a été effectuée.

## Résultats confirmés sur le Raspberry Pi

Volumio 4.119 / Bookworm, Python 3.11, Pirate Audio 0.1.5 et `st7789` 1.0.1, le 3 octobre 2026 :

- Les 15 interrupteurs et les aperçus individuels « 12:34 » s'affichent dans les réglages.
- La galerie affiche les 15 polices sur trois colonnes sur ordinateur.
- La sélection unique Cose Grottesche est enregistrée et propagée à `ENABLED_FONTS=cose-grottesche`.
- Avec le correctif de reconnexion du wrapper, le socket `pirateaudio.sock` reste présent et les deux services fonctionnent.
- L'horloge apparaît après le délai de 10 secondes. L'appui sur le bouton physique lecture masque immédiatement l'horloge et relance la musique.
- La règle sudo est validée par le vrai `visudo` du Pi. L'activation et la désactivation du partage fonctionnent après effacement de l'authentification sudo mise en cache.
- Après redémarrage complet du Raspberry Pi, les deux plugins restent actifs ; la sélection de police, l'horloge après 10 secondes et la reprise avec le bouton lecture fonctionnent.

Le démarrage automatique utilise une règle dédiée `volumio-user-pirate-audio-screensaver`, lue après la règle générale de Volumio. Elle autorise uniquement les deux commandes exactes du bridge avec `sudo -n`. Installation et migration sont validées avant remplacement ; la désinstallation retire les fichiers marqués appartenant au plugin.

## Procédure de vérification sur Volumio 4 / Bookworm

1. Sauvegarder les réglages 0.1.5 avant toute désinstallation :

   ```bash
   cp /data/configuration/user_interface/pirate_audio_screensaver/settings.json ~/pirate-audio-settings-0.1.5.json
   ```

2. Si le dossier de configuration indiqué est absent, retrouver d'abord les vrais fichiers de configuration et sauvegarder également le fichier d'environnement du plugin installé. Le programme d'installation local peut refuser un plugin déjà présent : désinstaller alors la 0.1.5 depuis Volumio uniquement après vérification de la sauvegarde. Extraire l'archive dans un dossier de travail et exécuter `volumio plugin install` depuis ce dossier. Restaurer les fichiers de configuration sauvegardés avant d'activer le plugin.
3. Ouvrir les paramètres. Vérifier le délai et la rotation précédents, ainsi que les 15 interrupteurs actifs lors de la première mise à jour.
4. Ouvrir « Aperçu de toutes les polices ». Vérifier les 15 « 12:34 », répartis sur trois colonnes sur ordinateur (une sur écran étroit), le défilement et le bouton « Fermer ». Vérifier aussi l'aperçu individuel via l'icône d'aide, si ces icônes sont activées dans Volumio.
5. Garder uniquement Poxel, enregistrer, arrêter la lecture et attendre le délai. L'horloge doit utiliser uniquement Poxel. Réactiver deux ou trois polices et vérifier plusieurs changements de minute.
6. Essayer de tout désactiver et enregistrer : un message doit demander de garder une police active ; la précédente sélection doit rester appliquée. Recharger les paramètres pour la revoir.
7. Modifier le délai ou la rotation : la sélection des polices doit rester identique. Redémarrer le Raspberry Pi et vérifier tous les réglages.
8. Démarrer la musique puis désactiver/réactiver le plugin. Vérifier le retour de l'affichage normal et le cycle d'activation de l'écran de veille. Pendant la veille, tester les quatre boutons et les menus du plugin Pirate Audio ; ils doivent répondre, masquer l'horloge et relancer le délai d'inactivité.
9. Vérifier que les deux services restent `active` avec Pirate Audio 0.1.5 et `st7789` 1.0.1. Redémarrer le backend Volumio et vérifier que le socket de partage et la veille survivent aux reconnexions de Pirate Audio. Arrêter uniquement le service screensaver : son horloge doit disparaître et l'affichage Pirate Audio doit revenir. Réactiver puis redémarrer le Raspberry Pi, vérifier la veille et la reprise musicale. Désactiver le plugin depuis Volumio : la surcharge `50-volumio-screensaver.conf` doit avoir disparu et la commande originale de Pirate Audio doit être restaurée.

Contrôles utiles :

```bash
cat /data/plugins/user_interface/pirate_audio_screensaver/volumio-screensaver.env
cat /data/configuration/user_interface/pirate_audio_screensaver/settings.json
sudo systemctl status volumio-screensaver
sudo journalctl -u volumio-screensaver -n 100 --no-pager
```

La ligne `ENABLED_FONTS=poxel` confirme la sélection unique. Le magasin conserve la catégorie `user_interface` et le dossier de publication reste à la racine du dépôt Bookworm. Après les tests, committer et pousser les sources validées, puis lancer `volumio plugin submit` depuis `~/volumio-plugins-sources-bookworm/pirate_audio_screensaver`, connecté au même compte MyVolumio que lors de la première publication. Utiliser un checkout source propre, sans environnement virtuel, caches, anciennes archives ni dossier d'artefacts. La nouvelle version sera soumise en bêta.
