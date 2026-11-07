const myHeaders = new Headers();
myHeaders.append("Authorization", process.env.kei_api_key");
myHeaders.append("Content-Type", "application/json");

const raw = JSON.stringify({
   "model": "claude-haiku-5-5",
   "messages": [
      {
         "role": "user",
         "content": "What is the weather like in Boston today?"
      }
   ],
   "tools": [
      {
         "name": "get_current_weather",
         "description": "Get the current weather in a given location",
         "input_schema": {
            "type": "object",
            "properties": {
               "location": {
                  "type": "string",
                  "description": "The city and state, e.g. Boston, MA"
               }
            },
            "required": [
               "location"
            ]
         }
      }
   ],
   "thinkingFlag": true,
   "stream": false,
   "max_tokens": 4096
});

const requestOptions = {
   method: "POST",
   headers: myHeaders,
   body: raw,
   redirect: "follow"
};

fetch("https://api.kie.ai/claude/v1/messages", requestOptions)
   .then((response) => response.text())
   .then((result) => console.log(result))
   .catch((error) => console.error(error));
