import { RubicProcess, RubicProgress, RubicProgressOptions, RubicDebugRequestArguments, RubicDebugHook, RubicConfirmOptions, RubicMessageItem } from "./rubicProcess";
import {
    ExtensionContext, OutputChannel, ProgressLocation, ProgressOptions,
    commands, window, workspace
} from "vscode";
import * as ipc from "node-ipc";
import * as path from "path";
import * as nls from "vscode-nls";
import * as fse from "fs-extra";
import { Sketch } from "../sketch";
import * as CJSON from "comment-json";
import { CatalogData } from "../catalog/catalogData";
import { RubicDebugHelper } from "../debug/rubicDebugHelper";

const localize = nls.loadMessageBundle(__filename);

const LOCALIZED_YES = localize("yes", "Yes");
const LOCALIZED_NO = localize("no", "No");

const CMD_START_DEBUG_SESSION = "extension.rubic.startDebugSession";

interface DebugRequest {
    request_id: string;
    resolve: Function;
    reject: Function;
}

interface DebugRequestSet {
    [request_id: string]: DebugRequest;
}

interface DebugProcessReference {
    debugger_id: string;
    socket?: any;
    startResolve: () => void;
    startReject: (reason: any) => void;
    stopResolve?: () => void;
    stopReject?: (reason: any) => void;
    debugRequests: DebugRequestSet;
}

interface DebugProcessReferenceSet {
    [debugger_id: string]: DebugProcessReference;
}

interface ProgressContext {
    progress_id: string;
    thenable: Thenable<void>;
    reporter: (value: { message?: string }) => void;
    completer: () => void;
}

interface ProgressContextSet {
    [progress_id: string]: ProgressContext;
}

/**
 * Extension host process
 */
export class RubicHostProcess extends RubicProcess {
    /* Properties */
    get isHost() { return true; }
    get isDebug() { return false; }
    get workspaceRoot() { return workspace.rootPath; }
    get extensionRoot() { return this._context.extensionPath; }
    get sketch() { return this._sketch; }
    get catalogData() { return this._catalogData; }
    get debugConfiguration() {
        throw new Error("debugConfiguration is not available in host process");
    }

