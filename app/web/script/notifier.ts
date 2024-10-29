import yargs from "yargs"
import { markdownToBlocks } from "@tryfabric/mack"
import { hideBin } from "yargs/helpers"
import fs from "node:fs"
import { WebClient, type Block, type KnownBlock } from "@slack/web-api"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { generateMarkDown, getGitDiff, loadChangelogConfig, parseCommits } from "changelogen"

const options = yargs(hideBin(process.argv))
    .scriptName("ci-notifier")
    .option("token", {
        desc: "Slack bot token",
        demandOption: true,
        type: "string"
    })
    .option("channel", {
        desc: "The channel to send the notification to",
        demandOption: true,
        type: "string"
    })
    .option("directory", {
        alias: "d",
        desc: "The directory of the build assets",
        demandOption: true,
        type: "string"
    })
    .option("form", {
        desc: "The form data to be sent",
        type: "string"
    })
    .help("Send a notification to Slack with changelog and build artifacts")

async function run() {
    const argv = await options.parseAsync()

    const client = new WebClient(argv.token)

    const [files, blocks] = await Promise.all([getAllBuildArtifacts(argv.directory), getChangelog()])

    console.log(files, blocks)

    console.log("Posting message")

    await postMessage({
        files,
        channelId: argv.channel,
        client,
        blocks
    })
}
run()

async function postMessage({
    client,
    files,
    channelId,
    blocks
}: {
    client: WebClient
    files: string[]
    channelId: string
    blocks: (Block | KnownBlock)[]
}) {
    const { threadId } = await uploadFiles({ files, channelId, client })

    return await client.chat.update({
        channel: channelId,
        ts: threadId,
        blocks
    })
}

async function uploadFiles({ files, channelId, client }: { files: string[]; channelId: string; client: WebClient }) {
    const { files: uploadedFiles } = await client.filesUploadV2({
        channel_id: channelId,
        initial_comment: "Release notes",
        file_uploads: files.map(file => ({
            filename: path.basename(file),
            file: fs.createReadStream(file)
        }))
    })

    const firstFileId = uploadedFiles[0].files?.[0].id
    if (!firstFileId) {
        throw new Error("No file id found")
    }

    let threadId: string | undefined = undefined
    let MAX_RETRIES = 20

    // Do a polling to wait utils the thread id in 'shares' property is populated in the first file object
    // ref: https://github.com/slackapi/python-slack-sdk/issues/1329#issuecomment-1430589611
    while (MAX_RETRIES) {
        const { file } = await client.files.info({
            file: firstFileId
        })

        const shareProps = file?.shares?.private?.[channelId] || file?.shares?.public?.[channelId]
        if (shareProps?.[0].ts) {
            threadId = shareProps[0].ts
            break
        }
        MAX_RETRIES--
        await delay(1000)
    }

    if (!threadId) {
        throw new Error("Thread id not found from the file")
    }

    return { threadId, uploadFiles }
}

async function getAllBuildArtifacts(directory: string): Promise<string[]> {
    if (!path.isAbsolute(directory)) {
        directory = path.join(process.cwd(), directory)
    }

    if (!fs.existsSync(directory)) {
        throw new Error(`Directory ${directory} does not exist`)
    }

    let files = await fs.promises.readdir(directory)
    return (files = files.map(file => path.join(directory, file)))
}

async function getChangelog(): Promise<KnownBlock[]> {
    runCommand("git", ["show", "e882510"])
    runCommand("git", ["show", "7f390fa6ccd403b42eb7ab67288c3c700f558cc3"])

    const changelog = await generateChangelogMarkdown("e882510", "7f390fa6ccd403b42eb7ab67288c3c700f558cc3")
    console.log(`changelog\n${changelog}`)
    return await markdownToBlocks(changelog)
}

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function runCommand(command: string, options: string[]): string {
    const result = spawnSync(command, options, { shell: true })
    if (result.status !== 0 || result.stderr) {
        throw new Error(`Command: '${command} ${options}' failed with status\n ${result.status}\n${result.stderr.toString()}`)
    }
    return result.output.toString()
}

async function generateChangelogMarkdown(from: string, to: string) {
    const config = await loadChangelogConfig(process.cwd())
    const rawCommits = await getGitDiff(from, to)
    const commits = parseCommits(rawCommits, config)
        .map(c => ({ ...c, type: c.type.toLowerCase() /* #198 */ }))
        .filter(c => config.types[c.type] && !(c.type === "chore" && c.scope === "deps" && !c.isBreaking))

    const markdown = await generateMarkDown(commits, config)
    return markdown
}
