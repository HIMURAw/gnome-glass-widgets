import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {Glass} from './glass.js';
import {box, label} from './ui.js';

// The grid every widget sits on, in logical pixels. Sizes are in cells.
export const CELL = 158;
export const GAP = 16;
export const RADIUS = 22;
export const SIZES = {small: [1, 1], medium: [2, 1], large: [2, 2]};

export function pixelSize(size) {
    const [cols, rows] = SIZES[size];
    return [cols * CELL + (cols - 1) * GAP, rows * CELL + (rows - 1) * GAP];
}

// One widget on the desktop: a pane of glass with a body to fill. Subclasses build
// their content in the constructor and follow sources with watch(); everything they
// follow is let go when the widget goes.
export class Widget {
    constructor(ctx, size) {
        this.ctx = ctx;
        this.size = size;
        const [width, height] = pixelSize(size);
        this.width = width;
        this.height = height;
        this.actor = new Glass({radius: RADIUS, style_class: 'gwidgets-widget', reactive: true, width, height});
        this.body = box(true, `gwidgets-body gwidgets-${size}`, {x_expand: true, y_expand: true});
        this.actor.add_child(this.body);
        this._unsubscribe = [];
        this.actor.connect('destroy', () => {
            this.dead = true;
            this._unsubscribe.forEach(u => u());
            this._unsubscribe = [];
            this.destroy?.();
        });
    }

    watch(source, fn) {
        this._unsubscribe.push(source.subscribe(value => {
            if (!this.dead)
                fn(value);
        }));
    }

    // A small title row: an accent-coloured caption and an optional right side.
    header(text, accentClass = '', right = null) {
        const row = box(false, 'gwidgets-header');
        row.add_child(label(text, `gwidgets-caption ${accentClass}`, {x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        if (right)
            row.add_child(right);
        return row;
    }

    // Replaces the body's content.
    fill(...children) {
        this.body.destroy_all_children();
        children.filter(Boolean).forEach(c => this.body.add_child(c));
    }

    // A button inside a widget (glass widgets are otherwise only dragged and right-clicked).
    button(iconName, onClick, styleClass = 'gwidgets-round-button', size = 16) {
        const b = new St.Button({style_class: styleClass, can_focus: false,
            child: new St.Icon({icon_name: iconName, icon_size: size})});
        b.connect('clicked', () => onClick());
        return b;
    }
}
