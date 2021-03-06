import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as rimraf from "rimraf";
import * as path from "path";
import { findBoard } from "../board-finder";
// import * as delay from "delay";
require("promise.prototype.finally").shim();

suite("GR-CITRUS online tests with mruby", function() {
    let workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    function setBoardPath(value: string): void {
        let rubicJson = path.join(workspaceRoot, ".vscode", "rubic.json");
        let obj = JSON.parse(fs.readFileSync(rubicJson, "utf8"));
        obj.hardware.boardPath = value;
        fs.writeFileSync(rubicJson, JSON.stringify(obj, null, 4), "utf8");
    }
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
            setBoardPath(boardPath);
            done();
        });
    });
    suiteTeardown(function() {
        setBoardPath("");
    });
    test("Launch program", function(done) {
        this.timeout(60000);
        vscode.debug.startDebugging(
            vscode.workspace.workspaceFolders[0], "Launch"
        ).then((value) => {
            if (!value) {
                throw new Error("Failed to launch");
            }
            assert(vscode.debug.activeDebugSession != null);
        })
        .then(() => {
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
        }, (reason) => done(reason));
    });
});
