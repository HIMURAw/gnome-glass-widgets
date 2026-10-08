import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Widget} from '../widget.js';
import {box, drawingArea, label, layered, paintBar, paintRing, placeholder} from '../ui.js';

// Green while there is plenty, amber when low, red when nearly empty.
function levelColor(d) {
    if (d.charging || d.level > 0.2)
        return [0.2, 0.84, 0.35];
    return d.level > 0.1 ? [1.0, 0.75, 0.0] : [1.0, 0.27, 0.23];
}

// The laptop and every Bluetooth device that reports a battery (headphones, mouse,
// keyboard, phone), the way UPower sees them.
export class BatteriesWidget extends Widget {
    constructor(ctx, size) {
        super(ctx, size);
        this.watch(ctx.sources.batteries, devices => this._render(devices ?? []));
    }

    _name(d) {
        return d.laptop ? _('This computer') : d.name;
    }

    _render(devices) {
        if (!devices.length) {
            this.fill(placeholder(_('No batteries')));
            return;
        }
        if (this.size === 'small') {
            const grid = new St.Widget({layout_manager: new Clutter.GridLayout({column_homogeneous: true, row_homogeneous: true,
                column_spacing: 10, row_spacing: 10}), x_expand: true, y_expand: true});
            devices.slice(0, 4).forEach((d, i) => {
                const one = devices.length === 1;
                const side = one ? 84 : 56;
                const ring = layered(drawingArea(side, side, (cr, w, h, s) => paintRing(cr, w, h, s, d.level, levelColor(d), 5),
                    {x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}),
                new St.Icon({icon_name: d.charging ? 'battery-full-charging-symbolic' : d.icon,
                    icon_size: one ? 28 : 20, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                    x_expand: true, y_expand: true}));
                grid.layout_manager.attach(ring, i % 2, Math.floor(i / 2), 1, 1);
            });
            if (devices.length === 1) {
                const one = box(true, '', {x_expand: true, y_expand: true});
                const d = devices[0];
                const ring = grid.get_first_child();
                grid.remove_child(ring);
                one.add_child(ring);
                one.add_child(label(`${Math.round(d.level * 100)}%`, 'gwidgets-battery-big', {x_align: Clutter.ActorAlign.CENTER}));
                this.fill(one);
                return;
            }
            this.fill(grid);
            return;
        }
        const list = box(true, 'gwidgets-battery-list', {x_expand: true, y_expand: true});
        devices.slice(0, this.size === 'large' ? 8 : 4).forEach(d => {
            const row = box(false, 'gwidgets-battery-row');
            row.add_child(new St.Icon({icon_name: d.icon, icon_size: 18, style_class: 'gwidgets-battery-icon'}));
            const mid = box(true, '', {x_expand: true});
            mid.add_child(label(this._name(d), 'gwidgets-battery-name'));
            mid.add_child(drawingArea(this.width - 120, 5, (cr, w, h) => paintBar(cr, w, h, d.level, levelColor(d))));
            row.add_child(mid);
            row.add_child(label(`${d.charging ? '⚡' : ''}${Math.round(d.level * 100)}%`, 'gwidgets-battery-value',
                {y_align: Clutter.ActorAlign.CENTER}));
            list.add_child(row);
        });
        this.fill(this.header(_('Batteries'), 'gwidgets-green'), list);
    }
}
