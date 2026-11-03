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

import GObject from "gi://GObject";
import {
    Extension,
    gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";
import {
    addInhibitorChangeListener,
    cleanUp,
    getInhibitorAppId,
    getInhibitorFlags,
    getInhibitorIds,
    getInhibitorReason,
    inhibit,
    uninhibit,
} from "./lib.js";

type InhibitorInfo = {
    appId: string;
    reason: string;
};

class QuickSettingsIndicator extends QuickSettings.SystemIndicator {
    static {
        GObject.registerClass(this);
    }

    protected _statusIcon: ReturnType<
        QuickSettings.SystemIndicator["_addIndicator"]
    >;
    protected _toggle: QuickSettings.QuickMenuToggle;
    protected _inhibitors: InhibitorInfo[] = [];

    constructor(extension: InhibitionIndicatorExtension) {
        super();

        this._statusIcon = this._addIndicator();
        this._statusIcon.icon_name = "system-suspend-symbolic";
        this._statusIcon.visible = false;

        this._toggle = new QuickSettings.QuickMenuToggle({
            title: _("Keep Awake"),
            subtitle: _("No apps are blocking sleep"),
            icon_name: "system-suspend-symbolic",
            toggle_mode: true,
            checked: extension.manualInhibitionEnabled,
        });
        this._toggle.menu.setHeader(
            "system-suspend-symbolic",
            _("Sleep inhibitors"),
            _("No apps are blocking sleep"),
        );
        this._toggle.connect("clicked", () => {
            extension.setManualInhibition(this._toggle.checked);
        });
        this.quickSettingsItems.push(this._toggle);
    }

    updateInhibitors(inhibitors: InhibitorInfo[], manualEnabled: boolean) {
        this._inhibitors = inhibitors;
        this._statusIcon.visible = manualEnabled || inhibitors.length > 0;
        this._toggle.checked = manualEnabled;
        this._toggle.subtitle = manualEnabled
            ? _("Manual keep-awake is on")
            : this._getSummary(inhibitors.length);

        this._toggle.menu.setHeader(
            "system-suspend-symbolic",
            _("Sleep inhibitors"),
            this._getSummary(inhibitors.length),
        );
        this._toggle.menu.removeAll();

        if (inhibitors.length === 0) {
            this._toggle.menu.addMenuItem(
                new PopupMenu.PopupMenuItem(
                    _("No apps are blocking sleep"),
                    { reactive: false, can_focus: false },
                ),
            );
            return;
        }

        for (const inhibitor of inhibitors) {
            const label = inhibitor.reason
                ? `${inhibitor.appId}: ${inhibitor.reason}`
                : inhibitor.appId;
            this._toggle.menu.addMenuItem(
                new PopupMenu.PopupMenuItem(label, {
                    reactive: false,
                    can_focus: false,
                }),
            );
        }
    }

    setManualInhibitionState(enabled: boolean) {
        this._statusIcon.visible = enabled || this._inhibitors.length > 0;
        this._toggle.checked = enabled;
        this._toggle.subtitle = enabled
            ? _("Manual keep-awake is on")
            : this._getSummary(this._inhibitors.length);
    }

    destroy() {
        this._toggle.menu.destroy();
        this._toggle.destroy();
        this.quickSettingsItems = [];
        super.destroy();
    }

    protected _getSummary(count: number) {
        if (count === 0) {
            return _("No apps are blocking sleep");
        }
        if (count === 1) {
            return _("1 app is blocking sleep");
        }
        return _("%d apps are blocking sleep").replace("%d", String(count));
    }
}

export default class InhibitionIndicatorExtension extends Extension {
    protected _indicator: QuickSettingsIndicator | null = null;
    protected _refreshGeneration = 0;
    protected _enabled = false;
    protected _manualInhibitionRequested = false;
    protected _manualInhibitCookie: number | null = null;
    protected _manualInhibitQueue: Promise<void> = Promise.resolve();

    get manualInhibitionEnabled() {
        return this._manualInhibitCookie !== null;
    }

    enable() {
        this._enabled = true;
        this.createIndicator();

        addInhibitorChangeListener(() => {
            this.updateInhibitors();
        });

        this.updateInhibitors();
    }

    createIndicator() {
        if (!this._indicator) {
            this._indicator = new QuickSettingsIndicator(this);
            const quickSettings = Main.panel.statusArea.quickSettings;
            quickSettings.addExternalIndicator(
                this._indicator as unknown as Parameters<
                    typeof quickSettings.addExternalIndicator
                >[0],
            );
        }
    }

    disable() {
        this._enabled = false;
        this._manualInhibitionRequested = false;
        this._refreshGeneration++;
        this._manualInhibitQueue = this._manualInhibitQueue
            .then(async () => {
                const cookie = this._manualInhibitCookie;
                if (cookie !== null) {
                    await uninhibit(cookie);
                    if (this._manualInhibitCookie === cookie) {
                        this._manualInhibitCookie = null;
                    }
                }
            })
            .catch((error) => {
                console.error("Failed to release manual inhibitor:", error);
            });
        cleanUp();
        this.destroyIndicator();
    }

    destroyIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    setManualInhibition(enabled: boolean) {
        if (!this._enabled) {
            return;
        }

        this._manualInhibitionRequested = enabled;
        this._manualInhibitQueue = this._manualInhibitQueue
            .then(async () => {
                if (!this._enabled) {
                    return;
                }

                if (this._manualInhibitionRequested) {
                    if (this._manualInhibitCookie === null) {
                        const cookie = await inhibit(
                            this.uuid,
                            _("Manual keep-awake request"),
                        );
                        this._manualInhibitCookie = cookie;

                        if (
                            !this._enabled ||
                            !this._manualInhibitionRequested
                        ) {
                            await uninhibit(cookie);
                            if (this._manualInhibitCookie === cookie) {
                                this._manualInhibitCookie = null;
                            }
                        }
                    }
                } else if (this._manualInhibitCookie !== null) {
                    const cookie = this._manualInhibitCookie;
                    await uninhibit(cookie);
                    if (this._manualInhibitCookie === cookie) {
                        this._manualInhibitCookie = null;
                    }
                }
            })
            .then(() => {
                this._indicator?.setManualInhibitionState(
                    this._manualInhibitCookie !== null,
                );
            })
            .catch((error) => {
                console.error("Failed to update manual inhibitor:", error);
                this._indicator?.setManualInhibitionState(
                    this._manualInhibitCookie !== null,
                );
            });
    }

    async updateInhibitors() {
        const generation = ++this._refreshGeneration;
        try {
            const objPaths = await getInhibitorIds();

            if (generation !== this._refreshGeneration || !this._indicator) {
                return;
            }

            const inhibitors = await Promise.all(
                objPaths.map(async (objPath) => {
                    try {
                        const [appId, reason, flags] = await Promise.all([
                            getInhibitorAppId(objPath),
                            getInhibitorReason(objPath),
                            getInhibitorFlags(objPath),
                        ]);
                        if (
                            appId === this.uuid ||
                            (flags & (4 | 8)) === 0
                        ) {
                            return null;
                        }
                        return {
                            appId: appId || _("Unknown application"),
                            reason,
                        };
                    } catch (error) {
                        console.error(
                            `Failed to read inhibitor at ${objPath}:`,
                            error,
                        );
                        return null;
                    }
                }),
            );

            if (generation !== this._refreshGeneration || !this._indicator) {
                return;
            }

            this._indicator.updateInhibitors(
                inhibitors.filter(
                    (inhibitor): inhibitor is InhibitorInfo =>
                        inhibitor !== null,
                ),
                this.manualInhibitionEnabled,
            );
        } catch (e) {
            if (generation === this._refreshGeneration) {
                console.error(e);
            }
        }
    }
}
