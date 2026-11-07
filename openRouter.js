// Usage: node index.js "Why is the sky blue?"
// Setup: npm install undici

const { fetch, ProxyAgent } = require("undici");

const PROXY_URL = "http://127.0.0.1:10808";
const API_URL = "https://tokenharbor.ai/v1/chat/completions";
const MODEL = "claude-haiku-5.5";
const API_KEY = process.env.TOKENHARBOR_API_KEY;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

async function main() {
  const message = process.argv.slice(2).join(" ").trim();

  if (!message) {
    console.error(c.red('Please provide a message. Example: node index.js "Why is the sky blue?"'));
    process.exit(1);
  }

  if (!API_KEY) {
    console.error(c.red("Missing API key. Set the TOKENHARBOR_API_KEY environment variable."));
    process.exit(1);
  }

  console.log(c.dim("\nThinking...\n"));

  try {
    const res = await fetch(API_URL, {
      dispatcher: new ProxyAgent(PROXY_URL),
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: message }],
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error?.message || `Request failed (${res.status})`);
    }

    const reply = data.choices?.[0]?.message?.content ?? "(empty response)";

    // JSON.parse already turns "\n" into real line breaks, so just print it
    console.log(c.cyan(c.bold("You:")) + " " + message);
    console.log(c.dim("─".repeat(50)));
    console.log(c.bold("AI:\n"));
    console.log(reply.trim());
    console.log(c.dim("─".repeat(50)));
    console.log(c.dim(`model: ${data.model || MODEL}\n`));
  } catch (err) {
    console.error(c.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

main();