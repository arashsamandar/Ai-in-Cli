# Welcome To Ai In Cli ( Bash or Gitbash in Windows or Linux ).

> download the repository and run `npm install` to get the required packages

> put your api keys in your `~/.bashrc file` . the app reads them by `process.env.api_key`

### Example of bash scripts

```bash
export gemini_yourKey="your gemini api"
export openRouter_yourKey="open router api"
export GROQ_API_yourKey="groq api"

# your functions to run them directly with one command

grok(){
  node /c/Users/arash/Projects/Programmer-Codes/Ai-Cli/Groq/index.js "$1"
}

claude(){
  node /c/Users/arash/Projects/Programmer-Codes/Ai-Cli/openRouter.js "$1"
}

gemini(){
  node /c/Users/arash/Projects/Programmer-Codes/Ai-Cli/gemini.js "$1"
}
```

> then just use `gemini "hello gemini how to use git remove cached` in your terminal .

__Good Luck__
__Arash Salamander__
