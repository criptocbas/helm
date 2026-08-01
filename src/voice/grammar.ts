/**
 * Lightweight voice command grammar for Helm.
 * No LLM — rule-based so it stays fast and offline.
 */

export type VoiceIntent =
  | { type: "spawn"; label?: string }
  | { type: "stop" }
  | { type: "stop_all" }
  | { type: "focus"; name: string }
  | { type: "tell"; name: string; message: string }
  | { type: "prompt"; text: string }
  | { type: "empty" };

function normalize(raw: string): string {
  return raw
    .trim()
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Strip filler openings: "hey helm", "ok", "please" */
function stripFillers(s: string): string {
  return s
    .replace(/^(hey\s+)?(helm|canvas|ok|okay|please)\s+/i, "")
    .replace(/^(um|uh|so)\s+/i, "")
    .trim();
}

/**
 * Parse a final transcript into a conductor intent.
 * Unknown / freeform speech becomes `prompt` for the focused agent.
 */
export function parseVoiceIntent(raw: string): VoiceIntent {
  const text = stripFillers(normalize(raw));
  if (!text) return { type: "empty" };

  // stop all
  if (
    /^(stop all|stop everything|halt all|cancel all)$/.test(text) ||
    /^stop all agents$/.test(text)
  ) {
    return { type: "stop_all" };
  }

  // stop (focused)
  if (/^(stop|halt|cancel)$/.test(text) || /^stop (him|her|it|them)$/.test(text)) {
    return { type: "stop" };
  }

  // spawn agent [as Name] / spawn Name / new agent [Name]
  {
    const m =
      text.match(
        /^(?:spawn|create|add|new)\s+(?:an?\s+)?(?:agent|worker)?\s*(?:named\s+|called\s+|as\s+)?(.+)?$/,
      ) || text.match(/^(?:spawn|create)\s+(.+)$/);
    if (
      /^(spawn|create|add|new)\b/.test(text) &&
      (/\bagent\b/.test(text) ||
        /^(spawn|create|add|new)\s+\w+/.test(text) ||
        text === "spawn" ||
        text === "new agent")
    ) {
      let label: string | undefined;
      const named = text.match(
        /(?:named|called|as)\s+([a-z0-9][a-z0-9 _-]{0,40})$/i,
      );
      if (named) label = titleCase(named[1]);
      else if (m && m[1] && !/^(an?|agent|worker)$/.test(m[1].trim())) {
        const rest = m[1]
          .replace(/^(an?\s+)?agent\s*/i, "")
          .replace(/^(named|called|as)\s+/i, "")
          .trim();
        if (rest && rest !== "agent") label = titleCase(rest);
      }
      return { type: "spawn", label };
    }
  }

  // focus / select / switch to Name
  {
    const m = text.match(
      /^(?:focus|select|switch to|go to|open)\s+(?:agent\s+)?(.+)$/,
    );
    if (m && m[1]) {
      return { type: "focus", name: m[1].trim() };
    }
  }

  // tell / ask / order Name to …
  // also: "tell the agent named Scout to …", "have Scout run tests"
  {
    const tellTo = text.match(
      /^(?:tell|ask|order|instruct)\s+(?:the\s+)?(?:agent\s+)?(?:named\s+|called\s+)?(.+?)\s+to\s+(.+)$/,
    );
    if (tellTo && tellTo[1] && tellTo[2]) {
      return {
        type: "tell",
        name: cleanAgentName(tellTo[1]),
        message: tellTo[2].trim(),
      };
    }
    // have/get NAME VERB …  (no "to")
    const have = text.match(
      /^(?:have|get)\s+(?:the\s+)?(?:agent\s+)?(?:named\s+|called\s+)?([a-z0-9][a-z0-9 _-]{0,40}?)\s+((?:run|do|fix|build|check|list|open|write|read|create|deploy|test|implement|refactor|search|find|start|stop)\b.+)$/,
    );
    if (have && have[1] && have[2]) {
      return {
        type: "tell",
        name: cleanAgentName(have[1]),
        message: have[2].trim(),
      };
    }
  }

  // "Agent 1: do something" / "Scout, run tests"
  {
    const m = text.match(/^([a-z0-9][a-z0-9 _-]{0,40})[,:]\s+(.+)$/);
    if (m && m[1] && m[2] && m[2].split(" ").length >= 2) {
      return {
        type: "tell",
        name: m[1].trim(),
        message: m[2].trim(),
      };
    }
  }

  return { type: "prompt", text: raw.trim() };
}

function cleanAgentName(s: string): string {
  return s
    .replace(/^(agent)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Human-readable summary of intent for HUD / toast. */
export function describeIntent(intent: VoiceIntent): string {
  switch (intent.type) {
    case "empty":
      return "No speech detected — hold longer or speak louder";
    case "spawn":
      return intent.label ? `Spawn “${intent.label}”` : "Spawn agent";
    case "stop":
      return "Stop focused agent";
    case "stop_all":
      return "Stop all agents";
    case "focus":
      return `Focus → ${intent.name}`;
    case "tell":
      return `Tell ${titleCase(intent.name)} → ${intent.message.slice(0, 72)}`;
    case "prompt":
      return `Prompt → ${intent.text.slice(0, 80)}`;
  }
}
