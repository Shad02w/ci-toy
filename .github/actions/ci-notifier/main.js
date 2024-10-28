import { core } from "@action/core"

const input = core.getInput("file_path")
console.log(`Input file path: ${input}`)
console.log("CI notifier action started")
