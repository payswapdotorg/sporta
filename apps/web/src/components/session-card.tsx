import Link from "next/link";
import type { CapabilityLike, SessionCardLike } from "@/lib/api-types";
import { deriveCardPlayback, isWatchable } from "@/lib/surface-state";
import { StateChip } from "@/components/state-panels";
import { ROUTES } from "@/lib/navigation";

/**
 * The content card (W904): one real control-plane session with its REAL
 * status, playback-rights state, renderer availability and stored-output
 * count — per the ux-architecture card contract ("sport, event status,
 * renderer, creator/rights state and availability without overwhelming").
 * Cards link straight into the watch page with the best available reality.
 */
export function SessionCard({
  card,
  capability,
}: {
  card: SessionCardLike;
  capability: CapabilityLike;
}) {
  const playback = deriveCardPlayback(card);
  const watchable = isWatchable(card);
  const renderers = (card.renders ?? []).map((render) => ({
    ...render,
    available:
      capability.renderers.find((entry) => entry.rendererId === render.rendererId)?.availability ===
      "available",
  }));

  return (
    <article className="session-card" data-session={card.sessionId}>
      <div className="session-card-head">
        <h3 className="session-card-title">{card.label}</h3>
        <StateChip state={playback.state}>{playback.state}</StateChip>
      </div>
      <p className="session-card-reason">{playback.reason}</p>
      <dl className="session-card-facts">
        <div className="fact">
          <dt>Session</dt>
          <dd>
            <code>{card.sessionId}</code>
          </dd>
        </div>
        <div className="fact">
          <dt>Event status</dt>
          <dd>{card.status}</dd>
        </div>
        <div className="fact">
          <dt>Stored outputs</dt>
          <dd>{card.outputCount === null ? "not revealed (rights)" : `${card.outputCount}`}</dd>
        </div>
        {card.story !== null && (
          <div className="fact">
            <dt>Source</dt>
            <dd>{card.story.source} · {card.story.storyKey} · {card.story.eventCount} events</dd>
          </div>
        )}
      </dl>
      {renderers.length > 0 && (
        <ul className="renderer-chips" aria-label="Rendered realities of this session">
          {renderers.map((render) => (
            <li
              key={render.renderId}
              className={`renderer-chip ${render.hasStoredOutputs ? "has-output" : "no-output"}`}
            >
              <span className="renderer-name">{render.rendererId}</span>
              <span className="renderer-note">
                {render.hasStoredOutputs ? "stored output" : "no stored output"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {card.renders === null && (
        <p className="renderer-chips-note">
          Renders are not shown for this session: its rights deny stored playback, and the control
          plane does not reveal render existence on the deny path.
        </p>
      )}
      {watchable ? (
        <Link className="button-primary card-action" href={`${ROUTES.watch}?session=${encodeURIComponent(card.sessionId)}`}>
          Watch
        </Link>
      ) : (
        <span className="button-ghost card-action" aria-disabled="true">
          Not watchable
        </span>
      )}
    </article>
  );
}
