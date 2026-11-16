"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hotKey_1 = require("./hotKey");
const local = {
    enable: true,
    keys: {
        'mod+f5': {
            type: hotKey_1.HOTKEY_PLAYER.toggle_play.type,
            name: hotKey_1.HOTKEY_PLAYER.toggle_play.name,
            action: hotKey_1.HOTKEY_PLAYER.toggle_play.action,
        },
        'mod+arrowleft': {
            type: hotKey_1.HOTKEY_PLAYER.prev.type,
            name: hotKey_1.HOTKEY_PLAYER.prev.name,
            action: hotKey_1.HOTKEY_PLAYER.prev.action,
        },
        'mod+arrowright': {
            type: hotKey_1.HOTKEY_PLAYER.next.type,
            name: hotKey_1.HOTKEY_PLAYER.next.name,
            action: hotKey_1.HOTKEY_PLAYER.next.action,
        },
        f1: {
            type: hotKey_1.HOTKEY_COMMON.focusSearchInput.type,
            name: hotKey_1.HOTKEY_COMMON.focusSearchInput.name,
            action: hotKey_1.HOTKEY_COMMON.focusSearchInput.action,
        },
    },
};
const global = {
    enable: false,
    keys: {
        // MediaPlayPause: {
        //   type: HOTKEY_PLAYER.toggle_play.type,
        //   name: '',
        //   action: HOTKEY_PLAYER.toggle_play.action,
        // },
        // MediaPreviousTrack: {
        //   type: HOTKEY_PLAYER.prev.type,
        //   name: '',
        //   action: HOTKEY_PLAYER.prev.action,
        // },
        // MediaNextTrack: {
        //   type: HOTKEY_PLAYER.next.type,
        //   name: '',
        //   action: HOTKEY_PLAYER.next.action,
        // },
        'mod+alt+f5': {
            type: hotKey_1.HOTKEY_PLAYER.toggle_play.type,
            name: hotKey_1.HOTKEY_PLAYER.toggle_play.name,
            action: hotKey_1.HOTKEY_PLAYER.toggle_play.action,
        },
        'mod+alt+arrowleft': {
            type: hotKey_1.HOTKEY_PLAYER.prev.type,
            name: hotKey_1.HOTKEY_PLAYER.prev.name,
            action: hotKey_1.HOTKEY_PLAYER.prev.action,
        },
        'mod+alt+arrowright': {
            type: hotKey_1.HOTKEY_PLAYER.next.type,
            name: hotKey_1.HOTKEY_PLAYER.next.name,
            action: hotKey_1.HOTKEY_PLAYER.next.action,
        },
        'mod+alt+arrowup': {
            type: hotKey_1.HOTKEY_PLAYER.volume_up.type,
            name: hotKey_1.HOTKEY_PLAYER.volume_up.name,
            action: hotKey_1.HOTKEY_PLAYER.volume_up.action,
        },
        'mod+alt+arrowdown': {
            type: hotKey_1.HOTKEY_PLAYER.volume_down.type,
            name: hotKey_1.HOTKEY_PLAYER.volume_down.name,
            action: hotKey_1.HOTKEY_PLAYER.volume_down.action,
        },
        'mod+alt+0': {
            type: hotKey_1.HOTKEY_DESKTOP_LYRIC.toggle_visible.type,
            name: hotKey_1.HOTKEY_DESKTOP_LYRIC.toggle_visible.name,
            action: hotKey_1.HOTKEY_DESKTOP_LYRIC.toggle_visible.action,
        },
        'mod+alt+-': {
            type: hotKey_1.HOTKEY_DESKTOP_LYRIC.toggle_lock.type,
            name: hotKey_1.HOTKEY_DESKTOP_LYRIC.toggle_lock.name,
            action: hotKey_1.HOTKEY_DESKTOP_LYRIC.toggle_lock.action,
        },
        'mod+alt+=': {
            type: hotKey_1.HOTKEY_DESKTOP_LYRIC.toggle_always_top.type,
            name: hotKey_1.HOTKEY_DESKTOP_LYRIC.toggle_always_top.name,
            action: hotKey_1.HOTKEY_DESKTOP_LYRIC.toggle_always_top.action,
        },
    },
};
exports.default = {
    local,
    global,
};
