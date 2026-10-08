import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Gallery, SIZE_TITLES} from './gallery.js';
import {setBlurEnabled} from './glass.js';
import {Sources} from './sources.js';
import {CELL, GAP, SIZES} from './widget.js';
import {widgetTypes} from './widgets/index.js';

const MARGIN = 28;
const PITCH = CELL + GAP;
const DIM_OPACITY = 165; // the content's; the glass stays whole so nothing behind shows through
const DESATURATE = 0.8;

// Desktop icons (gtk4-ding) draw in a real window kept at the bottom; its title starts
// with "@!x,y;" and carries B (bottom) among its flags. Widgets go just above it.
function isDesktopWindow(win) {
    if (!win)
        return false;
    if (win.get_window_type() === Meta.WindowType.DESKTOP)
        return true;
    return /^@!-?\d+,-?\d+;[A-Z]*B/.test(win.get_title() ?? '');
}

function newId() {
    return GLib.uuid_string_random().slice(0, 8);
}

// Desktop widgets in frosted glass, like the macOS desktop: they sit on the wallpaper
// below every window, step back (dimmed, greyed) while an app is in front, and are
// placed on a grid. Right-click a widget for its size; Edit Widgets shows the gallery
// and lets them be dragged around.
export default class GlassWidgetsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        // Editing is never where a session starts (it may be left on by a crash or a logout mid-edit).
        if (this._settings.get_boolean('editing'))
            this._settings.set_boolean('editing', false);
        setBlurEnabled(this._settings.get_boolean('blur'));
        this._types = new Map(widgetTypes().map(t => [t.type, t]));
        this._sources = new Sources(this._settings);
        this._activeFns = new Map();
        this._ctx = {
            sources: this._sources,
            settings: this._settings,
            active: true,
            connectActive: fn => {
                const id = newId();
                this._activeFns.set(id, fn);
                return id;
            },
            disconnectActive: id => this._activeFns.delete(id),
        };

        this._layer = new Clutter.Actor({name: 'glass-widgets-layer'});
        this._desaturate = new Clutter.DesaturateEffect({factor: 0});
        this._layer.add_effect_with_name('desaturate', this._desaturate);
        this._desaturate.enabled = false;
        global.window_group.add_child(this._layer);
        this._menuManager = new PopupMenu.PopupMenuManager(this._layer);

        this._entries = new Map();
        this._editing = false;
        // Before startup completes the work area is not known yet (the grid would be tiny).
        if (!Main.layoutManager._startingUp)
            this._build();

        this._signals = [
            [global.display, global.display.connect('restacked', () => this._restack())],
            [global.display, global.display.connect('notify::focus-window', () => this._syncActive())],
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._build())],
            [Main.layoutManager, Main.layoutManager.connect('startup-complete', () => this._build())],
            [this._settings, this._settings.connect('changed::layout', () => {
                if (!this._saving)
                    this._build();
            })],
            [this._settings, this._settings.connect('changed::blur', () => {
                setBlurEnabled(this._settings.get_boolean('blur'));
                this._build();
            })],
            [this._settings, this._settings.connect('changed::editing', () => {
                const editing = this._settings.get_boolean('editing');
                if (editing !== this._editing)
                    this._setEditing(editing);
            })],
            [this._settings, this._settings.connect('changed::dim', () => this._syncActive(true))],
        ];
        this._restack();
        this._syncActive(true);
    }

    disable() {
        this._setEditing(false);
        this._signals.forEach(([obj, id]) => obj.disconnect(id));
        this._signals = [];
        this._destroyWidgets();
        this._menuManager = null;
        this._layer.destroy();
        this._layer = null;
        this._sources.destroy();
        this._sources = null;
        this._activeFns.clear();
        this._ctx = null;
        this._settings = null;
        this._types = null;
    }

    // ---------- Layout ----------

    _grid() {
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        return {
            x: area.x + MARGIN,
            y: area.y + MARGIN,
            cols: Math.max(2, Math.floor((area.width - 2 * MARGIN + GAP) / PITCH)),
            rows: Math.max(2, Math.floor((area.height - 2 * MARGIN + GAP) / PITCH)),
        };
    }

    _load() {
        let specs = null;
        try {
            const text = this._settings.get_string('layout');
            specs = text ? JSON.parse(text) : null;
        } catch {
            specs = null;
        }
        if (!Array.isArray(specs))
            specs = this._defaultLayout();
        return specs.filter(s => this._types.has(s.type) && SIZES[s.size]);
    }

    // To begin with, on the right where desktop icons are not: the weather, today, a
    // clock and the music; Harvis's morning report next to them when Harvis is there.
    _defaultLayout() {
        const {cols} = this._grid();
        const specs = [
            {type: 'weather', size: 'medium', col: cols - 2, row: 0},
            {type: 'calendar', size: 'small', col: cols - 2, row: 1},
            {type: 'clock', size: 'small', col: cols - 1, row: 1},
            {type: 'music', size: 'medium', col: cols - 2, row: 2},
        ];
        if (this._sources.harvis.available)
            specs.push({type: 'morning', size: 'large', col: cols - 4, row: 0});
        return specs.map(s => ({id: newId(), ...s}));
    }

    _save() {
        const specs = [...this._entries.values()].map(e => e.spec);
        this._saving = true;
        this._settings.set_string('layout', JSON.stringify(specs));
        this._saving = false;
    }

    _cells(spec) {
        const [w, h] = SIZES[spec.size];
        const cells = [];
        for (let c = 0; c < w; c++) {
            for (let r = 0; r < h; r++)
                cells.push(`${spec.col + c},${spec.row + r}`);
        }
        return cells;
    }

    _fits(spec, grid, exceptId) {
        const [w, h] = SIZES[spec.size];
        if (spec.col < 0 || spec.row < 0 || spec.col + w > grid.cols || spec.row + h > grid.rows)
            return false;
        const taken = new Set();
        for (const e of this._entries.values()) {
            if (e.spec.id !== exceptId)
                this._cells(e.spec).forEach(c => taken.add(c));
        }
        return !this._cells(spec).some(c => taken.has(c));
    }

    // The free place nearest to the wanted one (or null when the grid is full).
    _nearestFree(spec, grid, exceptId) {
        let best = null;
        for (let row = 0; row < grid.rows; row++) {
            for (let col = 0; col < grid.cols; col++) {
                const candidate = {...spec, col, row};
                if (!this._fits(candidate, grid, exceptId))
                    continue;
                const d = (col - spec.col) ** 2 + (row - spec.row) ** 2;
                if (!best || d < best.d)
                    best = {col, row, d};
            }
        }
        return best;
    }

    _position(spec, grid = this._grid()) {
        return [grid.x + spec.col * PITCH, grid.y + spec.row * PITCH];
    }

    _destroyWidgets() {
        for (const e of this._entries.values()) {
            e.menu?.destroy();
            e.slot.destroy();
        }
        this._entries.clear();
    }

    _build() {
        this._destroyWidgets();
        const grid = this._grid();
        for (const spec of this._load()) {
            spec.id ??= newId();
            if (!this._fits(spec, grid, spec.id)) {
                const free = this._nearestFree(spec, grid, spec.id);
                if (!free)
                    continue;
                Object.assign(spec, {col: free.col, row: free.row});
            }
            this._add(spec);
        }
        if (!this._settings.get_string('layout'))
            this._save();
    }

    // ---------- One widget ----------

    _add(spec) {
        const type = this._types.get(spec.type);
        let widget;
        try {
            widget = new type.make(this._ctx, spec.size);
        } catch (e) {
            console.error(`Glass Widgets: could not make the ${spec.type} widget`, e);
            return null;
        }
        // The slot holds the glass and, while editing, the remove badge that sits over its corner.
        const slot = new St.Widget({name: `glass-widget-${spec.type}`, reactive: true});
        slot.add_child(widget.actor);
        const badge = new St.Button({style_class: 'gwidgets-remove', can_focus: true, visible: this._editing,
            child: new St.Icon({icon_name: 'list-remove-symbolic', icon_size: 12})});
        badge.accessible_name = _('Remove Widget');
        badge.set_position(-9, -9);
        badge.connect('clicked', () => this._remove(spec.id));
        slot.add_child(badge);
        slot.set_position(...this._position(spec));
        this._layer.add_child(slot);

        const entry = {spec, widget, slot, badge};
        entry.menu = this._makeMenu(entry);
        slot.connect('captured-event', (_a, event) => this._onEvent(entry, event));
        this._entries.set(spec.id, entry);
        if (this._editing)
            widget.actor.add_style_class_name('gwidgets-editing');
        if (this._dimmed)
            widget.body.opacity = DIM_OPACITY;
        return entry;
    }

    _remove(id) {
        const e = this._entries.get(id);
        if (!e)
            return;
        this._entries.delete(id);
        e.menu?.destroy();
        e.slot.set_pivot_point(0.5, 0.5);
        e.slot.ease({scale_x: 0.6, scale_y: 0.6, opacity: 0, duration: 160, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => e.slot.destroy()});
        this._save();
    }

    _resize(entry, size) {
        if (entry.spec.size === size)
            return;
        const grid = this._grid();
        const spec = {...entry.spec, size};
        if (!this._fits(spec, grid, spec.id)) {
            const free = this._nearestFree(spec, grid, spec.id);
            if (!free) {
                Main.notify(_('No room for a bigger widget'));
                return;
            }
            Object.assign(spec, {col: free.col, row: free.row});
        }
        this._entries.delete(spec.id);
        entry.menu?.destroy();
        entry.slot.destroy();
        this._add(spec);
        this._save();
    }

    _addNew(typeName, size) {
        const grid = this._grid();
        // From the right, as the defaults are, so new ones gather where the others are.
        const spec = {id: newId(), type: typeName, size, col: grid.cols - SIZES[size][0], row: 0};
        const free = this._nearestFree(spec, grid, null);
        if (!free) {
            Main.notify(_('The desktop is full'), _('Remove a widget to make room.'));
            return;
        }
        Object.assign(spec, {col: free.col, row: free.row});
        const entry = this._add(spec);
        if (!entry)
            return;
        entry.slot.set_pivot_point(0.5, 0.5);
        entry.slot.set_scale(0.85, 0.85);
        entry.slot.opacity = 0;
        entry.slot.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        this._save();
    }

    _makeMenu(entry) {
        const type = this._types.get(entry.spec.type);
        const menu = new PopupMenu.PopupMenu(entry.widget.actor, 0.5, St.Side.TOP);
        menu.actor.add_style_class_name('gwidgets-menu');
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        this._menuManager.addMenu(menu);
        if (type.sizes.length > 1) {
            for (const size of type.sizes) {
                const item = new PopupMenu.PopupMenuItem(SIZE_TITLES()[size]);
                item.setOrnament(size === entry.spec.size ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
                item.connect('activate', () => this._resize(entry, size));
                menu.addMenuItem(item);
            }
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }
        if (entry.spec.type === 'weather' || type.harvis) {
            menu.addAction(_('Refresh'), () => (type.harvis ? this._sources.harvis : this._sources.weather).refresh());
        }
        menu.addAction(this._editing ? _('Done Editing') : _('Edit Widgets…'), () => this._setEditing(!this._editing));
        menu.addAction(_('Remove Widget'), () => this._remove(entry.spec.id));
        return menu;
    }

    // ---------- Pointer: the menu, and dragging while editing ----------

    _onEvent(entry, event) {
        const type = event.type();
        const press = type === Clutter.EventType.BUTTON_PRESS;
        if (press && event.get_button() === Clutter.BUTTON_SECONDARY) {
            if (this._drag)
                return Clutter.EVENT_STOP;
            entry.menu.toggle();
            return Clutter.EVENT_STOP;
        }
        if (!this._editing)
            return Clutter.EVENT_PROPAGATE;
        // While editing, widgets are dragged, not used; only the remove badge works.
        const source = global.stage.get_event_actor(event);
        if (!this._drag && source && (source === entry.badge || entry.badge.contains(source)))
            return Clutter.EVENT_PROPAGATE;
        if (press && event.get_button() === Clutter.BUTTON_PRIMARY) {
            const [x, y] = event.get_coords();
            this._drag = {entry, dx: x - entry.slot.x, dy: y - entry.slot.y};
            this._grab = global.stage.grab(entry.slot);
            this._layer.set_child_above_sibling(entry.slot, null);
            entry.widget.actor.add_style_class_name('gwidgets-dragging');
            this._showGhost(entry.spec);
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.MOTION && this._drag?.entry === entry) {
            const [x, y] = event.get_coords();
            entry.slot.set_position(Math.round(x - this._drag.dx), Math.round(y - this._drag.dy));
            entry.widget.actor.syncBackdrop();
            this._showGhost(this._target(entry));
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE && this._drag?.entry === entry) {
            this._endDrag();
            return Clutter.EVENT_STOP;
        }
        return press || type === Clutter.EventType.BUTTON_RELEASE ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }

    // Where the dragged widget would land: the nearest free cells to where it is.
    _target(entry) {
        const grid = this._grid();
        const col = Math.round((entry.slot.x - grid.x) / PITCH);
        const row = Math.round((entry.slot.y - grid.y) / PITCH);
        const spec = {...entry.spec, col, row};
        if (this._fits(spec, grid, spec.id))
            return spec;
        const free = this._nearestFree(spec, grid, spec.id);
        return free ? {...spec, col: free.col, row: free.row} : entry.spec;
    }

    _showGhost(spec) {
        if (!this._ghost) {
            this._ghost = new St.Widget({style_class: 'gwidgets-ghost'});
            this._layer.insert_child_at_index(this._ghost, this._scrim ? 1 : 0);
        }
        const [w, h] = SIZES[spec.size];
        this._ghost.set_size(w * CELL + (w - 1) * GAP, h * CELL + (h - 1) * GAP);
        this._ghost.set_position(...this._position(spec));
    }

    _endDrag() {
        const {entry} = this._drag;
        this._drag = null;
        this._grab?.dismiss();
        this._grab = null;
        this._ghost?.destroy();
        this._ghost = null;
        entry.widget.actor.remove_style_class_name('gwidgets-dragging');
        const target = this._target(entry);
        Object.assign(entry.spec, {col: target.col, row: target.row});
        const [x, y] = this._position(entry.spec);
        entry.slot.ease({x, y, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => entry.widget.actor.syncBackdrop()});
        const sync = () => entry.widget.actor.syncBackdrop();
        entry.slot.get_transition('x')?.connect('new-frame', sync);
        entry.slot.get_transition('y')?.connect('new-frame', sync);
        this._save();
    }

    // ---------- Editing ----------

    _setEditing(editing) {
        if (editing === this._editing)
            return;
        this._editing = editing;
        if (this._drag)
            this._endDrag();
        if (editing) {
            // Above the windows while editing, on a dimmed desktop.
            this._scrim = new St.Widget({style_class: 'gwidgets-scrim', reactive: true,
                width: global.stage.width, height: global.stage.height, opacity: 0});
            this._scrim.connect('button-press-event', () => {
                this._setEditing(false);
                return Clutter.EVENT_STOP;
            });
            this._layer.insert_child_at_index(this._scrim, 0);
            this._scrim.ease({opacity: 255, duration: 200});
            const types = [...this._types.values()].filter(t => !t.harvis || this._sources.harvis.available);
            this._gallery = new Gallery(types, {
                onAdd: (type, size) => this._addNew(type, size),
                onDone: () => this._setEditing(false),
            });
        } else {
            this._gallery?.destroy();
            this._gallery = null;
            const scrim = this._scrim;
            this._scrim = null;
            scrim?.ease({opacity: 0, duration: 150, onStopped: () => scrim.destroy()});
        }
        for (const e of this._entries.values()) {
            e.badge.visible = editing;
            if (editing)
                e.widget.actor.add_style_class_name('gwidgets-editing');
            else
                e.widget.actor.remove_style_class_name('gwidgets-editing');
            // The menu's last items read differently while editing.
            e.menu?.destroy();
            e.menu = this._makeMenu(e);
        }
        if (this._settings.get_boolean('editing') !== editing)
            this._settings.set_boolean('editing', editing);
        this._restack();
        this._syncActive();
    }

    // ---------- Stacking and stepping back ----------

    _restack() {
        if (!this._layer)
            return;
        const group = global.window_group;
        if (this._editing) {
            group.set_child_above_sibling(this._layer, null);
            return;
        }
        let below = Main.layoutManager._backgroundGroup;
        for (const actor of global.get_window_actors()) {
            if (isDesktopWindow(actor.meta_window))
                below = actor;
        }
        if (below?.get_parent() === group && this._layer.get_previous_sibling() !== below)
            group.set_child_above_sibling(this._layer, below);
    }

    // Full colour while the desktop is in front; dimmed and greyed while an app is.
    _syncActive(force = false) {
        const win = global.display.focus_window;
        const active = this._editing || !win || isDesktopWindow(win) || win.minimized;
        if (active === this._ctx.active && !force)
            return;
        this._ctx.active = active;
        for (const fn of [...this._activeFns.values()])
            fn(active);
        const dim = !active && this._settings.get_boolean('dim');
        this._dimmed = dim;
        for (const e of this._entries.values())
            e.widget.body.ease({opacity: dim ? DIM_OPACITY : 255, duration: 280, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._desaturate.enabled = true;
        this._layer.ease_property('@effects.desaturate.factor', dim ? DESATURATE : 0, {
            duration: 280,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                if (this._desaturate && !dim)
                    this._desaturate.enabled = false;
            },
        });
    }
}
