import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Cairo from 'cairo';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Widget} from '../widget.js';
import {Ticker, box, drawingArea, label, placeholder, spacer} from '../ui.js';

// The same drawings as Dynamic Island's weather card, so a forecast looks the same
// on the island and on the desktop.
const TINT = {sun: [1.0, 0.8, 0.3], moon: [0.85, 0.88, 1.0], cloud: [0.85, 0.88, 0.93], rain: [0.45, 0.72, 1.0],
    snow: [0.92, 0.96, 1.0], storm: [1.0, 0.86, 0.35], fog: [0.75, 0.78, 0.82]};

function cloud(cr, cx, cy, r) {
    cr.newSubPath();
    cr.arc(cx - r * 0.55, cy + r * 0.1, r * 0.45, 0, 2 * Math.PI);
    cr.newSubPath();
    cr.arc(cx, cy - r * 0.15, r * 0.6, 0, 2 * Math.PI);
    cr.newSubPath();
    cr.arc(cx + r * 0.6, cy + r * 0.12, r * 0.42, 0, 2 * Math.PI);
    cr.rectangle(cx - r * 0.55, cy + r * 0.1, r * 1.15, r * 0.44);
    cr.fill();
}

function sun(cr, cx, cy, r, t, s) {
    const [R, G, B] = TINT.sun;
    const glow = 0.5 + 0.5 * Math.sin(t * 2);
    cr.setSourceRGBA(R, G, B, 0.15 + 0.1 * glow);
    cr.arc(cx, cy, r * 1.45, 0, 2 * Math.PI);
    cr.fill();
    cr.setSourceRGBA(R, G, B, 0.95);
    cr.setLineWidth(2.2 * s);
    cr.setLineCap(Cairo.LineCap.ROUND);
    for (let i = 0; i < 8; i++) {
        const a = t * 0.6 + (i * Math.PI) / 4;
        cr.moveTo(cx + Math.cos(a) * r * 1.15, cy + Math.sin(a) * r * 1.15);
        cr.lineTo(cx + Math.cos(a) * r * (1.45 + 0.08 * glow), cy + Math.sin(a) * r * (1.45 + 0.08 * glow));
    }
    cr.stroke();
    cr.arc(cx, cy, r * 0.9, 0, 2 * Math.PI);
    cr.fill();
}

function moon(cr, cx, cy, r, t, s) {
    const [R, G, B] = TINT.moon;
    cr.setSourceRGBA(R, G, B, 0.95);
    cr.arc(cx, cy, r, 0, 2 * Math.PI);
    cr.arcNegative(cx + r * 0.45, cy - r * 0.3, r * 0.85, 2 * Math.PI, 0);
    cr.fill();
    [[-1.3, -0.9, 0], [1.2, -1.2, 1.7], [1.4, 0.6, 3.1]].forEach(([dx, dy, phase]) => {
        cr.setSourceRGBA(R, G, B, 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.5 + phase)));
        cr.arc(cx + dx * r, cy + dy * r, 1.4 * s, 0, 2 * Math.PI);
        cr.fill();
    });
}