    /* UI functions */
    readonly showInformationMessage = function (this: RubicHostProcess, message: string, ...args: any[]): any {
        return window.showInformationMessage(message, ...args);
    };
    readonly showWarningMessage = function (this: RubicHostProcess, message: string, ...args: any[]): any {
        return window.showWarningMessage(message, ...args);
    };
    readonly showErrorMessage = function (this: RubicHostProcess, message: string, ...args): any {
        return window.showErrorMessage(message, ...args);
    };
    readonly showInformationConfirm = function (this: RubicHostProcess, message: string, options?: RubicConfirmOptions): Thenable<boolean> {
        return this._showConfirm("Information", message, options);
    };
    readonly showWarningConfirm = function (this: RubicHostProcess, message: string, options?: RubicConfirmOptions): Thenable<boolean> {
        return this._showConfirm("Warning", message, options);
    };
    readonly showErrorConfirm = function (this: RubicHostProcess, message: string, options?: RubicConfirmOptions): Thenable<boolean> {
        return this._showConfirm("Error", message, options);
    };
    private _showConfirm(level: string, message: string, options: RubicConfirmOptions): Thenable<boolean> {
        let items: RubicMessageItem[] = [{
            title: LOCALIZED_YES
        },{
            title: LOCALIZED_NO,
            isCloseAffordance: true
        }];
        return this[`show${level}Message`](message, options, ...items)
        .then((item) => {
            return item === items[0];
        });
    }
    readonly showQuickPick = function (this: RubicHostProcess, items: any, options?: any): any {
        return window.showQuickPick(items, options);
    };
    readonly showInputBox = function (this: RubicHostProcess, options?: any): any {
        return window.showInputBox(options);
    };
    readonly withProgress = function (this: RubicHostProcess, origOptions: RubicProgressOptions, task: (progress: RubicProgress<{ message?: string }>) => Thenable<void>): Thenable<void> {
        let options: ProgressOptions;
        if (typeof(origOptions.location) === "number") {
            options = <ProgressOptions>origOptions;
        } else {
            options = {
                location: origOptions.location.SourceControl ? ProgressLocation.SourceControl : ProgressLocation.Window,
                title: origOptions.title
            };
        }
        return window.withProgress(options, task);
    };
    private _withProgressStart(options: RubicProgressOptions): Thenable<string> {
        let progress_id = this.getUniqueId("p");
        let ctx = <ProgressContext>{ progress_id };
        ctx.thenable = this.withProgress(options, (progress) => {
            return new Promise<void>((resolve) => {
                ctx.reporter = (value) => progress.report(value);
                ctx.completer = resolve;
                this._progressContexts[progress_id] = ctx;
            });
        });
        return Promise.resolve(progress_id);
    }
    private _withProgressReport(progress_id: string, message: string): Thenable<void> {
        let ctx = this._progressContexts[progress_id];
        if (ctx == null) {
            return Promise.reject(new Error(
                `unknown progress context id: ${progress_id}`
            ));
        }
        ctx.reporter({ message });
        return Promise.resolve();
    }
    private _withProgressEnd(progress_id: string): Thenable<void> {
        let ctx = this._progressContexts[progress_id];
        if (ctx == null) {
            return Promise.reject(new Error(
                `unknown progress context id: ${progress_id}`
            ));
        }
        delete this._progressContexts[progress_id];
        ctx.completer();
        return Promise.resolve(ctx.thenable);
    }
    readonly printOutput = function (this: RubicHostProcess, text: string, preserveFocus?: boolean): Thenable<void> {
        if (this._outputChannel == null) {
            this._outputChannel = window.createOutputChannel("Rubic");
            this._context.subscriptions.push(this._outputChannel);
        }
        this._outputChannel.append(text);
        this._outputChannel.show(preserveFocus);
        return Promise.resolve();
    };
    readonly clearOutput = function (this: RubicHostProcess): Promise<void> {
        if (this._outputChannel != null) {
            this._outputChannel.clear();
        }
        return Promise.resolve();
    };

    /* Debug process management */
    readonly registerDebugHook = function(this: RubicHostProcess, listener: RubicDebugHook): void {
        if (this._debugHooks.indexOf(listener) < 0) {
            this._debugHooks.unshift(listener);
        }
    };
    readonly startDebugProcess = function(this: RubicHostProcess, configuration: any, clearConsole?: boolean): Thenable<string> {
        return this._serverSetup.then(() => {
            let host_id = ipc.config.id;
            let debugger_id = this.getUniqueId("d");
            let { workspaceRoot, extensionRoot } = this;
            let config: RubicDebugRequestArguments = Object.assign({
                type: "rubic",
                request: "attach",
                debugServer: process.env["DEBUG_SERVER_PORT"],
            }, configuration);
            config.__private = { host_id, debugger_id, workspaceRoot, extensionRoot };
            return new Promise<void>((startResolve, startReject) => {
                this._debuggers[debugger_id] = {
                    debugger_id, startResolve, startReject, debugRequests: {}
                };
                if (clearConsole) {
                    commands.executeCommand("workbench.debug.panel.action.clearReplAction");
                }
                commands.executeCommand("vscode.startDebug", config);
            })
            .then(() => {
                return debugger_id;
            });
        });
    };
    readonly sendDebugRequest = function(this: RubicHostProcess, debugger_id: string, request: string, args: any): Thenable<any> {
        return this._getDebuggerRef(debugger_id)
        .then((ref) => {
            return new Promise((resolve, reject) => {
                let request_id = this.getUniqueId("dr");
                ref.debugRequests[request_id] = { request_id, resolve, reject };
                ipc.server.emit(ref.socket, "app.debug-request", { request_id, request, args });
            });
        });
    };
    readonly stopDebugProcess = function(this: RubicHostProcess, debugger_id: string): Thenable<void> {
        return this._getDebuggerRef(debugger_id)
        .then((ref) => {
            return new Promise<void>((resolve, reject) => {
                ipc.server.emit(ref.socket, "app.terminate", {});
                ref.stopResolve = resolve;
                ref.stopReject = reject;
            });
        });
    };
    private _getDebuggerRef(debugger_id: string): Thenable<DebugProcessReference> {
        return this._serverSetup
        .then(() => {
            let ref = this._debuggers[debugger_id];
            if (ref == null) {
                throw new Error(
                    `Cannot find debugger process named ${debugger_id}`
                );
            }
            return ref;
        });
    }

