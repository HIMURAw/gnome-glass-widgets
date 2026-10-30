import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Widget} from '../widget.js';
import {box, drawingArea, label, paintBar, placeholder, spacer} from '../ui.js';

// The network this computer is on. Blue, the colour of links.

const BLUE = [0.04, 0.52, 1.0];

// ---------- Network ----------

function rate(bytes) {
    if (bytes < 1024)
        return {value: `${Math.round(bytes)}`, unit: 'B/s'};
    if (bytes < 1024 * 1024)
        return {value: `${Math.round(bytes / 1024)}`, unit: 'KB/s'};
    return {value: (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0), unit: 'MB/s'};
}

export class NetworkWidget extends Widget {
    constructor(ctx, size) {
        super(ctx, size);
        this._net = null;
        this.watch(ctx.sources.network, n => this._render(n));
    }

    _speed(bytes, arrow, styleClass) {
        const r = rate(bytes);
        const b = box(false, 'gwidgets-net-speed');
        b.add_child(label(arrow, `gwidgets-net-arrow ${styleClass}`, {y_align: Clutter.ActorAlign.END}));
        b.add_child(label(r.value, 'gwidgets-net-value', {y_align: Clutter.ActorAlign.END}));
        b.add_child(label(r.unit, 'gwidgets-dim gwidgets-tiny', {y_align: Clutter.ActorAlign.END}));
        return b;
    }

    // The download rate over the last minute or so, as a soft area.
    _graph(history, width, height) {
        return drawingArea(width, height, (cr, w, h) => {
            const max = Math.max(64 * 1024, ...history);
            const n = Math.max(2, history.length);
            const step = w / (n - 1);
            const y = v => h - (v / max) * (h - 2) - 1;
            cr.moveTo(0, h);
            history.forEach((v, i) => cr.lineTo(i * step, y(v)));
            cr.lineTo((history.length - 1) * step, h);
            cr.closePath();
            const grad = new Cairo.LinearGradient(0, 0, 0, h);
            grad.addColorStopRGBA(0, ...BLUE, 0.45);
            grad.addColorStopRGBA(1, ...BLUE, 0.02);
            cr.setSource(grad);
            cr.fill();
            cr.setSourceRGBA(...BLUE, 1);
            cr.setLineWidth(1.5 * (w / Math.max(1, width)));
            history.forEach((v, i) => (i ? cr.lineTo(i * step, y(v)) : cr.moveTo(0, y(v))));
            cr.stroke();
        });
    }

    _render(n) {
        this.target = {argv: ['gnome-control-center', n.wifi ? 'wifi' : 'network']};
        if (!n.online) {
            this.fill(this.header(_('Network'), 'gwidgets-blue'), placeholder(_('Offline')));
            return;
        }
        const icon = n.wifi ? 'network-wireless-symbolic' : n.vpn ? 'network-vpn-symbolic' : 'network-wired-symbolic';
        const name = box(false, 'gwidgets-net-name');
        name.add_child(new St.Icon({icon_name: icon, icon_size: 14}));
        name.add_child(label(n.name, 'gwidgets-net-ssid', {x_expand: true}));
        if (n.metered)
            name.add_child(label(_('Data saver'), 'gwidgets-net-saver', {y_align: Clutter.ActorAlign.CENTER}));
        const ping = label(n.latency === null || n.latency === undefined ? '' : `${Math.round(n.latency)} ms`,
            'gwidgets-dim gwidgets-tiny');
        const speeds = box(this.size === 'small', 'gwidgets-net-speeds');
        speeds.add_child(this._speed(n.down, '↓', 'gwidgets-blue'));
        speeds.add_child(this._speed(n.up, '↑', 'gwidgets-green'));
        if (this.size === 'small') {
            this.fill(this.header(_('Network'), 'gwidgets-blue', ping), name, spacer(), speeds);
            return;
        }
        const parts = [this.header(_('Network'), 'gwidgets-blue', ping), name, speeds,
            this._graph(n.history ?? [], this.width - 32, this.size === 'large' ? 120 : 34)];
        const t = n.tailscale;
        if (this.size === 'large' || t?.installed) {
            const row = box(false, 'gwidgets-net-tail');
            row.add_child(new St.Widget({style_class: t?.up ? 'gwidgets-dot gwidgets-dot-on' : 'gwidgets-dot',
                y_align: Clutter.ActorAlign.CENTER}));
            const text = !t?.installed ? _('Tailscale not installed')
                : t.up ? _('Tailscale %s · %d/%d online').format(t.ip, t.online, t.peers) : _('Tailscale off');
            row.add_child(label(text, 'gwidgets-dim gwidgets-tiny'));
            parts.push(row);
        }
        if (this.size === 'large' && n.strength !== null && n.strength !== undefined) {
            const sig = box(true, 'gwidgets-net-signal');
            const top = box(false);
            top.add_child(label(_('Signal'), 'gwidgets-dim gwidgets-tiny', {x_expand: true}));
            top.add_child(label(`${n.strength}%`, 'gwidgets-dim gwidgets-tiny'));
            sig.add_child(top);
            sig.add_child(drawingArea(this.width - 32, 5, (cr, w, h) => paintBar(cr, w, h, n.strength / 100, BLUE)));
            parts.push(sig);
        }
        this.fill(...parts);
    }
}
