import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import St from 'gi://St';
import Cairo from 'cairo';

// Small building blocks the widgets share.

export function label(text, styleClass, params = {}) {
    const l = new St.Label({text: String(text ?? ''), style_class: styleClass, ...params});
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

// A wrapping label, cut to about `chars` characters (St labels cannot cap their lines).
export function paragraph(text, styleClass, chars = 90, params = {}) {
    let t = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (t.length > chars)
        t = `${t.slice(0, chars - 1).replace(/\s+\S*$/, '')}…`;
    const l = new St.Label({text: t, style_class: styleClass, ...params});
    l.clutter_text.line_wrap = true;
    l.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    return l;
}

export function icon(name, size, styleClass = '') {
    return new St.Icon({icon_name: name, icon_size: size, style_class: styleClass});
}

export function box(vertical, styleClass = '', params = {}) {
    return new St.BoxLayout({orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
        style_class: styleClass, ...params});
}

export function spacer() {
    return new St.Widget({x_expand: true, y_expand: true});
}

// Cairo drawing at the screen's real resolution; paint(cr, w, h, scale) gets device pixels.
export function drawingArea(width, height, paint, params = {}) {
    const area = new St.DrawingArea({width, height, ...params});
    area.connect('repaint', a => {
        const cr = a.get_context();
        const [w, h] = a.get_surface_size();
        try {
            paint(cr, w, h, w / Math.max(1, a.width));
        } finally {
            cr.$dispose();
        }
    });
    return area;
}

// A drawing with something on top of it (a ring with its value in the middle):
// St.DrawingArea does not paint children of its own.
export function layered(area, ...overlays) {
    const stack = new St.Widget({layout_manager: new Clutter.BinLayout(), x_align: area.x_align, y_align: area.y_align});
    area.x_align = area.y_align = Clutter.ActorAlign.FILL;
    stack.add_child(area);
    overlays.forEach(o => stack.add_child(o));
    return stack;
}

// Decorative motion (the weather icon, the equaliser) at 12 fps: slow movements look the same, and
// while the desktop is in front every frame recomposites the whole screen (12 widgets, a video).
const FRAME = 83;

// An animation loop that runs only while the actor is on screen and the desktop is in
// front (widgets behind a focused window keep still).
export class Ticker {
    constructor(actor, ctx, tick) {
        this._actor = actor;
        this._ctx = ctx;
        this._tick = tick;
        this.t = 0;
        actor.connect('notify::mapped', () => this._sync());
        actor.connect('destroy', () => {
            this._stop();
            this._ctx.disconnectActive(this._activeId);
        });
        this._activeId = ctx.connectActive(() => this._sync());
    }

    _sync() {
        const run = this._actor.mapped && this._ctx.active;
        if (run && !this._id) {
            this._id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME, () => {
                this.t += FRAME / 1000;
                this._tick(this.t);
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!run) {
            this._stop();
        }
    }

    _stop() {
        if (this._id)
            GLib.source_remove(this._id);
        this._id = 0;
    }
}

// A ring gauge, 0..1, with a soft track. color: [r, g, b].
export function paintRing(cr, w, h, s, value, color, thickness = 6) {
    const r = Math.min(w, h) / 2 - thickness * s / 2 - 1;
    const cx = w / 2;
    const cy = h / 2;
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(thickness * s);
    cr.setSourceRGBA(...color, 0.18);
    cr.arc(cx, cy, r, 0, 2 * Math.PI);
    cr.stroke();
    const v = Math.max(0, Math.min(1, value ?? 0));
    if (v > 0.001) {
        cr.setSourceRGBA(...color, 1);
        cr.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + v * 2 * Math.PI);
        cr.stroke();
    }
}

// A thin horizontal bar, 0..1.
export function paintBar(cr, w, h, value, color) {
    const r = h / 2;
    const bar = (width, alpha) => {
        if (width < h)
            width = h;
        cr.setSourceRGBA(...color, alpha);
        cr.newSubPath();
        cr.arc(r, r, r, Math.PI / 2, 3 * Math.PI / 2);
        cr.arc(width - r, r, r, -Math.PI / 2, Math.PI / 2);
        cr.closePath();
        cr.fill();
    };
    bar(w, 0.16);
    const v = Math.max(0, Math.min(1, value ?? 0));
    if (v > 0.001)
        bar(w * v, 1);
}

// A small line chart of values, with a soft fill under it. color: [r, g, b].
export function paintLine(cr, w, h, values, color) {
    if (!values?.length || values.length < 2)
        return;
    const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
    const x = i => i / (values.length - 1) * (w - 2) + 1;
    const y = v => h - 2 - (v - lo) / span * (h - 4);
    cr.setLineWidth(1.5);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.moveTo(x(0), y(values[0]));
    values.forEach((v, i) => cr.lineTo(x(i), y(v)));
    cr.setSourceRGBA(...color, 1);
    cr.strokePreserve();
    cr.lineTo(x(values.length - 1), h);
    cr.lineTo(x(0), h);
    cr.closePath();
    cr.setSourceRGBA(...color, 0.14);
    cr.fill();
}

export function money(n) {
    if (n === null || n === undefined || Number.isNaN(n))
        return '—';
    return `${Math.round(n).toLocaleString('tr-TR')} ₺`;
}

export function hhmm(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// A widget's empty or unavailable state: a short line in the middle.
export function placeholder(text) {
    return label(text, 'gwidgets-placeholder', {x_expand: true, y_expand: true,
        x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
}

// What a widget opens when clicked: a function, or {app} (a .desktop id), {uri} (with
// {app}: in that app), or {argv}. Missing apps fall back to the URI's default handler.
export function launch(target) {
    if (!target)
        return false;
    try {
        if (typeof target === 'function') {
            target();
            return true;
        }
        const context = global.create_app_launch_context(0, -1);
        const app = target.app ? Shell.AppSystem.get_default().lookup_app(target.app) : null;
        if (app && target.uri)
            return app.app_info.launch_uris([target.uri], context);
        if (app) {
            app.activate();
            return true;
        }
        if (target.argv) {
            GLib.spawn_async(null, target.argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
            return true;
        }
        if (target.uri)
            return Gio.AppInfo.launch_default_for_uri(target.uri, context);
    } catch (e) {
        console.error('Glass Widgets: could not open', e);
    }
    return false;
}