function paintWeather(cr, w, h, s, t, cond, night) {
    const r = Math.min(w, h) * 0.24;
    const cx = w / 2;
    const cy = h / 2;
    const drift = Math.sin(t * 0.8) * r * 0.12;
    const kind = cond === 'sun' && night ? 'moon' : cond;
    if (kind === 'sun')
        return sun(cr, cx, cy, r, t, s);
    if (kind === 'moon')
        return moon(cr, cx, cy, r * 0.95, t, s);
    if (kind === 'partly')
        (night ? moon : sun)(cr, cx + r * 0.45, cy - r * 0.45, r * 0.7, t, s);
    if (kind === 'fog') {
        cr.setSourceRGBA(...TINT.fog, 0.85);
        cr.setLineWidth(2.4 * s);
        cr.setLineCap(Cairo.LineCap.ROUND);
        for (let i = 0; i < 4; i++) {
            const y = cy - r * 0.6 + i * r * 0.42;
            const shift = Math.sin(t * 1.2 + i) * r * 0.3;
            cr.moveTo(cx - r * 1.1 + shift, y);
            cr.lineTo(cx + r * 1.1 + shift - (i % 2) * r * 0.5, y);
        }
        cr.stroke();
        return undefined;
    }
    const dark = kind === 'storm' || kind === 'rain';
    cr.setSourceRGBA(...(dark ? [0.7, 0.74, 0.82] : TINT.cloud), 0.95);
    cloud(cr, cx + drift - (kind === 'partly' ? r * 0.15 : 0), cy - (kind === 'cloud' || kind === 'partly' ? 0 : r * 0.35),
        r * 1.05);
    const base = cy + r * 0.35;
    if (kind === 'rain' || kind === 'storm') {
        cr.setLineWidth(1.8 * s);
        cr.setLineCap(Cairo.LineCap.ROUND);
        for (let i = 0; i < 5; i++) {
            const phase = (t * 1.6 + i * 0.37) % 1;
            const x = cx - r * 0.8 + i * r * 0.4 + drift - phase * r * 0.15;
            const y = base + phase * r * 1.1;
            cr.setSourceRGBA(...TINT.rain, 1 - phase);
            cr.moveTo(x, y);
            cr.lineTo(x - r * 0.08, y + r * 0.28);
            cr.stroke();
        }
    }
    if (kind === 'snow') {
        for (let i = 0; i < 6; i++) {
            const phase = (t * 0.5 + i * 0.29) % 1;
            const x = cx - r * 0.9 + i * r * 0.36 + Math.sin(t * 2 + i) * r * 0.1 + drift;
            cr.setSourceRGBA(...TINT.snow, 1 - phase * 0.8);
            cr.arc(x, base + phase * r * 1.2, 1.9 * s, 0, 2 * Math.PI);
            cr.fill();
        }
    }
    if (kind === 'storm') {
        const flash = Math.max(0, 1 - ((t % 2.6) / 0.35));
        if (flash > 0) {
            cr.setSourceRGBA(...TINT.storm, flash);
            cr.moveTo(cx + r * 0.1, base - r * 0.1);
            cr.lineTo(cx - r * 0.25, base + r * 0.55);
            cr.lineTo(cx + r * 0.05, base + r * 0.5);
            cr.lineTo(cx - r * 0.2, base + r * 1.1);
            cr.lineTo(cx + r * 0.35, base + r * 0.35);
            cr.lineTo(cx + r * 0.05, base + r * 0.4);
            cr.closePath();
            cr.fill();
        }
    }
    return undefined;
}

// A drawing that moves (the big one) or keeps still (the small ones in rows).
function weatherIcon(ctx, cond, night, size, moving) {
    let ticker = null;
    const area = drawingArea(size, size, (cr, w, h, s) => paintWeather(cr, w, h, s, ticker?.t ?? 1.3, cond, night));
    if (moving)
        ticker = new Ticker(area, ctx, () => area.queue_repaint());
    return area;
}

// The sky behind the numbers, from the weather itself: clear day blue, night navy,
// grey cloud, rain slate, storm violet, snow ice.
function sky(w) {
    if (w.cond === 'storm')
        return 'storm';
    if (w.cond === 'rain')
        return 'rain';
    if (w.cond === 'snow')
        return 'snow';
    if (w.night)
        return 'night';
    if (w.cond === 'cloud' || w.cond === 'fog')
        return 'cloud';
    return 'day';
}

export class WeatherWidget extends Widget {
    constructor(ctx, size) {
        super(ctx, size);
        this.target = {app: 'org.gnome.Weather.desktop'};
        this.fill(placeholder(_('Loading the weather…')));
        this.watch(ctx.sources.weather, w => this._render(w));
    }

