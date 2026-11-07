import Groq from "groq-sdk";
import { fetch, Agent } from "undici";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";

// Initialize Marked with terminal renderer
const marked = new Marked();
marked.use(
  markedTerminal({
    reflowText: true,
    width: Math.min(process.stdout.columns || 80, 100),
  })
);

const MODEL = "openai/gpt-oss-120b"; // Or "llama-3.1-8b-instant"
const API_KEY = process.env.GROQ_API_KEY;

// Disable undici's default body/headers timeouts so long streams don't die
const dispatcher = new Agent({ bodyTimeout: 0, headersTimeout: 0 });

// Combine both: official groq-sdk powered by undici's fetch
const groq = new Groq({
  apiKey: API_KEY,
  fetch: (url, init) => fetch(url, { ...init, dispatcher }),
});

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
    console.error(c.red('Usage: node index.js "Your coding question here"'));
    process.exitCode = 1;
    return;
  }

  if (!API_KEY) {
    console.error(c.red("Missing API key. Set GROQ_API_KEY first."));
    process.exitCode = 1;
    return;
  }

  try {
    console.log("\n" + c.cyan(c.bold("You:")) + " " + message);
    console.log(c.dim("─".repeat(50)));
    console.log(c.bold("AI:\n"));

    const stream = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: message,
        },
      ],
      stream: true,
    });

    let fullResponse = "";
    let pending = "";

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (!content) continue;

      fullResponse += content;
      pending += content;

      const [done, rest] = splitCompleteBlocks(pending);
      if (done) process.stdout.write(render(done));
      pending = rest;
    }

    // Flush whatever is left when the stream ends
    if (pending.trim()) process.stdout.write(render(pending));

    if (!fullResponse) {
      console.log("(No text response returned.)");
    }

    console.log("\n" + c.dim("─".repeat(50)));
    console.log(c.dim(`Model: ${MODEL}\n`));
  } catch (err) {
    console.error(c.red("\nRequest failed:"));
    console.error("Message:", err.message);

    if (err.status) {
      console.error("HTTP Status:", err.status);
    }

    process.exitCode = 1;
  }
}

main();