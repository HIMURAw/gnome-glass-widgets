import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Widget} from '../widget.js';
import {box, drawingArea, label, layered, paintBar, paintRing, paragraph, placeholder, spacer} from '../ui.js';
import {HarvisWidget} from './harvis.js';

// The connections: the phone (through Harvis Mobil), unread mail (through Harvis) and
// the network this computer is on. Blue, the colour of links.

const GREEN = [0.2, 0.84, 0.35];
const BLUE = [0.04, 0.52, 1.0];

function batteryColor(level, charging) {
    if (charging || level > 0.2)
        return GREEN;
    return level > 0.1 ? [1.0, 0.75, 0.0] : [1.0, 0.27, 0.23];
}

// ---------- Phone ----------

export class PhoneWidget extends HarvisWidget {
    constructor(ctx, size) {
        super(ctx, size, 'phone');
    }

    head(right = null) {
        return this.header(_('Phone'), 'gwidgets-blue', right);
    }

    render(p) {
        if (!p.known) {
            this.fill(this.head(), paragraph(_('Open Harvis on your phone'), 'gwidgets-placeholder', 40,
                {x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER}));
            return;
        }
        const level = Math.max(0, Math.min(1, (p.battery ?? 0) / 100));
        const status = p.online ? (p.near ? _('Beside you') : _('Connected')) : _('Last seen %s').format(p.seen ?? '—');
        const dot = new St.Widget({style_class: p.online ? 'gwidgets-dot gwidgets-dot-on' : 'gwidgets-dot',
            y_align: Clutter.ActorAlign.CENTER});
        const ring = layered(drawingArea(62, 62, (cr, w, h, s) => paintRing(cr, w, h, s, level, batteryColor(level, p.charging), 6),
            {x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}),
        new St.Icon({icon_name: p.charging ? 'battery-full-charging-symbolic' : 'phone-symbolic', icon_size: 22,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true}));
        const left = box(true, 'gwidgets-phone-left', {y_expand: true});
        left.add_child(ring);
        left.add_child(label(p.battery === null || p.battery === undefined ? '—' : `${Math.round(p.battery)}%`,
            'gwidgets-phone-level', {x_align: Clutter.ActorAlign.CENTER}));
        const state = box(false, 'gwidgets-phone-state');
        state.add_child(dot);
        state.add_child(label(status, 'gwidgets-dim gwidgets-tiny', {y_align: Clutter.ActorAlign.CENTER}));
        if (this.size === 'small') {
            const middle = box(false, '', {x_expand: true, y_expand: true});
            middle.add_child(spacer());
            middle.add_child(left);
            middle.add_child(spacer());
            this.fill(this.head(), middle, state);
            return;
        }
        const notes = box(true, 'gwidgets-phone-notes', {x_expand: true});
        const list = p.notes ?? [];
        if (!list.length)
            notes.add_child(label(_('No notifications'), 'gwidgets-dim'));
        list.slice(0, 3).forEach(n => {
            const row = box(true, 'gwidgets-phone-note');
            const top = box(false);
            top.add_child(label(n.app, 'gwidgets-phone-app', {x_expand: true}));
            top.add_child(label(n.at ?? '', 'gwidgets-dim gwidgets-tiny'));
            row.add_child(top);
            row.add_child(label(n.title || n.text, 'gwidgets-phone-title'));
            notes.add_child(row);
        });
        const row = box(false, 'gwidgets-phone-row', {x_expand: true, y_expand: true});
        row.add_child(left);
        row.add_child(notes);
        this.fill(this.head(state), row);
    }
}

// ---------- Mail ----------

export class MailWidget extends HarvisWidget {
    constructor(ctx, size) {
        super(ctx, size, 'mail');
    }

    head(right = null) {
        return this.header(_('Mail'), 'gwidgets-blue', right);
    }

    render(m) {
        const count = box(true, 'gwidgets-mail-count');
        count.add_child(label(String(m.unread ?? 0), 'gwidgets-mail-big'));
        count.add_child(label(_('unread'), 'gwidgets-dim'));
        const important = label(m.important ? _('%d important').format(m.important) : _('Nothing important'),
            m.important ? 'gwidgets-mail-important' : 'gwidgets-dim gwidgets-tiny');
        if (this.size === 'small') {
            this.fill(this.head(), count, spacer(), important);
            return;
        }
        const list = box(true, 'gwidgets-mail-list', {x_expand: true, y_expand: true});
        const items = m.items ?? [];
        if (!items.length)
            list.add_child(placeholder(_('Inbox zero')));
        items.slice(0, this.size === 'large' ? 5 : 3).forEach(item => {
            const row = box(false, 'gwidgets-mail-row');
            row.add_child(new St.Widget({style_class: item.important ? 'gwidgets-dot gwidgets-dot-important' : 'gwidgets-dot',
                y_align: Clutter.ActorAlign.START}));
            const col = box(true, '', {x_expand: true});
            col.add_child(label(item.from, 'gwidgets-mail-from'));
            col.add_child(label(item.subject, 'gwidgets-dim'));
            row.add_child(col);
            list.add_child(row);
        });
        if (this.size === 'medium') {
            const row = box(false, 'gwidgets-mail-cols', {x_expand: true, y_expand: true});
            const left = box(true, '');
            left.add_child(count);
            left.add_child(spacer());
            left.add_child(important);
            row.add_child(left);
            row.add_child(list);
            this.fill(this.head(), row);
            return;
        }
        this.fill(this.head(important), count, list);
    }
}

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
