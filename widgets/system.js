import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Widget} from '../widget.js';
import {box, drawingArea, label, layered, paintBar, paintRing, spacer} from '../ui.js';

// Processor warm orange, memory blue, disk violet: one colour per thing, kept the same
// in the bars and the rings.
const COLORS = {cpu: [1.0, 0.62, 0.04], memory: [0.25, 0.6, 1.0], disk: [0.69, 0.42, 1.0]};

function bytes(n) {
    return GLib.format_size_full(n, GLib.FormatSizeFlags.DEFAULT);
}

function uptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d)
        return _('Up %dd %dh').format(d, h);
    return h ? _('Up %dh %dm').format(h, m) : _('Up %dm').format(m);
}

export class SystemWidget extends Widget {
    constructor(ctx, size) {
        super(ctx, size);
        this._values = {cpu: 0, memory: 0, disk: 0};
        const parts = [['cpu', _('CPU')], ['memory', _('Memory')], ['disk', _('Disk')]];
        this._texts = {};
        this._paints = [];
        if (size === 'small') {
            const rows = box(true, 'gwidgets-sys-rows', {x_expand: true, y_expand: true});
            for (const [key, name] of parts) {
                const row = box(true, 'gwidgets-sys-row');
                const line = box(false);
                line.add_child(label(name, 'gwidgets-sys-name', {x_expand: true}));
                this._texts[key] = label('', 'gwidgets-sys-value');
                line.add_child(this._texts[key]);
                row.add_child(line);
                const bar = drawingArea(this.width - 28, 6, (cr, w, h) => paintBar(cr, w, h, this._values[key], COLORS[key]));
                this._paints.push(bar);
                row.add_child(bar);
                rows.add_child(row);
            }
            this.fill(this.header(_('System'), 'gwidgets-orange'), spacer(), rows);
        } else {
            const rings = box(false, 'gwidgets-sys-rings', {x_expand: true, y_expand: true});
            this._details = {};
            for (const [key, name] of parts) {
                const col = box(true, 'gwidgets-sys-ring', {x_expand: true});
                const ring = drawingArea(72, 72, (cr, w, h, s) => paintRing(cr, w, h, s, this._values[key], COLORS[key], 7),
                    {x_align: Clutter.ActorAlign.CENTER});
                this._texts[key] = label('', 'gwidgets-sys-ring-value', {x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true});
                this._paints.push(ring);
                col.add_child(layered(ring, this._texts[key]));
                col.add_child(label(name, 'gwidgets-sys-name', {x_align: Clutter.ActorAlign.CENTER}));
                this._details[key] = label('', 'gwidgets-dim gwidgets-tiny', {x_align: Clutter.ActorAlign.CENTER});
                col.add_child(this._details[key]);
                rings.add_child(col);
            }
            this._uptime = label('', 'gwidgets-dim');
            this.fill(this.header(_('System'), 'gwidgets-orange', this._uptime), rings);
        }
        this.watch(ctx.sources.system, s => this._update(s));
    }

    _update(s) {
        Object.assign(this._values, {cpu: s.cpu, memory: s.memory, disk: s.disk});
        for (const key of Object.keys(this._values))
            this._texts[key].text = `${Math.round(this._values[key] * 100)}%`;
        this._paints.forEach(p => p.queue_repaint());
        if (this._details) {
            this._details.memory.text = `${bytes(s.memUsed)} / ${bytes(s.memTotal)}`;
            this._details.disk.text = _('%s free').format(bytes(s.diskFree));
            this._uptime.text = uptime(s.uptime);
        }
    }
}
