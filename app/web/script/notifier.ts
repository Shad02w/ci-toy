import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import fs from "node:fs"
import { WebClient, type Block, type KnownBlock } from "@slack/web-api"
import path from "node:path"

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

    let directory = argv.directory
    if (!path.isAbsolute(directory)) {
        directory = path.join(process.cwd(), directory)
    }

    if (!fs.existsSync(directory)) {
        throw new Error(`Directory ${directory} does not exist`)
    }

    const files = await getBuildFiles(argv.directory)

    postMessage({
        files,
        channelId: argv.channel,
        client,
        blocks: [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: "CI Notifier"
                }
            }
        ]
    })
}

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

    return await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadId,
        blocks
    })
}

async function uploadFiles({ files, channelId, client }: { files: string[]; channelId: string; client: WebClient }) {
    const { files: uploadedFiles } = await client.filesUploadV2({
        channels: channelId,
        file_uploads: files.map(file => ({
            file: fs.createReadStream(file)
        }))
    })

    const firstFileId = uploadedFiles[0].files?.[0].id
    if (!firstFileId) {
        throw new Error("No file id found")
    }

    let threadId: string | undefined = undefined
    let MAX_RETRIES = 20

    // Do a polling to wait utils the 'shares' property is populated in the file object
    while (MAX_RETRIES) {
        const { file } = await client.files.info({
            file: firstFileId
        })

        const shareProps = file?.shares?.private?.[channelId] || file?.shares?.public?.[channelId]
        if (shareProps) {
            console.log(shareProps)
            threadId = shareProps[0].ts
            break
        }
        MAX_RETRIES--
    }

    if (!threadId) {
        throw new Error("Thread id not found from the file")
    }

    return { threadId, uploadFiles }
}

async function getBuildFiles(directory: string): Promise<string[]> {
    return await fs.promises.readdir(directory)
}

run()
