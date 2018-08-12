import { Runtime, ExecutableCandidate } from "./runtime";
import * as pify from "pify";
import * as glob from "glob";

export class LuaRuntime extends Runtime {
    static readonly id = "lua";

    enumerateExecutables(workspaceRoot: string): Thenable<ExecutableCandidate[]> {
        let globOptions = { cwd: workspaceRoot };
        return Promise.all([
            <Thenable<string[]>>pify(glob)("**/*.lua", globOptions)
        ])
        .then(([luaList]) => {
            let list: ExecutableCandidate[] = [];
            luaList.forEach((lua) => {
                if (lua != null) {
                    list.push({ relPath: lua });
                }
            });
            return list;
        });
    }

    getExecutableFile(file: string): string {
        if (file.match(/\.lua$/)) {
            return file;
        }
    }

    getCatalogTopics(): CatalogTopicDescriptor[] {
        let info = <RubicCatalog.Runtime.Lua>this.info;
        let topics: CatalogTopicDescriptor[] = [];
        topics.push({
            localizedTitle: "Lua",
            color: "blue",
            localizedTooltip: (
                (info.version != null)
                ? `${Runtime.LOCALIZED_VERSION}: ${info.version}`
                : null
            )
        });
        return topics;
    }

    renderDetails(): string {
        let result: string[] = [];
        let info = <RubicCatalog.Runtime.Lua>this.info;
        result.push("## Lua");
        result.push(`* ${Runtime.LOCALIZED_VERSION} : \`${info.version}\``);
        return result.join("\n");
    }
}
Runtime.registerRuntime(LuaRuntime);