    /* Settings */
    readonly getRubicSetting = function(this: RubicHostProcess, path: string): Thenable<any> {
        return Promise.resolve(workspace.getConfiguration().get<any>(`rubic.${path}`));
    };
    readonly getMementoValue = function<T>(this: RubicHostProcess, key: string, defaultValue?: T): Thenable<T> {
        return Promise.resolve()
        .then(() => this._context.globalState.get(key, defaultValue));
    };
    readonly setMementoValue = function<T>(this: RubicHostProcess, key: string, value: T): Thenable<void> {
        return this._context.globalState.update(key, value);
    };

    /* File access */
    readonly updateTextFile = function(this: RubicHostProcess, fullPath: string, updater: any, defaultOrRemover?: any, encoding?: string): Thenable<void> {
        let relPath = path.relative(fullPath, this.workspaceRoot);
        let editor = window.visibleTextEditors.find((editor) => {
            return path.relative(editor.document.fileName, fullPath) === "";
        });
        if (editor == null || !editor.document.isDirty) {
            if (typeof(updater) === "function") {
                return this.readTextFile(fullPath, false, defaultOrRemover, encoding)
                .then((oldValue) => {
                    return updater(oldValue);
                })
                .then((newValue) => {
                    fse.ensureDirSync(path.dirname(fullPath));
                    fse.writeFileSync(fullPath, newValue, encoding || "utf8");
                });
            } else {
                return this.readTextFile(fullPath, true, {}, encoding)
                .then((obj) => {
                    // Update values
                    Object.assign(obj, updater);

                    // Remove values
                    let remove = (target, src) => {
                        if ((target == null) || (src == null)) {
                            return;
                        }
                        for (let key in Object.keys(src)) {
                            let sub = src[key];
                            if (sub === true) {
                                delete target[key];
                            } else {
                                remove(target[key], sub);
                            }
                        }
                    };
                    remove(obj, defaultOrRemover);

                    fse.ensureDirSync(path.dirname(fullPath));
                    fse.writeFileSync(fullPath, CJSON.stringify(obj, null, 4));
                });
            }
        }
        return Promise.reject(new Error(
            localize("file-x-dirty", "File \"{0}\" is modified and not saved.", relPath)
        ));
    };

    /* Construct and dispose */

