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
    .option("tag", {
        desc: "glob pattern of last tag, will be use to determine the starting point of the changelog",
        type: "string",
        demandOption: true
    })
    .option("header", {
        desc: "The title of the release",
        type: "string",
        demandOption: true
    })
    .help("Send a notification to Slack with changelog and build artifacts")

async function run() {
    const argv = await options.parseAsync()

    const client = new WebClient(argv.token)

    const [files, blocks] = await Promise.all([getFiles(argv.directory), getChangelog(argv.tag)])

    await postMessage({
        client,
        header: argv.header,
        files,
        blocks,
        channelId: argv.channel
    })
}

run()

async function postMessage({
    client,
    files,
    channelId,
    blocks,
    header
}: {
    client: WebClient
    files: string[]
    channelId: string
    blocks: (Block | KnownBlock)[]
    header: string
}) {
    const { threadId } = await uploadFiles({ files, channelId, client, title: header })

    return await client.chat.update({
        channel: channelId,
        ts: threadId,
        blocks: addHeader(header, blocks)
    })
}

async function uploadFiles({ files, channelId, client, title }: { title: string; files: string[]; channelId: string; client: WebClient }) {
    const { files: uploadedFiles } = await client.filesUploadV2({
        channel_id: channelId,
        initial_comment: title,
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

    // Do a polling to wait util the thread id in 'shares' property is populated in the first file object
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

async function getFiles(directory: string): Promise<string[]> {
    if (!path.isAbsolute(directory)) {
        directory = path.join(process.cwd(), directory)
    }

    if (!fs.existsSync(directory)) {
        throw new Error(`Directory ${directory} does not exist`)
    }

    let files = await fs.promises.readdir(directory)
    return (files = files.map(file => path.join(directory, file)))
}

async function getChangelog(tagPattern: string): Promise<KnownBlock[]> {
    const lastTag = getLastGitTag(tagPattern)
    const from = lastTag ? getGitCommitHash(lastTag) : getGitFirstCommitHash()

    const changelog = await generateChangelogMarkdown(from)
    return await markdownToBlocks(changelog)
}

async function generateChangelogMarkdown(from: string, to?: string) {
    const config = await loadChangelogConfig(process.cwd())
    const rawCommits = await getGitDiff(from, to)
    // copy from changelogen source code
    const commits = parseCommits(rawCommits, config)
        .map(c => ({ ...c, type: c.type.toLowerCase() }))
        .filter(c => config.types[c.type] && !(c.type === "chore" && c.scope === "deps" && !c.isBreaking))

    return await generateMarkDown(commits, config)
}

function addHeader(header: string, blocks: (Block | KnownBlock)[]) {
    return [
        {
            type: "header",
            text: {
                type: "plain_text",
                text: header,
                emoji: true
            }
        },
        {
            type: "divider"
        },
        ...blocks
    ]
}

function getLastGitTag(pattern?: string): string | null {
    let tag: string | null = null
    try {
        tag = getGitTag(pattern)
    } catch (e) {
        // no-np
    }

    if (!tag) {
        try {
            console.log(`No tag found by pattern: ${pattern}, fallback to get the latest tag`)
            tag = getGitTag()
        } catch (e) {
            // no-np
        }
    }

    return tag
}

/**
 * Get the last tag of the current branch by pattern
 * @param pattern - the pattern of the tag
 * @returns the latest tag
 *
 * @throws
 * Thrown when the tag is not found
 */
function getGitTag(pattern?: string) {
    return runCommand("git", ["--no-pager", "describe", pattern ? `--match="${pattern}"` : undefined, "--abbrev=0", "--tags"])
}

/**
 * Get the commit hash of the a tag
 * @param tag - the tag
 * @returns the commit hash
 *
 * @throws
 * Thrown when the tag is not found
 */
function getGitCommitHash(tag: string) {
    return runCommand("git", ["rev-parse", tag])
}

/**
 * Get the commit hash of the first commit of the current branch
 * @returns the commit hash
 */
function getGitFirstCommitHash() {
    return runCommand("git", ["rev-list", "--max-parents=0", "HEAD"])
}

/**
 * Utils
 */

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function runCommand(command: string, options: (string | null | undefined)[]): string {
    const result = spawnSync(
        command,
        options.filter(_ => _ !== null && _ !== undefined),
        { shell: true }
    )
    if (result.status !== 0 || result.stderr.byteLength > 0) {
        throw new Error(`Command: '${command} ${options.join(" ")}' failed with status: ${result.status}\n${result.stderr.toString()}`)
    }
    return result.stdout.toString().trim()
}
