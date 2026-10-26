import streamDeck from "@elgato/streamdeck";
import { SlotAction, send } from "./actions/slot.ts";
import { Deck } from "./deck.ts";
import { HubClient } from "./hub-client.ts";
import type { GlobalSettings } from "./settings.ts";

// Kein "trace": das würde den Token aus den globalen Einstellungen mitloggen.
streamDeck.logger.setLevel("info");

const hub = new HubClient({ onLog: (message) => streamDeck.logger.info(message) });
const deck = new Deck({ hub, openUrl: (url) => streamDeck.system.openUrl(url) });

let lastStatus = "";
hub.subscribe((_sessions, status) => {
  const key = JSON.stringify(status);
  if (key === lastStatus) return;
  lastStatus = key;
  streamDeck.logger.info(
    `Hub: ${status.state}${status.error ? ` (${status.error})` : ""}, ${status.sessions} Sessions`,
  );
  void send({ event: "status", status });
});

const applyGlobalSettings = (settings: GlobalSettings): void => {
  deck.setGlobalSettings(settings);
  hub.configure({ hubUrl: settings.hubUrl, token: settings.token });
};

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) =>
  applyGlobalSettings(ev.settings),
);
streamDeck.actions.registerAction(new SlotAction(deck, hub));

await streamDeck.connect();
deck.start();
applyGlobalSettings(await streamDeck.settings.getGlobalSettings<GlobalSettings>());
