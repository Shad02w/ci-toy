import { spawnSync } from "child_process"
import type { RsbuildPlugin } from "@rsbuild/core"

export const pluginTizen = (): RsbuildPlugin => ({
    name: "plugin-tizen",

    setup(api) {
        // Hook into the afterBuild lifecycle
        api.onAfterBuild(async () => {
            console.log("Running Tizen build and package commands...")

            // Run tizen build-web command
            console.log("Running tizen build-web...")
            const buildResult = spawnSync("tizen", ["build-web", "--", "./dist"], {
                cwd: process.cwd(),
                stdio: "inherit",
                shell: true
            })

            if (buildResult.status !== 0) {
                console.error("Tizen build command failed")
                return
            }

            // Run tizen package command
            console.log("Running tizen package...")

            const packageResult = spawnSync("tizen", ["package", "-s", "game", "-t", "wgt", "-o", "out", "--", "./dist/.buildResult"], {
                cwd: process.cwd(),
                stdio: "inherit",
                shell: true
            })

            if (packageResult.status !== 0) {
                console.error("Tizen package command failed")
                return
            }

            console.log("Tizen build and package completed successfully!")
        })
    }
})
