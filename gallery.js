import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Glass} from './glass.js';
import {box, label, paragraph} from './ui.js';

const CARD = 156;
const SIZE_NAMES = () => ({small: _('S'), medium: _('M'), large: _('L')});
const SIZE_TITLES = () => ({small: _('Small'), medium: _('Medium'), large: _('Large')});

// The sheet at the bottom of the screen while editing: every kind of widget with its
// sizes; a size adds that widget to the first free place. Done ends editing. It starts
// as a slim bar so the widgets low on the screen can still be reached; Add Widgets opens
// the cards, and it folds again when a widget is dragged.
export class Gallery {
    constructor(types, {onAdd, onDone}) {
        const monitor = Main.layoutManager.primaryMonitor;
        const width = Math.min(1180, monitor.width - 80);
        this.actor = new Glass({radius: 26, style_class: 'gwidgets-gallery', reactive: true, width});
        const content = box(true, 'gwidgets-gallery-content', {x_expand: true});
        this.actor.add_child(content);

        const top = box(false, 'gwidgets-gallery-top');
        const titles = box(true, '', {x_expand: true});
        titles.add_child(label(_('Widgets'), 'gwidgets-gallery-title'));
        titles.add_child(label(_('Drag widgets to move them. Right-click one for its size.'), 'gwidgets-dim'));
        top.add_child(titles);
        this._toggle = new St.Button({style_class: 'gwidgets-add-toggle', can_focus: true,
            y_align: Clutter.ActorAlign.CENTER});
        this._toggle.connect('clicked', () => this._setOpen(!this._open));
        top.add_child(this._toggle);
        const done = new St.Button({label: _('Done'), style_class: 'gwidgets-done', can_focus: true,
            y_align: Clutter.ActorAlign.CENTER});
        done.connect('clicked', () => onDone());
        top.add_child(done);
        content.add_child(top);

        // All of them at a glance, in rows (a sideways scroll is hard to reach with a wheel).
        const columns = Math.max(3, Math.min(types.length, Math.floor((width - 44 + 10) / (CARD + 10))));
        const grid = new St.Widget({layout_manager: new Clutter.GridLayout({column_spacing: 10, row_spacing: 10,
            column_homogeneous: true}), x_expand: true});
        types.forEach((type, i) => {
            const card = box(true, 'gwidgets-gallery-card', {x_expand: true});
            const head = box(false, 'gwidgets-gallery-card-head');
            head.add_child(new St.Icon({icon_name: type.icon, icon_size: 22, style_class: 'gwidgets-gallery-icon'}));
            head.add_child(label(type.name, 'gwidgets-gallery-name', {y_align: Clutter.ActorAlign.CENTER}));
            card.add_child(head);
            card.add_child(paragraph(type.description, 'gwidgets-dim gwidgets-tiny', 60, {y_expand: true}));
            const sizes = box(false, 'gwidgets-gallery-sizes');
            for (const size of type.sizes) {
                const chip = new St.Button({label: SIZE_NAMES()[size], style_class: 'gwidgets-size-chip', can_focus: true});
                chip.accessible_name = `${type.name} ${SIZE_TITLES()[size]}`;
                chip.connect('clicked', () => onAdd(type.type, size));
                sizes.add_child(chip);
            }
            card.add_child(sizes);
            grid.layout_manager.attach(card, i % columns, Math.floor(i / columns), 1, 1);
        });
        content.add_child(grid);
        this._grid = grid;
        this._setOpen(false);

        Main.layoutManager.addTopChrome(this.actor);
        this.actor.opacity = 0;
        this.actor.connect('notify::height', () => this._place());
        this._place();
        this.actor.ease({opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _setOpen(open) {
        this._open = open;
        this._grid.visible = open;
        this._toggle.label = open ? _('Hide Widgets') : _('Add Widgets');
    }

    collapse() {
        if (this._open)
            this._setOpen(false);
    }

    _place() {
        const monitor = Main.layoutManager.primaryMonitor;
        this.actor.set_position(monitor.x + Math.round((monitor.width - this.actor.width) / 2),
            // At the very bottom, over the dock (not needed while editing): the widgets keep the rest.
            monitor.y + monitor.height - this.actor.height - 12);
        this.actor.syncBackdrop();
    }

    contains(x, y) {
        const [ax, ay] = this.actor.get_transformed_position();
        return x >= ax && y >= ay && x <= ax + this.actor.width && y <= ay + this.actor.height;
    }

    destroy() {
        const actor = this.actor;
        actor.ease({opacity: 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                Main.layoutManager.removeChrome(actor);
                actor.destroy();
            }});
    }
}

export {SIZE_TITLES};
