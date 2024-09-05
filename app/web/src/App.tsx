import { config } from "@feature/config"
import "./App.css"
import { clearDelegatedEvents } from "solid-js/web"

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

console.log("p")
console.log("hi")
console.log("renato")
