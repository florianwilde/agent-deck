import streamDeck, {
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type KeyUpEvent,
  type PropertyInspectorDidAppearEvent,
  type SendToPluginEvent,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { Deck } from "../deck.ts";
import type { HubClient } from "../hub-client.ts";
import { svgToDataUrl } from "../render/index.ts";
import {
  type PiToPlugin,
  type PluginToPi,
  SLOT_ACTION_UUID,
  type SlotSettings,
} from "../settings.ts";

/** JSON-Wert, wie ihn `sendToPropertyInspector` erwartet (das SDK exportiert den Typ nicht). */
type JsonValue = Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0];

/** Aktion „Projekt-Slot“: dünner Adapter zwischen Stream Deck und {@link Deck}. */
export class SlotAction extends SingletonAction<SlotSettings> {
  override readonly manifestId = SLOT_ACTION_UUID;
  readonly #deck: Deck;
  readonly #hub: HubClient;
  /**
   * Anfragen eines Property Inspectors, der laut SDK noch nicht sichtbar ist. Stream Deck kann
   * `sendToPlugin` vor `propertyInspectorDidAppear` liefern (die sdpi-datasource fragt gleich beim
   * Laden), und `sendToPropertyInspector` verwirft Antworten bis dahin. Beantwortet beim Erscheinen.
   */
  readonly #pending = new Map<string, Set<PiToPlugin["event"]>>();

  constructor(deck: Deck, hub: HubClient) {
    super();
    this.#deck = deck;
    this.#hub = hub;
  }

  override onWillAppear(ev: WillAppearEvent<SlotSettings>): void {
    const action = ev.action;
    if (!action.isKey()) return;
    const coordinates = action.coordinates;
    this.#deck.addSlot(
      {
        id: action.id,
        device: action.device.id,
        row: coordinates?.row ?? 0,
        column: coordinates?.column ?? 0,
        settings: ev.payload.settings,
      },
      {
        setImage: (svg) => action.setImage(svgToDataUrl(svg)),
        showOk: () => action.showOk(),
        showAlert: () => action.showAlert(),
      },
    );
  }

  override onWillDisappear(ev: WillDisappearEvent<SlotSettings>): void {
    this.#deck.removeSlot(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SlotSettings>): void {
    this.#deck.updateSlotSettings(ev.action.id, ev.payload.settings);
  }

  override onKeyDown(ev: KeyDownEvent<SlotSettings>): void {
    this.#deck.keyDown(ev.action.id);
  }

  override onKeyUp(ev: KeyUpEvent<SlotSettings>): void {
    this.#deck.keyUp(ev.action.id);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, SlotSettings>): Promise<void> {
    const event = (ev.payload as PiToPlugin | null)?.event;
    if (event !== "getStatus" && event !== "testConnection" && event !== "repos") return;
    if (streamDeck.ui.action?.id !== ev.action.id) {
      const pending = this.#pending.get(ev.action.id) ?? new Set();
      pending.add(event);
      this.#pending.set(ev.action.id, pending);
      return;
    }
    await this.#answer(event);
  }

  override async onPropertyInspectorDidAppear(
    ev: PropertyInspectorDidAppearEvent<SlotSettings>,
  ): Promise<void> {
    const pending = this.#pending.get(ev.action.id);
    this.#pending.clear();
    // Den Status braucht ein frisch geöffneter Inspector immer, auch ohne Anfrage.
    await send({ event: "status", status: this.#hub.status });
    for (const event of pending ?? []) if (event !== "getStatus") await this.#answer(event);
  }

  async #answer(event: PiToPlugin["event"]): Promise<void> {
    switch (event) {
      case "getStatus":
        await send({ event: "status", status: this.#hub.status });
        break;
      case "testConnection":
        await send({ event: "testResult", ...(await this.#hub.test()) });
        break;
      case "repos":
        await send({
          event: "repos",
          items: this.#deck.repos().map((repo) => ({ label: repo, value: repo })),
        });
        break;
    }
  }
}

/** Nachricht an den sichtbaren Property Inspector (wird verworfen, wenn keiner offen ist). */
export async function send(message: PluginToPi): Promise<void> {
  await streamDeck.ui.sendToPropertyInspector(message as unknown as JsonValue);
}