    /**
     * Construct abstraction layer for Extension Host process
     */
    constructor(private _context: ExtensionContext) {
        super();
        _context.subscriptions.push(
            commands.registerCommand(
                CMD_START_DEBUG_SESSION,
                (config) => this._startDebugSession(config)
            )
        );
        if (this.workspaceRoot != null) {
            this._sketch = new Sketch(this.workspaceRoot);
            _context.subscriptions.push(this._sketch);
            this._sketch.load(true)
            .catch((reason) => {
                this.showErrorMessage(
                    localize("sketch-load-failed-x", "Failed to load sketch: {0}", reason)
                );
            });
        }
        this._catalogData = new CatalogData();
        this._serverSetup = new Promise<void>((resolve) => {
            ipc.config.id = this.getUniqueId("h");
            ipc.serve(resolve);
            ipc.server.start();
        })
        .then(() => {
            ipc.server.on("app.initialized", (data, socket) => {
                let { debugger_id } = data;
                let ref = this._debuggers[debugger_id];
                if (ref == null) {
                    console.warn(`initialize event from unknown debugger id: ${debugger_id}`);
                    return;
                }
                ref.socket = socket;
                ref.startResolve();
            });
            ipc.server.on("app.host-request", (data, socket) => {
                let { type, id, } = data;
                Promise.resolve()
                .then(() => {
                    return this._processRequest(type, data.args || {});
                })
                .then((result: any) => {
                    ipc.server.emit(socket, "app.host-response", {
                        id, result: (result == null) ? null : result
                    });
                })
                .catch((reason: any) => {
                    ipc.server.emit(socket, "app.host-response", {
                        id, reason: (reason == null) ? null : reason
                    });
                });
            });
            ipc.server.on("app.debug-response", (data, socket) => {
                let { debugger_id, request_id } = data;
                let ref = this._debuggers[debugger_id];
                if (ref == null) {
                    console.warn(`debug-response from unknown debugger: ${debugger_id}`);
                    return;
                }
                let req = ref.debugRequests[request_id];
                if (req == null) {
                    console.warn(`debug-response with unknown request id: ${request_id}`);
                    return;
                }
                delete ref.debugRequests[request_id];
                if (data.reason !== undefined) {
                    req.reject(data.reason);
                } else {
                    req.resolve(data.result);
                }
            });
            ipc.server.on("socket.disconnected", (socket, destroyedSocketID) => {
                let ref: DebugProcessReference;
                for (let id of Object.keys(this._debuggers)) {
                    let refTemp = this._debuggers[id];
                    if (refTemp.socket === socket) {
                        ref = refTemp;
                        break;
                    }
                }
                if (ref != null) {
                    if (ref.stopResolve != null) {
                        ref.stopResolve();
                    }
                    delete this._debuggers[ref.debugger_id];
                }
            });
        });
    }

    readonly dispose = function(this: RubicHostProcess): Thenable<void> {
        return Promise.resolve();
    };

    /** Request handler */
    private _processRequest(type: string, args: any): Thenable<any> {
        switch (type) {
            case "getRubicSetting":
                return this.getRubicSetting(args.path);
            case "showInformationMessage":
            case "showWarningMessage":
            case "showErrorMessage":
                return this[type](args.message, args.options, ...args.items)
                .then((item) => {
                    return args.items.indexOf(item);
                });
            case "showInformationConfirm":
            case "showWarningConfirm":
            case "showErrorConfirm":
                return this[type](args.message, args.options);
            case "showQuickPick":
                return this.showQuickPick(args.items, args.options)
                .then((item) => {
                    return args.items.indexOf(item);
                });
            case "showInputBox":
                return this.showInputBox(args.options);
            case "withProgress.start":
                return this._withProgressStart(args.options);
            case "withProgress.report":
                return this._withProgressReport(args.progress_id, args.message);
            case "withProgress.end":
                return this._withProgressEnd(args.progress_id);
            case "printOutput":
                return this.printOutput(args.text, args.preserveFocus);
            case "clearOutput":
                return this.clearOutput();
        }
        return Promise.reject(
            new Error(`unsupported request type: ${type}`)
        );
    }

    /**
     * Start debug session
     * @param configuration Debug configuration
     */
    private _startDebugSession(configuration: any): void {
        this._debugHooks.reduce((promise, hook) => {
            return promise
            .then((continueDebug) => {
                return hook.onDebugStart(configuration);
            });
        }, Promise.resolve(true))
        .then((continueDebug) => {
            if (continueDebug) {
                return this.startDebugProcess(configuration);
            }
        }, (reason) => {
            this.showErrorMessage(
                `${localize("cannot-start-debug", "Cannot start debug session")}: ${reason}`
            );
        });
    }

    /** Sketch instance */
    private readonly _sketch: Sketch;

    /** CatalogData instance */
    private readonly _catalogData: CatalogData;

    /** Debug hooks */
    private readonly _debugHooks: RubicDebugHook[] = [];

    /** Server setup */
    private readonly _serverSetup: Promise<void>;

    /** Set of debug processes */
    private readonly _debuggers: DebugProcessReferenceSet = {};

    /** Set of progress contexts */
    private _progressContexts: ProgressContextSet = {};

    /** Output channel for Rubic */
    private _outputChannel: OutputChannel;
}