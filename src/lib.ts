/*
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

"use strict";

import Gio from "gi://Gio";
import GLib from "gi://GLib";

type SessionManagerParameters = Parameters<Gio.DBusConnection["call"]>[4];
type SessionManagerReply = ReturnType<Gio.DBusConnection["call_finish"]>;

let bus: Gio.DBusConnection | null;

function getBus(): Gio.DBusConnection {
    if (!bus) {
        // Get the session D-Bus
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
    }
    return bus;
}

function callSessionManager(
    objectPath: string,
    interfaceName: string,
    methodName: string,
    parameters: SessionManagerParameters = null,
): Promise<SessionManagerReply> {
    return new Promise((resolve, reject) => {
        try {
            getBus().call(
                "org.gnome.SessionManager",
                objectPath,
                interfaceName,
                methodName,
                parameters,
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (connection, result) => {
                    try {
                        if (!connection) {
                            throw new Error("D-Bus connection unavailable");
                        }
                        resolve(connection.call_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                },
            );
        } catch (error) {
            reject(error);
        }
    });
}

export function inhibit(appId: string, reason: string): Promise<number> {
    const flags = 4 | 8;
    return callSessionManager(
        "/org/gnome/SessionManager",
        "org.gnome.SessionManager",
        "Inhibit",
        new GLib.Variant(
            "(susu)",
            [appId, 0, reason, flags],
        ) as unknown as SessionManagerParameters,
    ).then((data) => data.get_child_value(0).get_uint32());
}

export function uninhibit(cookie: number): Promise<void> {
    return callSessionManager(
        "/org/gnome/SessionManager",
        "org.gnome.SessionManager",
        "Uninhibit",
        new GLib.Variant("(u)", [cookie]) as unknown as SessionManagerParameters,
    ).then(() => undefined);
}

export function getInhibitorAppId(objectPath: string): Promise<string> {
    return callSessionManager(
        objectPath,
        "org.gnome.SessionManager.Inhibitor",
        "GetAppId",
    ).then((data) => data.get_child_value(0).get_string()[0]);
}

export function getInhibitorReason(objectPath: string): Promise<string> {
    return callSessionManager(
        objectPath,
        "org.gnome.SessionManager.Inhibitor",
        "GetReason",
    ).then((data) => data.get_child_value(0).get_string()[0]);
}

export function getInhibitorFlags(objectPath: string): Promise<number> {
    return callSessionManager(
        objectPath,
        "org.gnome.SessionManager.Inhibitor",
        "GetFlags",
    ).then((data) => data.get_child_value(0).get_uint32());
}

export function getInhibitorIds(): Promise<string[]> {
    return callSessionManager(
        "/org/gnome/SessionManager",
        "org.gnome.SessionManager",
        "GetInhibitors",
    ).then((data) => data.get_child_value(0).get_objv());
}

let addedSubId: number | null = null;
let removedSubId: number | null = null;
const listeners: Array<() => void> = [];

export function addInhibitorChangeListener(callback: { (): void; (): void }) {
    listeners.push(callback);
    if (!addedSubId) {
        addedSubId = getBus().signal_subscribe(
            "org.gnome.SessionManager",
            "org.gnome.SessionManager",
            "InhibitorAdded",
            "/org/gnome/SessionManager",
            null,
            null,
            () => {
                for (const cb of listeners) {
                    cb();
                }
            },
        );
    }
    if (!removedSubId) {
        removedSubId = getBus().signal_subscribe(
            "org.gnome.SessionManager",
            "org.gnome.SessionManager",
            "InhibitorRemoved",
            "/org/gnome/SessionManager",
            null,
            null,
            () => {
                for (const cb of listeners) {
                    cb();
                }
            },
        );
    }
}

function clearInhibitorChangeListener() {
    listeners.splice(0);
    if (addedSubId) {
        getBus().signal_unsubscribe(addedSubId);
        addedSubId = null;
    }
    if (removedSubId) {
        getBus().signal_unsubscribe(removedSubId);
        removedSubId = null;
    }
}

export function cleanUp() {
    clearInhibitorChangeListener();
    bus = null;
}
