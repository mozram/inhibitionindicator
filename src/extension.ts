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
import St from "gi://St";
import Gio from "gi://Gio";
import {
    Extension,
    gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
    addInhibitorChangeListener,
    cleanUp,
    getInhibitorAppId,
    getInhibitorIds,
    getInhibitorReason,
    inhibit,
    uninhibit,
} from "./lib.js";

class Indicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    protected _menuItems: PopupMenu.PopupMenuItem[] = [];
    protected _path: string;
    protected _icon: St.Icon | null;
    protected _iconYes: St.Icon["gicon"] | null;
    protected _iconNo: St.Icon["gicon"] | null;
    protected _iconUnknown: St.Icon["gicon"] | null;
    protected _manualInhibitSwitch: PopupMenu.PopupSwitchMenuItem;
    protected _inhibitorSection: PopupMenu.PopupMenuSection;
    // Make tsc stop complaining about PopupDummyMenu not having certain members
    declare menu: PopupMenu.PopupMenu<PopupMenu.PopupMenu.SignalMap>;
    protected _extension: InhibitionIndicatorExtension | null;

    protected _isInhibited: boolean = false;

    protected _handler_ids: number[] = [];

    constructor(extension: InhibitionIndicatorExtension) {
        super(0.0, _("Inhibition Indicator"));
        this._extension = extension;
        this._path = extension.path;
        this._icon = new St.Icon({ style_class: "system-status-icon" });
        this._iconYes = Gio.icon_new_for_string(
            this._path + "/assets/zzz-yes.svg",
        ) as unknown as St.Icon["gicon"];
        this._iconNo = Gio.icon_new_for_string(
            this._path + "/assets/zzz-no.svg",
        ) as unknown as St.Icon["gicon"];
        this._iconUnknown = Gio.icon_new_for_string(
            this._path + "/assets/zzz-unknown.svg",
        ) as unknown as St.Icon["gicon"];

        this._icon.gicon = this._iconUnknown;
        this.add_child(this._icon);

        this._manualInhibitSwitch = new PopupMenu.PopupSwitchMenuItem(
            _("Keep Awake"),
            extension.manualInhibitionEnabled,
        );
        this._manualInhibitSwitch.connect("toggled", (_item, enabled) => {
            extension.setManualInhibition(enabled);
        });
        this.menu.addMenuItem(this._manualInhibitSwitch);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._inhibitorSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._inhibitorSection);

        const handler_id = extension.settings?.connect(
            "changed::hide-indicator-when-not-inhibited",
            () => {
                this.updateStatus(this._isInhibited);
            },
        );
        if (handler_id) {
            this._handler_ids.push(handler_id);
        }
    }

    updateStatus(isInhibited: boolean) {
        const gicon = isInhibited ? this._iconNo : this._iconYes;
        if (this._icon && gicon) {
            this._icon.gicon = gicon;
        }

        if (
            !isInhibited &&
            this._extension
                ?.getSettings()
                ?.get_boolean("hide-indicator-when-not-inhibited") === true
        ) {
            this.visible = false;
        } else {
            this.visible = true;
        }

        this._isInhibited = isInhibited;
    }

    clearInhibitors() {
        this._inhibitorSection.removeAll();

        this._menuItems = [];
    }

    addInhibitor(inhibitor: string) {
        const item = new PopupMenu.PopupMenuItem(inhibitor);
        this._menuItems.push(item);
        this._inhibitorSection.addMenuItem(item);
    }

    setManualInhibitionState(enabled: boolean) {
        this._manualInhibitSwitch.setToggleState(enabled);
    }

    destroy() {
        for (const handle_id of this._handler_ids) {
            this._extension?.settings?.disconnect(handle_id);
        }
        this._handler_ids = [];
        this.clearInhibitors();
        this._icon?.destroy();
        this._icon = null;
        this._iconYes = null;
        this._iconNo = null;
        this._iconUnknown = null;
        super.destroy();
    }
}

export default class InhibitionIndicatorExtension extends Extension {
    protected _settings: Gio.Settings | null = null;
    protected _indicator: Indicator | null = null;
    protected _settingsHandlerIds: number[] = [];
    protected _refreshGeneration = 0;
    protected _enabled = false;
    protected _manualInhibitionRequested = false;
    protected _manualInhibitCookie: number | null = null;
    protected _manualInhibitQueue: Promise<void> = Promise.resolve();

    get settings() {
        return this._settings;
    }

    get manualInhibitionEnabled() {
        return this._manualInhibitCookie !== null;
    }

    enable() {
        this._enabled = true;
        this._settings = this.getSettings();

        const positioningSettings = [
            "enable-positioning",
            "position-box",
            "position-number",
        ];
        for (const setting of positioningSettings) {
            const handlerId = this.settings?.connect(
                `changed::${setting}`,
                () => this._handlePositioningChanged(),
            );
            if (handlerId) {
                this._settingsHandlerIds.push(handlerId);
            }
        }

        this.createIndicator();

        addInhibitorChangeListener(() => {
            this.updateInhibitors();
        });

        this.updateInhibitors();
    }

    _handlePositioningChanged() {
        this.destroyIndicator();
        this.createIndicator();
        this.updateInhibitors();
    }

    createIndicator() {
        if (!this._indicator) {
            this._indicator = new Indicator(this);

            // uuid: inhibitionindicator@monyxie.github.io
            if (this._settings?.get_boolean("enable-positioning")) {
                const boxMap = {
                    0: "left",
                    1: "center",
                    2: "right",
                };

                const positionNumber =
                    this._settings?.get_int("position-number");
                const boxNumber = this._settings?.get_int("position-box");
                const box =
                    boxNumber in boxMap
                        ? boxMap[boxNumber as 0 | 1 | 2]
                        : "right";
                Main.panel.addToStatusArea(
                    this.uuid,
                    this._indicator,
                    positionNumber,
                    box,
                );
            } else {
                Main.panel.addToStatusArea(this.uuid, this._indicator);
            }
        }
    }

    disable() {
        this._enabled = false;
        this._manualInhibitionRequested = false;
        this._refreshGeneration++;
        for (const handlerId of this._settingsHandlerIds) {
            this._settings?.disconnect(handlerId);
        }
        this._settingsHandlerIds = [];
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
        this._settings = null;
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

            const inhibited = objPaths.length > 0;
            this._indicator.updateStatus(inhibited);
            this._indicator.clearInhibitors();

            const inhibitors = await Promise.all(
                objPaths.map(async (objPath) => {
                    try {
                        const [appId, reason] = await Promise.all([
                            getInhibitorAppId(objPath),
                            getInhibitorReason(objPath),
                        ]);
                        return `${appId}: ${reason}`;
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

            for (const inhibitor of inhibitors) {
                if (inhibitor !== null) {
                    this._indicator.addInhibitor(inhibitor);
                }
            }
        } catch (e) {
            if (generation === this._refreshGeneration) {
                console.error(e);
            }
        }
    }
}
