'use strict';

import { spawn } from "child_process";
import { EventEmitter } from "events";
import * as stream from "stream";

export interface BoardCandidate {
    /** Board class name */
    boardClass: string;
    /** name of the board */
    name: string;
    /** path of the board */
    path: string;
    /** Vendor ID */
    vendorId?: number;
    /** Product ID */
    productId?: number;
}

export interface BoardInformation {
    /** ID of the board */
    boardId: string;
    /** Path of the board */
    path: string;
    /** ID of the firmware */
    firmwareId: string;
    /** Serial number */
    serialNumber?: string;
}

export interface BoardStdio {
    /** stdin (PC -> board) */
    stdin?: stream.Writable;
    /** stdout (board -> PC) */
    stdout: stream.Readable;
    /** stderr (board -> PC) */
    stderr?: stream.Readable;
}

export interface BoardClass {
    /** Enumerate boards */
    list: () => Promise<BoardCandidate[]>;
    /** Constructor */
    new (path: string): RubicBoard;
}

export class RubicBoard extends EventEmitter {
    protected constructor() {
        super();
    }

    /** Get board IDs */
    static getIdList(): string[] {
        throw Error("Not implemented");
    }

    /** Enumerate boards */
    static list(): Promise<BoardCandidate[]> {
        return Promise.reject(Error("Not implemented"));
    }

    /** Connect to board */
    connect(): Promise<void> {
        return Promise.reject(Error("Not implemented"));
    }

    /** Disconnect from board */
    disconnect(): Promise<void> {
        return Promise.reject(Error("Not implemented"));
    }

    /** Get board information */
    getInfo(): Promise<BoardInformation> {
        return Promise.reject(Error("Not implemented"));
    }

    /** Write file */
    writeFile(filename: string, data: Buffer): Promise<void> {
        return Promise.reject(Error("Not implemented"));
    }

    /** Read file */
    readFile(filename: string): Promise<Buffer> {
        return Promise.reject(Error("Not supported"));
    }

    /** Enumerate files */
    enumerateFiles(dir: string): Promise<string[]> {
        return Promise.reject(Error("Not supported"));
    }

    /** Program firmware */
    programFirmware(): Promise<void> {
        return Promise.reject(Error("Not supported"));
    }

    /** Format internal storage */
    formatStorage(): Promise<void> {
        return Promise.reject(Error("Not supported"));
    }

    /** Run sketch */
    runSketch(filename: string): Promise<void> {
        return Promise.reject(Error("Not supported"));
    }

    /** Get stdio streams */
    getStdio(): Promise<BoardStdio> {
        return Promise.reject(Error("Not supported"));
    }

    /** Get sketch running state */
    isSketchRunning(): Promise<boolean> {
        return Promise.reject(Error("Not supported"));
    }

    /** Stops sketch */
    stopSketch(): Promise<void> {
        return Promise.reject(Error("Not supported"));
    }

    /** Get debugging stream */
    getDebugStream(): Promise<stream.Duplex> {
        return Promise.reject(Error("Not supported"));
    }

    /** Dispose this instance */
    public dispose() {
    }
}
