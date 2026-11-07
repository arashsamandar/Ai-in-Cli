import { fetch, Agent } from "undici";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";

const MODEL = "gemini-3.1-flash-lite";

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`;

const API_KEY = process.env.GEMINI_API_KEY || process.env.gemini_key;

// Abort only if no data arrives for this long (instead of a hard total timeout)
const IDLE_TIMEOUT_MS = 60000;

// Disable undici's default body/headers timeouts so long streams don't die
const dispatcher = new Agent({ bodyTimeout: 0, headersTimeout: 0 });

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

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
    console.error(c.red('Usage: node google.js "Your prompt here"'));
    process.exitCode = 1;
    return;
  }

  if (!API_KEY) {
    console.error(c.red("Missing API key. Set GEMINI_API_KEY first."));
    process.exitCode = 1;
    return;
  }

  // marked / marked-terminal are ESM, so load them dynamically from CommonJS
  

  const marked = new Marked();
  marked.use(
    markedTerminal({
      reflowText: true,
      width: Math.min(process.stdout.columns || 80, 100),
    })
  );

  const render = (text) =>
    marked.parse(text, { async: false }).trimEnd() + "\n\n";

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
      method: "POST",
      headers: {
        "x-goog-api-key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: message }],
          },
        ],
      }),
      signal: controller.signal,
      dispatcher,
    });

    if (!res.ok) {
      const errorText = await res.text();

      let errorMessage = errorText;

      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData?.error?.message || errorText;
      } catch {}

      throw new Error(`HTTP ${res.status}: ${errorMessage}`);
    }

    console.log("\n" + c.cyan(c.bold("You:")) + " " + message);
    console.log(c.dim("─".repeat(50)));
    console.log(c.bold("AI:\n"));

    const decoder = new TextDecoder();
    let buffer = "";

    function addText(text) {
      pending += text;
      printedText = true;

      const [done, rest] = splitCompleteBlocks(pending);
      if (done) process.stdout.write(render(done));
      pending = rest;
    }

    function processEvent(event) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

      if (!data || data === "[DONE]") return;

      let json;

      try {
        json = JSON.parse(data);
      } catch {
        return;
      }

      if (json.error) {
        throw new Error(json.error.message || "Gemini stream error");
      }

      const candidate = json.candidates?.[0];

      const parts = candidate?.content?.parts ?? [];

      for (const part of parts) {
        if (part.thought) continue; // skip thought summaries
        if (typeof part.text === "string") addText(part.text);
      }

      if (candidate?.finishReason === "SAFETY") {
        throw new Error("Gemini blocked the response for safety reasons.");
      }
    }

    for await (const chunk of res.body) {
      resetIdleTimer();
      buffer += decoder.decode(chunk, { stream: true });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";

      for (const event of events) {
        processEvent(event);
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      processEvent(buffer);
    }

    if (!printedText) {
      console.log("(No text response returned.)");
    }

    console.log("\n" + c.dim("─".repeat(50)));
    console.log(c.dim(`Model: ${MODEL}\n`));
  } catch (err) {
    console.error(c.red("\nRequest failed:"));
    console.error("Message:", err.message);

    if (err.cause) {
      console.error("Cause:", err.cause.message || err.cause);
      console.error("Cause code:", err.cause.code || "N/A");

      if (err.cause.cause) {
        console.error(
          "Nested cause:",
          err.cause.cause.message || err.cause.cause
        );
      }
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