import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as rimraf from "rimraf";
import * as path from "path";
import { findBoard } from "../board-finder";
import * as delay from "delay";
require("promise.prototype.finally").shim();

suite("GR-CITRUS online tests with mruby", function() {
    let workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    suiteSetup(function(done) {
        // Cleanup files
        rimraf(path.join(workspaceRoot, "*.mrb"), done);
    });
    suiteSetup(function(done) {
        // Search test port
        findBoard(0x2a50, 0x0277, (err, boardPath) => {
            if (err) {
                return done(err);
            }
            let rubicJson = path.join(workspaceRoot, ".vscode", "rubic.json");
            let obj = JSON.parse(fs.readFileSync(rubicJson, "utf8"));
            obj.hardware.boardPath = boardPath;
            fs.writeFileSync(rubicJson, JSON.stringify(obj, null, 4), "utf8");
            done();
        });
    });
    test("Launch program", function(done) {
        this.timeout(0);
        let disposable: vscode.Disposable;
        vscode.debug.startDebugging(
            vscode.workspace.workspaceFolders[0], "Launch on target board"
        ).then((value) => {
            if (!value) {
                return done(new Error("Failed to launch"));
            }
            assert(vscode.debug.activeDebugSession != null);
            let timeouts = 10;
            let timer = setInterval(() => {
                if (--timeouts <= 0) {
                    clearInterval(timer);
                    return done(new Error("Timed out"));
                }
                if (vscode.debug.activeDebugSession == null) {
                    clearInterval(timer);
                    done();
                }
            }, 1000);
        });
    });
});
