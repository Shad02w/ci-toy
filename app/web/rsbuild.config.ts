import { defineConfig } from "@rsbuild/core"
import { pluginBabel } from "@rsbuild/plugin-babel"
import { pluginSolid } from "@rsbuild/plugin-solid"
import { pluginTypeCheck } from "@rsbuild/plugin-type-check"

export default defineConfig({
    dev: {
        progressBar: false
    },
    plugins: [
        pluginBabel({
            include: /\.(?:jsx|tsx)$/
        }),
        pluginSolid(),
        pluginTypeCheck()
    ]
})