    _render(w) {
        this.body.style_class = `gwidgets-body gwidgets-${this.size}`;
        if (!w) {
            this.fill(placeholder(_('No weather (offline?)')));
            return;
        }
        this.body.add_style_class_name(`gwidgets-sky gwidgets-sky-${sky(w)}`);
        const small = this.size === 'small';
        const place = label(w.place || _('Here'), 'gwidgets-weather-place');
        const temp = label(`${w.temp}°`, small || this.size === 'large' ? 'gwidgets-weather-temp' : 'gwidgets-weather-temp gwidgets-weather-temp-mid');
        const icon = weatherIcon(this.ctx, w.cond, w.night, small ? 42 : 34, true);
        icon.x_align = Clutter.ActorAlign.END;
        const text = label(w.text, 'gwidgets-weather-text');
        const range = label(_('H:%d°  L:%d°').format(w.hi, w.lo), 'gwidgets-weather-text');
        if (small) {
            // Place and drawing on top, the temperature, then what it is like.
            const top = box(false, '', {x_expand: true});
            top.add_child(place);
            top.add_child(spacer());
            top.add_child(icon);
            this.fill(top, temp, spacer(), text, range);
            return;
        }
        // The place and temperature on the left, the drawing and what it is like on the right.
        const head = box(false, '', {x_expand: true});
        const left = box(true, '', {x_expand: true});
        left.add_child(place);
        left.add_child(temp);
        const right = box(true, 'gwidgets-weather-right', {x_align: Clutter.ActorAlign.END});
        right.add_child(icon);
        text.x_align = range.x_align = Clutter.ActorAlign.END;
        right.add_child(text);
        right.add_child(range);
        head.add_child(left);
        head.add_child(right);
        const hours = box(false, 'gwidgets-hours', {x_expand: true});
        w.hours.forEach((h, i) => {
            const col = box(true, 'gwidgets-hour', {x_expand: true});
            col.add_child(label(i === 0 ? _('Now') : h.hour, 'gwidgets-hour-label', {x_align: Clutter.ActorAlign.CENTER}));
            const ic = weatherIcon(this.ctx, h.cond, h.night, 22, false);
            ic.x_align = Clutter.ActorAlign.CENTER;
            col.add_child(ic);
            col.add_child(label(`${i === 0 ? w.temp : h.temp}°`, 'gwidgets-hour-temp', {x_align: Clutter.ActorAlign.CENTER}));
            hours.add_child(col);
        });
        if (this.size === 'medium') {
            this.fill(head, spacer(), hours);
            return;
        }
        const days = box(true, 'gwidgets-days', {x_expand: true});
        const low = Math.min(...w.days.map(d => d.lo));
        const high = Math.max(...w.days.map(d => d.hi));
        w.days.forEach((d, i) => {
            const row = box(false, 'gwidgets-day');
            const name = i === 0 ? _('Today') : GLib.DateTime.new_from_unix_local(Math.floor(d.date / 1000)).format('%A');
            row.add_child(label(name, 'gwidgets-day-name', {y_align: Clutter.ActorAlign.CENTER}));
            const ic = weatherIcon(this.ctx, d.cond, false, 26, false);
            row.add_child(ic);
            row.add_child(label(d.rain >= 30 ? `%${d.rain}` : '', 'gwidgets-day-rain', {y_align: Clutter.ActorAlign.CENTER}));
            row.add_child(label(`${d.lo}°`, 'gwidgets-day-lo', {y_align: Clutter.ActorAlign.CENTER}));
            row.add_child(this._range(d, low, high));
            row.add_child(label(`${d.hi}°`, 'gwidgets-day-hi', {y_align: Clutter.ActorAlign.CENTER}));
            days.add_child(row);
        });
        this.fill(head, hours, days);
    }

    // The day's low to high on the week's scale, cool to warm.
    _range(day, low, high) {
        const span = Math.max(1, high - low);
        return drawingArea(78, 5, (cr, w, h) => {
            const x1 = ((day.lo - low) / span) * w;
            const x2 = Math.max(x1 + h, ((day.hi - low) / span) * w);
            cr.setSourceRGBA(1, 1, 1, 0.14);
            cr.rectangle(0, 0, w, h);
            cr.fill();
            const grad = new Cairo.LinearGradient(0, 0, w, 0);
            grad.addColorStopRGBA(0, 0.45, 0.78, 1, 1);
            grad.addColorStopRGBA(1, 1, 0.72, 0.3, 1);
            cr.setSource(grad);
            cr.rectangle(x1, 0, x2 - x1, h);
            cr.fill();
        }, {y_align: Clutter.ActorAlign.CENTER, style_class: 'gwidgets-day-range'});
    }
}
