// Usage: node openrouter.js "Hello"
// Setup: npm install undici marked marked-terminal

import { fetch, Agent, ProxyAgent } from "undici";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";

// ─── Config ──────────────────────────────────────────────
const USE_PROXY = false; // true = route through PROXY_URL, false = plain undici fetch
const PROXY_URL = "http://127.0.0.1:10808";
// ─────────────────────────────────────────────────────────

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-haiku-5.5";
const API_KEY = process.env.OPENROUTER_API_KEY || process.env.openRouter_key;

// Abort only if no data arrives for this long (instead of a hard total timeout)
const IDLE_TIMEOUT_MS = 60000;

// Disable undici's default body/headers timeouts so long streams don't die
const timeouts = { bodyTimeout: 0, headersTimeout: 0 };

const dispatcher = USE_PROXY
  ? new ProxyAgent({ uri: PROXY_URL, ...timeouts })
  : new Agent(timeouts);

const marked = new Marked();
marked.use(
  markedTerminal({
    reflowText: true,
    width: Math.min(process.stdout.columns || 80, 100),
  })
);

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

const render = (text) =>
  marked.parse(text, { async: false }).trimEnd() + "\n\n";

// Split off finished markdown blocks (ended by a blank line, outside code fences)
function splitCompleteBlocks(buf) {
  let inFence = false;
  let lastCut = 0;
  let pos = 0;
  for (const line of buf.split("\n")) {
    const end = pos + line.length + 1;
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence && line.trim() === "" && end <= buf.length) lastCut = end;
    pos = end;
  }
  return [buf.slice(0, lastCut), buf.slice(lastCut)];
}

async function main() {
  const message = process.argv.slice(2).join(" ").trim();

  if (!message) {
    console.error(
      c.red('Please provide a message. Example: node openrouter.js "Hello"')
    );
    process.exitCode = 1;
    return;
  }

  if (!API_KEY) {
    console.error(
      c.red("Missing API key. Set the OPENROUTER_API_KEY environment variable.")
    );
    process.exitCode = 1;
    return;
  }

  const controller = new AbortController();
  let idleTimer;
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => controller.abort(new Error("Stream timed out (no data received).")),
      IDLE_TIMEOUT_MS
    );
  };

  let pending = "";
  let printedText = false;

  try {
    resetIdleTimer();

    const res = await fetch(API_URL, {
      dispatcher,
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [{ role: "user", content: message }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(
        errData?.error?.message || `Request failed (${res.status})`
      );
    }

    console.log("\n" + c.cyan(c.bold("You:")) + " " + message);
    console.log(c.dim("─".repeat(50)));
    console.log(c.bold("AI:\n"));

    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;

    function addText(text) {
      pending += text;
      printedText = true;

      const [complete, rest] = splitCompleteBlocks(pending);
      if (complete) process.stdout.write(render(complete));
      pending = rest;
    }

    // Returns true when the stream is finished
    function processLine(line) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return false; // skip comments/keep-alives

      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return true;

      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        return false; // ignore partial/invalid JSON lines
      }

      if (json.error) {
        throw new Error(json.error.message || "Stream error");
      }

      const choice = json.choices?.[0];
      const text = choice?.delta?.content;
      if (typeof text === "string" && text) addText(text);

      if (choice?.finish_reason === "error") {
        throw new Error("The model reported an error mid-stream.");
      }

      return false;
    }

    for await (const chunk of res.body) {
      resetIdleTimer();
      buffer += decoder.decode(chunk, { stream: true });

      // Server-sent events: one event per line, starting with "data: "
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep any incomplete line for the next chunk

      for (const line of lines) {
        if (processLine(line)) {
          done = true;
          break;
        }
      }
      if (done) break;
    }

    // Handle a final line that had no trailing newline
    if (!done) {
      buffer += decoder.decode();
      if (buffer.trim()) processLine(buffer);
    }

    if (!printedText) {
      console.log("(No text response returned.)");
    }

    console.log("\n" + c.dim("─".repeat(50)));
    console.log(c.dim(`Model: ${MODEL}\n`));
  } catch (err) {
    console.error(c.red("\nRequest failed:"));
    console.error(c.red(`Message: ${err.message}`));

    if (err.cause) {
      console.error("Cause:", err.cause.message || err.cause);
      console.error("Cause code:", err.cause.code || "N/A");
    }

    process.exitCode = 1;
  } finally {
    clearTimeout(idleTimer);

    // Print any partial text that was received before an error or the end
    if (pending.trim()) {
      try {
        process.stdout.write(render(pending));
      } catch {
        process.stdout.write(pending + "\n");
      }
    }
  }
}

main();