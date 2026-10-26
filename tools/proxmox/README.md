# Proxmox-Helper für den agent-deck Hub

`agent-deck-hub.sh` richtet den Hub in einem eigenen LXC-Container ein, im Stil von [community-scripts.org](https://community-scripts.org). Es kommt ohne Docker aus: Node.js 24 und ein systemd-Dienst reichen.

```bash
# In der Shell des Proxmox-Hosts (root):
bash -c "$(curl -fsSL https://raw.githubusercontent.com/florianwilde/agent-deck/main/tools/proxmox/agent-deck-hub.sh)"
```

| Wo           | Aufruf                     | Wirkung                                                                                     |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------- |
| Proxmox-Host | Skript ausführen           | LXC anlegen (Debian 13, unprivilegiert), Hub im Normalbetrieb installieren, Tokens anzeigen |
| Container    | `update`                   | Neuesten Stand des Branches holen, bauen, Helfer erneuern, Dienst neu starten               |
| Container    | `update <branch>`          | Einmalig einen anderen Branch einspielen                                                    |
| Container    | `agent-deck-hub token`     | Token für die Cloud-Sessions (Network Secret) anzeigen                                      |
| Container    | `agent-deck-hub vpn-token` | Token für das Stream-Deck-Plugin anzeigen                                                   |
| Container    | `agent-deck-hub normal`    | Installation aus Phase 0 auf `HUB_MODE=normal` umstellen (siehe `docs/setup-hub.md`)        |
| Container    | `agent-deck-hub status`    | Dienststatus und `/health` anzeigen                                                         |

Umgebungsvariablen auf dem Host:

| Variable              | Standard                                         | Bedeutung                                  |
| --------------------- | ------------------------------------------------ | ------------------------------------------ |
| `AGENT_DECK_DEFAULTS` | `0`                                              | `1` = keine Dialoge, Standardwerte nehmen  |
| `AGENT_DECK_BRANCH`   | `main`                                           | Git-Branch, z. B. ein PR-Branch zum Testen |
| `AGENT_DECK_REPO`     | `https://github.com/florianwilde/agent-deck.git` | Git-URL, z. B. ein Fork                    |
| `AGENT_DECK_PORT`     | `8787`                                           | Port des öffentlichen Listeners            |
| `AGENT_DECK_VPN_PORT` | `8788`                                           | Port des VPN-Listeners (Plugin)            |

## Was im Container landet

| Pfad                                                | Inhalt                                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/opt/agent-deck`                                   | Git-Checkout und Build                                                                                                                        |
| `/etc/agent-deck/hub.env`                           | Konfiguration inkl. `HUB_TOKEN` und `HUB_VPN_TOKEN` (`root:agentdeck`, `0640`). Wird bei `update` und erneutem `install` nicht überschrieben. |
| `/var/lib/agent-deck`                               | SQLite-Datenbank                                                                                                                              |
| `agent-deck-hub.service`                            | systemd-Dienst, läuft als User `agentdeck`                                                                                                    |
| `/usr/local/sbin/agent-deck-hub`, `/usr/bin/update` | Helfer für Update, Token und Status                                                                                                           |

## Aufbau des Skripts

Das Skript besteht aus einem Host-Teil (`host_*`) und einem Container-Teil (`ct_*`). Der Host-Teil schreibt den Container-Teil mit `declare -f` in eine eigene Datei und kopiert sie per `pct push` in den Container. Dort führt `agent-deck-hub install` die Installation aus. Wer das Skript direkt im Container startet, löst ein Update aus.

Geprüft wurde Folgendes:

- `shellcheck` meldet nichts, weder für das Skript noch für den erzeugten Container-Teil.
- Der Container-Teil lief in einem Debian-12-Container durch: Install, Update und ein erneutes Install. Ein Request gegen den laufenden Hub kam an.
- Der Host-Teil lief mit Attrappen für `pct`, `pveam`, `pvesm` und `pvesh`.
- Nicht prüfbar waren ein echter Proxmox-Host, systemd im LXC und die NodeSource-Installation, weil das Netz der Sandbox `deb.nodesource.com` sperrt.
