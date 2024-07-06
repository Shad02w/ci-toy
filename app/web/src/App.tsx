import { config } from "@feature/config"
import "./App.css"

const c: string = "123"
console.log(c)

const App = () => {
    return (
        <div class="content">
            <h1>Rsbuild with Solid</h1>
            <p>Start building amazing things with Rsbuild.</p>
            <p>server running in port: {config.port} </p>
        </div>
    )
}

export default App
